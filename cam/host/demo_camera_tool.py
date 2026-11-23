"""Optional CLI tool to relocate ESP32-S3 camera IPs or read IP over USB serial.

Never modifies cam/local/; writes discovered IPs only to run/course-demo/camera-hosts.json.
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path
import time
import serial

from three_camera_demo import (
    load_role_configs,
    load_saved_hosts,
    locate_cameras,
    save_hosts,
    validate_private_host,
)


def cmd_locate(args: argparse.Namespace) -> None:
    configs = load_role_configs(args.config_dir.resolve())
    hosts_file = args.hosts_file.resolve()
    current = load_saved_hosts(hosts_file)

    def log_progress(event: dict) -> None:
        msg = event.get("message")
        if msg:
            print(msg, flush=True)

    found, scanned = locate_cameras(
        configs,
        current,
        extra_subnets=args.subnet,
        force=True,
        emit_fn=log_progress,
    )
    merged = {**current, **found}
    save_hosts(hosts_file, merged)
    print(f"\n定位完成 (扫描 IP 数: {scanned})，结果已保存至 {hosts_file}:")
    for role in ("front", "left", "right"):
        if role in found:
            print(f"  {role:5s} -> {found[role]}")
        elif role in configs:
            print(f"  {role:5s} -> 未找到 (原记录: {merged.get(role, '无')})")
        else:
            print(f"  {role:5s} -> 未配对")


def cmd_serial_ip(args: argparse.Namespace) -> None:
    hosts_file = args.hosts_file.resolve()
    configs = load_role_configs(args.config_dir.resolve())
    direction = None
    camera_id = None
    ip = None
    uplink_disabled = False

    with serial.Serial(args.port, 115200, timeout=0.5) as device:
        device.dtr = False
        device.rts = True
        time.sleep(0.15)
        device.rts = False
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            line = device.readline().decode("ascii", errors="ignore").strip()
            if not line:
                continue
            if line.startswith("NETWORK_IDENTITY "):
                m_id = re.search(r"cameraId=(\S+)", line)
                m_dir = re.search(r"direction=(\S+)", line)
                if m_id:
                    camera_id = m_id.group(1)
                if m_dir:
                    direction = m_dir.group(1)
                print(line, flush=True)
            elif line.startswith("NETWORK_CAMERA_READY IP="):
                ip = line.split("IP=", 1)[1].split()[0]
                print(line, flush=True)
                break
        if not ip:
            raise TimeoutError("未在串口超时时间内获取到 NETWORK_CAMERA_READY IP=")

        validate_private_host(ip)
        matched_role = direction if direction in configs else None
        if matched_role is None and camera_id:
            for role, cfg in configs.items():
                if cfg["cameraId"] == camera_id:
                    matched_role = role
                    break

        if matched_role:
            hosts = load_saved_hosts(hosts_file)
            hosts[matched_role] = ip
            save_hosts(hosts_file, hosts)
            print(f"已写入 {matched_role} -> {ip} 到 {hosts_file}")
        else:
            print(f"读取到 IP={ip} (cameraId={camera_id}, direction={direction})，未匹配到本地角色配置。")

        if args.disable_uplink:
            device.write(b"UPLINK_OFF\n")
            device.flush()
            off_deadline = time.monotonic() + 10
            while time.monotonic() < off_deadline:
                line = device.readline().decode("ascii", errors="ignore").strip()
                if line == "UPLINK_DISABLED":
                    uplink_disabled = True
                    print("已发送 UPLINK_OFF 并收到 UPLINK_DISABLED")
                    break
            if not uplink_disabled:
                print("警告：已发送 UPLINK_OFF，但未收到设备确认。")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    default_cfg = Path(__file__).resolve().parent.parent / "local"
    default_hosts = Path("run/course-demo/camera-hosts.json")
    sub = parser.add_subparsers(dest="command", required=True)

    p_loc = sub.add_parser("locate", help="自动定位三摄局域网 IP")
    p_loc.add_argument("--config-dir", type=Path, default=default_cfg)
    p_loc.add_argument("--hosts-file", type=Path, default=default_hosts)
    p_loc.add_argument("--subnet", action="append", default=[], help="额外扫描的网段，如 10.122.241.0/24")
    p_loc.set_defaults(func=cmd_locate)

    p_ser = sub.add_parser("serial-ip", help="通过 USB 串口读取单台相机当前 IP")
    p_ser.add_argument("--port", default="COM3")
    p_ser.add_argument("--config-dir", type=Path, default=default_cfg)
    p_ser.add_argument("--hosts-file", type=Path, default=default_hosts)
    p_ser.add_argument("--disable-uplink", action="store_true", help="显式关闭旧 push uplink，减少串口/轮询卡顿")
    p_ser.set_defaults(func=cmd_serial_ip)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
