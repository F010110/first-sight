"""Three-camera ESP32-S3 demo receiver with multi-tier IP relocation.

Never modifies cam/local/ configuration files; discovered or manually updated
camera hosts are persisted to a separate runtime hosts file (default:
run/course-demo/camera-hosts.json).
"""
from __future__ import annotations

import argparse
import base64
import concurrent.futures
import hashlib
import http.client
import io
import ipaddress
import json
from pathlib import Path
import re
import socket
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit
from PIL import Image

ROLES = ("front", "left", "right")
IPV4_RE = re.compile(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b")
MASK_LIKE_PREFIXES = ("255.", "254.", "252.", "248.", "240.", "224.", "192.0.0.", "0.")

_emit_lock = threading.Lock()


def emit(event: dict) -> None:
    with _emit_lock:
        print(json.dumps(event, ensure_ascii=False), flush=True)


def atomic_write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf8")
    tmp.replace(path)


def is_allowed_lan_ip(ip_obj: ipaddress.IPv4Address) -> bool:
    if ip_obj.is_multicast or ip_obj.is_unspecified:
        return False
    return ip_obj.is_private or ip_obj.is_link_local or ip_obj.is_loopback


def validate_private_host(host: str, default_port: int = 80) -> tuple[str, int]:
    raw = host.strip()
    if not raw or any(ch.isspace() for ch in raw):
        raise ValueError("Empty or invalid host")
    if "://" in raw:
        raise ValueError("Host must not include URL scheme")
    parsed = urlsplit("http://" + raw)
    if parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ValueError("Host must be an IP or hostname[:port]")
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("Missing hostname")
    port = parsed.port or default_port
    if not 1 <= port <= 65535:
        raise ValueError("Port out of range")
    try:
        ip_obj = ipaddress.IPv4Address(hostname)
        if not is_allowed_lan_ip(ip_obj):
            raise ValueError(f"Camera IP must be private/LAN: {hostname}")
        return str(ip_obj), port
    except ipaddress.AddressValueError:
        resolved = socket.gethostbyname(hostname)
        ip_obj = ipaddress.IPv4Address(resolved)
        if not is_allowed_lan_ip(ip_obj):
            raise ValueError(f"Resolved camera address must be private/LAN: {resolved}")
        return resolved, port


def format_host_port(ip: str, port: int) -> str:
    return ip if port == 80 else f"{ip}:{port}"


def load_role_configs(config_dir: Path) -> dict[str, dict]:
    configs: dict[str, dict] = {}
    for role in ROLES:
        candidate = config_dir / f"network-camera-{role}.json"
        if not candidate.exists() and role == "front":
            fallback = config_dir / "network-camera.json"
            if fallback.exists():
                candidate = fallback
        if not candidate.exists():
            continue
        raw = json.loads(candidate.read_text(encoding="utf-8-sig"))
        token = raw.get("token", "")
        camera_id = raw.get("cameraId", "")
        direction = raw.get("direction", "")
        if not isinstance(token, str) or len(token) != 64 or any(c not in "0123456789abcdefABCDEF" for c in token):
            raise ValueError(f"Invalid pairing token in {candidate.name}")
        if not isinstance(camera_id, str) or not camera_id.startswith("first-sight-"):
            raise ValueError(f"Invalid cameraId in {candidate.name}")
        if direction != role:
            raise ValueError(f"Direction mismatch in {candidate.name}: expected {role}, got {direction}")
        configs[role] = {
            "role": role,
            "cameraId": camera_id,
            "direction": direction,
            "token": token,
            "host": str(raw.get("host") or f"{camera_id}.local").strip(),
            "configFile": candidate.name,
        }
    return configs


def load_saved_hosts(hosts_file: Path) -> dict[str, str]:
    if not hosts_file.exists():
        return {}
    try:
        raw = json.loads(hosts_file.read_text(encoding="utf8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(raw, dict):
        return {}
    result: dict[str, str] = {}
    for role in ROLES:
        val = raw.get(role)
        if isinstance(val, str) and val.strip():
            result[role] = val.strip()
    return result


def save_hosts(hosts_file: Path, hosts: dict[str, str]) -> None:
    clean = {role: hosts[role] for role in ROLES if role in hosts and hosts[role]}
    atomic_write_json(hosts_file, clean)


def probe_camera_status(host: str, role_cfg: dict, timeout: float = 1.8) -> dict | None:
    try:
        ip, port = validate_private_host(host)
    except (ValueError, OSError):
        return None
    conn = None
    try:
        conn = http.client.HTTPConnection(ip, port, timeout=timeout)
        conn.request("GET", "/v1/status", headers={"Authorization": "Bearer " + role_cfg["token"]})
        resp = conn.getresponse()
        body = resp.read(8192)
        if resp.status != 200:
            return None
        status = json.loads(body)
        if status.get("device") != "first-sight-cam":
            return None
        if status.get("cameraId") != role_cfg["cameraId"] or status.get("direction") != role_cfg["direction"]:
            return None
        status["_resolvedHost"] = format_host_port(ip, port)
        return status
    except (OSError, ValueError, http.client.HTTPException):
        return None
    finally:
        if conn is not None:
            try:
                conn.close()
            except OSError:
                pass


def pull_camera_frame(host: str, role_cfg: dict, previous_boot: str | None, previous_seq: int, timeout: float = 10.0) -> tuple[bytes, dict]:
    ip, port = validate_private_host(host)
    conn = None
    try:
        conn = http.client.HTTPConnection(ip, port, timeout=timeout)
        started_ms = time.time_ns() // 1_000_000
        conn.request("GET", "/v1/frame", headers={"Authorization": "Bearer " + role_cfg["token"], "Connection": "close"})
        resp = conn.getresponse()
        data = resp.read(300_001)
        if resp.status != 200 or not 0 < len(data) <= 300_000:
            raise ValueError(f"HTTP {resp.status} len={len(data)}")
        if resp.getheader("X-Camera-Id") != role_cfg["cameraId"] or resp.getheader("X-Camera-Direction") != role_cfg["direction"]:
            raise ValueError("Camera identity/direction mismatch")
        digest = hashlib.sha256(data).hexdigest()
        if digest != resp.getheader("X-Frame-Sha256"):
            raise ValueError("SHA256 mismatch")
        boot = resp.getheader("X-Boot-Id") or ""
        seq = int(resp.getheader("X-Sequence") or "-1")
        if not boot or seq < 0:
            raise ValueError("Missing bootId or sequence")
        if boot == previous_boot and seq <= previous_seq:
            raise ValueError("Duplicate or regressed sequence")
        with Image.open(io.BytesIO(data)) as img:
            if img.format != "JPEG" or img.size != (640, 480):
                raise ValueError(f"Unexpected image {img.format} {img.size}")
            img.load()
        meta = {
            "direction": role_cfg["direction"],
            "cameraId": role_cfg["cameraId"],
            "host": format_host_port(ip, port),
            "id": f"{role_cfg['direction']}:{boot}:{seq}",
            "bootId": boot,
            "sequence": seq,
            "atMs": started_ms,
            "sha256": digest,
            "rssi": resp.getheader("X-Wifi-Rssi"),
            "channel": resp.getheader("X-Wifi-Channel"),
        }
        return data, meta
    finally:
        if conn is not None:
            try:
                conn.close()
            except OSError:
                pass


def parse_subnet_spec(spec: str) -> list[str]:
    text = spec.strip()
    if not text:
        return []
    if text.endswith(".*"):
        text = text[:-2]
    parts = text.split(".")
    if len(parts) == 3 and "/" not in text and all(p.isdigit() for p in parts):
        text = f"{text}.0/24"
    if "/" in text:
        net = ipaddress.IPv4Network(text, strict=False)
        if not is_allowed_lan_ip(net.network_address):
            raise ValueError(f"Subnet must be private/LAN: {spec}")
        if net.num_addresses > 1024:
            raise ValueError(f"Subnet too large (max /22 = 1024): {spec}")
        return [str(ip) for ip in net.hosts()]
    ip_obj = ipaddress.IPv4Address(text)
    if not is_allowed_lan_ip(ip_obj):
        raise ValueError(f"Subnet IP must be private/LAN: {spec}")
    net = ipaddress.IPv4Network(f"{ip_obj}/24", strict=False)
    return [str(ip) for ip in net.hosts()]


def get_local_private_ipv4s() -> list[str]:
    found: list[str] = []
    seen: set[str] = set()

    def add_candidate(ip_str: str) -> None:
        if ip_str in seen or ip_str.startswith(MASK_LIKE_PREFIXES):
            return
        try:
            ip_obj = ipaddress.IPv4Address(ip_str)
        except ipaddress.AddressValueError:
            return
        if ip_obj.is_loopback or ip_obj.is_link_local or ip_obj.is_multicast or ip_obj.is_unspecified:
            return
        if not ip_obj.is_private:
            return
        seen.add(ip_str)
        found.append(ip_str)

    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            add_candidate(info[4][0])
    except OSError:
        pass

    try:
        out = subprocess.check_output(["ipconfig"], stderr=subprocess.DEVNULL, timeout=3)
        text = out.decode("mbcs", errors="ignore")
        for line in text.splitlines():
            if "255." in line:
                continue
            for match in IPV4_RE.findall(line):
                add_candidate(match)
    except (OSError, subprocess.SubprocessError):
        pass

    # Prefer typical Wi-Fi / hotspot subnets first (192.168, 10, 172).
    def priority(ip_str: str) -> tuple[int, str]:
        if ip_str.startswith("192.168."):
            return (0, ip_str)
        if ip_str.startswith("10."):
            return (1, ip_str)
        return (2, ip_str)

    found.sort(key=priority)
    return found


def get_arp_private_ips() -> list[str]:
    ips: list[str] = []
    seen: set[str] = set()
    try:
        out = subprocess.check_output(["arp", "-a"], stderr=subprocess.DEVNULL, timeout=3)
        text = out.decode("mbcs", errors="ignore")
        for line in text.splitlines():
            matches = IPV4_RE.findall(line)
            if not matches:
                continue
            candidate = matches[0]
            if candidate in seen or candidate.endswith(".255") or candidate.endswith(".0"):
                continue
            try:
                ip_obj = ipaddress.IPv4Address(candidate)
            except ipaddress.AddressValueError:
                continue
            if ip_obj.is_private and not ip_obj.is_loopback and not ip_obj.is_link_local and not ip_obj.is_multicast:
                seen.add(candidate)
                ips.append(candidate)
    except (OSError, subprocess.SubprocessError):
        pass
    return ips


def discover_udp_cameras(
    local_ips: list[str],
    udp_port: int = 33333,
    wait_seconds: float = 1.4,
    extra_targets: list[str] | None = None,
) -> list[str]:
    targets = ["255.255.255.255"]
    for ip_str in local_ips:
        octets = ip_str.split(".")
        if len(octets) == 4:
            bcast = f"{octets[0]}.{octets[1]}.{octets[2]}.255"
            if bcast not in targets:
                targets.append(bcast)
    for t in extra_targets or []:
        if t not in targets:
            targets.append(t)
    responders: list[str] = []
    seen: set[str] = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            if hasattr(socket, "SIO_UDP_CONNRESET"):
                try:
                    sock.ioctl(socket.SIO_UDP_CONNRESET, False)
                except OSError:
                    pass
            sock.bind(("0.0.0.0", 0))
            sock.settimeout(0.25)
            for target in targets:
                try:
                    sock.sendto(b"FIRST_SIGHT_DISCOVER_1", (target, udp_port))
                except OSError:
                    pass
            deadline = time.monotonic() + wait_seconds
            while time.monotonic() < deadline:
                try:
                    data, addr = sock.recvfrom(128)
                except (socket.timeout, ConnectionResetError):
                    continue
                except OSError:
                    break
                if data.strip() == b"FIRST_SIGHT_CAMERA_1":
                    try:
                        ip_obj = ipaddress.IPv4Address(addr[0])
                        if is_allowed_lan_ip(ip_obj) and addr[0] not in seen:
                            seen.add(addr[0])
                            responders.append(addr[0])
                    except ipaddress.AddressValueError:
                        pass
    except OSError:
        pass
    return responders


def tcp_port_open(ip: str, port: int = 80, timeout: float = 0.35) -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        return sock.connect_ex((ip, port)) == 0
    except OSError:
        return False
    finally:
        try:
            sock.close()
        except OSError:
            pass


def locate_cameras(
    configs: dict[str, dict],
    current_hosts: dict[str, str],
    extra_subnets: list[str] | None = None,
    force: bool = False,
    emit_fn=emit,
    udp_port: int = 33333,
    http_port: int = 80,
    enable_subnet_scan: bool = True,
) -> tuple[dict[str, str], int]:
    found: dict[str, str] = {}
    missing = [r for r in ROLES if r in configs]
    checked_hosts_per_role: dict[str, set[str]] = {r: set() for r in missing}

    def try_host_for_roles(host: str, roles: list[str]) -> str | None:
        target = host if ":" in host or http_port == 80 else f"{host}:{http_port}"
        for role in roles:
            if role in found or target in checked_hosts_per_role[role]:
                continue
            checked_hosts_per_role[role].add(target)
            status = probe_camera_status(target, configs[role], timeout=1.6)
            if status is not None:
                found[role] = status["_resolvedHost"]
                emit_fn({
                    "kind": "locate_progress",
                    "stage": "matched",
                    "direction": role,
                    "host": found[role],
                    "message": f"已确认 {role} 相机 IP: {found[role]}",
                })
                return role
        return None

    # Tier 1: Existing saved hosts and config defaults.
    emit_fn({"kind": "locate_progress", "stage": "tier1", "message": "正在检查已知 IP..."})
    for role in list(missing):
        candidates = []
        if role in current_hosts and current_hosts[role]:
            candidates.append(current_hosts[role])
        cfg_host = configs[role].get("host")
        if cfg_host and cfg_host not in candidates:
            candidates.append(cfg_host)
        for cand in candidates:
            if role in found:
                break
            try_host_for_roles(cand, [role])

    remaining = [r for r in missing if r not in found]
    if not remaining:
        return found, 0

    # Tier 2: mDNS (<cameraId>.local)
    emit_fn({"kind": "locate_progress", "stage": "tier2", "message": f"正在尝试 mDNS 查找 {', '.join(remaining)}..."})
    for role in list(remaining):
        mdns_host = f"{configs[role]['cameraId']}.local"
        try_host_for_roles(mdns_host, [role])

    remaining = [r for r in missing if r not in found]
    if not remaining:
        return found, 0

    # Tier 3: UDP broadcast discovery on port 33333
    local_ips = get_local_private_ipv4s()
    emit_fn({"kind": "locate_progress", "stage": "tier3", "message": "正在局域网 UDP 广播探测相机..."})
    udp_ips = discover_udp_cameras(local_ips, udp_port=udp_port, wait_seconds=1.3)
    for ip in udp_ips:
        if not remaining:
            break
        try_host_for_roles(ip, remaining)
        remaining = [r for r in missing if r not in found]

    if not remaining or not enable_subnet_scan:
        return found, 0

    # Tier 4: ARP cache + Fast TCP:80 scan across extra subnets & active local /24s
    arp_ips = get_arp_private_ips()
    scan_ips: list[str] = []
    seen_ips: set[str] = set()

    def add_ip(ip_str: str) -> None:
        if ip_str not in seen_ips:
            seen_ips.add(ip_str)
            scan_ips.append(ip_str)

    for ip in arp_ips:
        add_ip(ip)

    subnet_sources: list[str] = []
    for sub in extra_subnets or []:
        if sub.strip():
            subnet_sources.append(sub.strip())
    for ip in local_ips[:3]:
        octets = ip.split(".")
        if len(octets) == 4:
            subnet_sources.append(f"{octets[0]}.{octets[1]}.{octets[2]}.0/24")

    for spec in subnet_sources:
        try:
            for ip in parse_subnet_spec(spec):
                if len(scan_ips) >= 1024:
                    break
                add_ip(ip)
        except ValueError as err:
            emit_fn({"kind": "locate_progress", "stage": "tier4", "message": f"忽略无效网段 {spec}: {err}"})
        if len(scan_ips) >= 1024:
            break

    # Skip own local IPs
    local_set = set(local_ips)
    scan_ips = [ip for ip in scan_ips if ip not in local_set]

    if not scan_ips:
        return found, 0

    emit_fn({
        "kind": "locate_progress",
        "stage": "tier4",
        "message": f"正在快速扫描局域网 {len(scan_ips)} 个地址的 80 端口...",
    })

    open_ips: list[str] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=64) as pool:
        future_map = {pool.submit(tcp_port_open, ip, http_port, 0.35): ip for ip in scan_ips}
        for fut in concurrent.futures.as_completed(future_map):
            ip = future_map[fut]
            try:
                if fut.result():
                    open_ips.append(ip)
            except Exception:
                pass

    if open_ips:
        emit_fn({
            "kind": "locate_progress",
            "stage": "tier4",
            "message": f"发现 {len(open_ips)} 台开启 80 端口的设备，正在校验相机密钥...",
        })
        for ip in open_ips:
            remaining = [r for r in missing if r not in found]
            if not remaining:
                break
            try_host_for_roles(ip, remaining)

    return found, len(scan_ips)


class ThreeCameraRunner:
    def __init__(
        self,
        config_dir: Path,
        hosts_file: Path,
        interval: float = 1.8,
        auto_scan: bool = True,
    ) -> None:
        self.config_dir = config_dir
        self.hosts_file = hosts_file
        self.interval = interval
        self.auto_scan = auto_scan
        self.stop_event = threading.Event()
        self.lock = threading.Lock()
        self.locate_lock = threading.Lock()
        self.configs = load_role_configs(config_dir)
        saved = load_saved_hosts(hosts_file)
        self.hosts: dict[str, str] = {}
        for role, cfg in self.configs.items():
            self.hosts[role] = saved.get(role) or cfg["host"]
        self.last_auto_locate = 0.0
        self.locate_busy = False

    def set_host(self, direction: str, host: str) -> str:
        if direction not in ROLES:
            raise ValueError(f"Unknown direction: {direction}")
        ip, port = validate_private_host(host)
        normalized = format_host_port(ip, port)
        with self.lock:
            self.hosts[direction] = normalized
            save_hosts(self.hosts_file, self.hosts)
        emit({"kind": "host_updated", "direction": direction, "host": normalized})
        return normalized

    def trigger_locate(self, subnets: list[str] | None = None, force: bool = False) -> None:
        if not self.locate_lock.acquire(blocking=False):
            emit({"kind": "locate_progress", "stage": "busy", "message": "已有定位任务正在运行，请稍候..."})
            return

        def run_job() -> None:
            self.locate_busy = True
            try:
                with self.lock:
                    snapshot = dict(self.hosts)
                found, scanned = locate_cameras(
                    self.configs,
                    snapshot,
                    extra_subnets=subnets,
                    force=force,
                    emit_fn=emit,
                )
                with self.lock:
                    for role, resolved in found.items():
                        self.hosts[role] = resolved
                    if found:
                        save_hosts(self.hosts_file, self.hosts)
                    current = dict(self.hosts)
                missing = [r for r in ROLES if r in self.configs and r not in found]
                emit({
                    "kind": "locate_done",
                    "found": found,
                    "hosts": current,
                    "missing": missing,
                    "scannedIps": scanned,
                })
            except Exception as err:
                emit({"kind": "locate_done", "found": {}, "missing": list(self.configs.keys()), "error": str(err)})
            finally:
                self.locate_busy = False
                self.locate_lock.release()

        threading.Thread(target=run_job, daemon=True).start()

    def _camera_worker(self, role: str) -> None:
        cfg = self.configs[role]
        prev_boot: str | None = None
        prev_seq = -1
        consecutive_failures = 0

        while not self.stop_event.is_set():
            started = time.monotonic()
            with self.lock:
                host = self.hosts.get(role, cfg["host"])
            try:
                jpeg_bytes, meta = pull_camera_frame(host, cfg, prev_boot, prev_seq)
                prev_boot = meta["bootId"]
                prev_seq = meta["sequence"]
                consecutive_failures = 0
                emit({
                    "kind": "frame",
                    "direction": role,
                    "cameraId": meta["cameraId"],
                    "host": meta["host"],
                    "id": meta["id"],
                    "atMs": meta["atMs"],
                    "sha256": meta["sha256"],
                    "rssi": meta["rssi"],
                    "channel": meta["channel"],
                    "jpeg": base64.b64encode(jpeg_bytes).decode("ascii"),
                })
            except Exception as err:
                consecutive_failures += 1
                emit({
                    "kind": "health",
                    "direction": role,
                    "cameraId": cfg["cameraId"],
                    "host": host,
                    "status": "error",
                    "error": f"{type(err).__name__}: {err}",
                })
                now = time.monotonic()
                if (
                    self.auto_scan
                    and consecutive_failures >= 4
                    and not self.locate_busy
                    and now - self.last_auto_locate > 45.0
                ):
                    self.last_auto_locate = now
                    self.trigger_locate(force=False)
                self.stop_event.wait(2.0)
                continue

            elapsed = time.monotonic() - started
            wait_sec = max(0.2, self.interval - elapsed)
            self.stop_event.wait(wait_sec)

    def _stdin_loop(self) -> None:
        for line in sys.stdin:
            if self.stop_event.is_set():
                break
            text = line.strip()
            if not text:
                continue
            try:
                cmd = json.loads(text)
            except ValueError:
                continue
            action = cmd.get("cmd")
            if action == "stop":
                self.stop_event.set()
                break
            if action == "set_host":
                direction = str(cmd.get("direction", ""))
                host = str(cmd.get("host", ""))
                try:
                    self.set_host(direction, host)
                except Exception as err:
                    emit({"kind": "command_error", "cmd": "set_host", "direction": direction, "error": str(err)})
            elif action == "locate":
                subnets = cmd.get("subnets")
                if not isinstance(subnets, list):
                    subnets = None
                else:
                    subnets = [str(s) for s in subnets if isinstance(s, str)]
                self.trigger_locate(subnets=subnets, force=bool(cmd.get("force", True)))

    def run(self) -> None:
        for role in ROLES:
            if role not in self.configs:
                emit({
                    "kind": "health",
                    "direction": role,
                    "cameraId": None,
                    "host": None,
                    "status": "unconfigured",
                    "error": f"未找到 {role} 相机配对文件",
                })
            else:
                emit({
                    "kind": "health",
                    "direction": role,
                    "cameraId": self.configs[role]["cameraId"],
                    "host": self.hosts.get(role),
                    "status": "waiting",
                    "error": None,
                })

        if self.auto_scan and self.configs:
            self.last_auto_locate = time.monotonic()
            self.trigger_locate(force=False)

        stdin_thread = threading.Thread(target=self._stdin_loop, daemon=True)
        stdin_thread.start()

        threads = [
            threading.Thread(target=self._camera_worker, args=(role,), daemon=True)
            for role in ROLES
            if role in self.configs
        ]
        for t in threads:
            t.start()

        try:
            while not self.stop_event.is_set():
                time.sleep(0.3)
        except KeyboardInterrupt:
            self.stop_event.set()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config-dir", type=Path, default=Path(__file__).resolve().parent.parent / "local")
    parser.add_argument("--hosts-file", type=Path, default=Path("run/course-demo/camera-hosts.json"))
    parser.add_argument("--interval", type=float, default=1.8)
    parser.add_argument("--no-auto-scan", action="store_true")
    args = parser.parse_args()
    if not 0.5 <= args.interval <= 10.0:
        parser.error("--interval must be 0.5..10.0")
    runner = ThreeCameraRunner(
        config_dir=args.config_dir.resolve(),
        hosts_file=args.hosts_file.resolve(),
        interval=args.interval,
        auto_scan=not args.no_auto_scan,
    )
    runner.run()


if __name__ == "__main__":
    main()
