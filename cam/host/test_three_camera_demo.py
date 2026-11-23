import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import socket
import sys
import tempfile
import threading
import unittest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

import three_camera_demo as tcd


def make_vga_jpeg(color: tuple[int, int, int]) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", (640, 480), color=color)
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


class MockCameraServer:
    def __init__(self, camera_id: str, direction: str, token: str, color: tuple[int, int, int]) -> None:
        self.camera_id = camera_id
        self.direction = direction
        self.token = token
        self.boot_id = f"boot-{direction}-1"
        self.seq = 0
        self.jpeg = make_vga_jpeg(color)
        self.sha256 = hashlib.sha256(self.jpeg).hexdigest()

        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                auth = self.headers.get("Authorization", "")
                if auth != f"Bearer {outer.token}":
                    self.send_response(401)
                    self.end_headers()
                    self.wfile.write(b"Pairing required")
                    return
                if self.path == "/v1/status":
                    payload = json.dumps({
                        "device": "first-sight-cam",
                        "cameraId": outer.camera_id,
                        "direction": outer.direction,
                        "bootId": outer.boot_id,
                    }).encode("utf8")
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                    return
                if self.path == "/v1/frame":
                    seq = outer.seq
                    outer.seq += 1
                    self.send_response(200)
                    self.send_header("Content-Type", "image/jpeg")
                    self.send_header("Content-Length", str(len(outer.jpeg)))
                    self.send_header("X-Camera-Id", outer.camera_id)
                    self.send_header("X-Camera-Direction", outer.direction)
                    self.send_header("X-Frame-Sha256", outer.sha256)
                    self.send_header("X-Boot-Id", outer.boot_id)
                    self.send_header("X-Sequence", str(seq))
                    self.send_header("X-Capture-Ms", "12345")
                    self.end_headers()
                    self.wfile.write(outer.jpeg)
                    return
                self.send_response(404)
                self.end_headers()

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


class TestThreeCameraDemo(unittest.TestCase):
    def test_load_configs_fallback_and_private_host_guard(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cfg_dir = Path(tmp) / "local"
            cfg_dir.mkdir()
            front_tok = "a" * 64
            left_tok = "b" * 64
            # Use fallback network-camera.json for front, leave right missing
            (cfg_dir / "network-camera.json").write_text(
                json.dumps({"cameraId": "first-sight-111111111111", "direction": "front", "token": front_tok, "host": "10.122.1.10"}),
                encoding="utf-8-sig",
            )
            (cfg_dir / "network-camera-left.json").write_text(
                json.dumps({"cameraId": "first-sight-222222222222", "direction": "left", "token": left_tok}),
                encoding="utf8",
            )
            configs = tcd.load_role_configs(cfg_dir)
            self.assertEqual(set(configs.keys()), {"front", "left"})
            self.assertEqual(configs["front"]["host"], "10.122.1.10")
            self.assertEqual(configs["left"]["host"], "first-sight-222222222222.local")

            # Private host validation rejects public IPs & URL schemes
            with self.assertRaises(ValueError):
                tcd.validate_private_host("8.8.8.8")
            with self.assertRaises(ValueError):
                tcd.validate_private_host("http://192.168.1.10")
            ip, port = tcd.validate_private_host("192.168.43.88")
            self.assertEqual((ip, port), ("192.168.43.88", 80))

            # Hosts file persists separately without modifying config dir
            hosts_file = Path(tmp) / "run" / "camera-hosts.json"
            tcd.save_hosts(hosts_file, {"front": "192.168.43.101", "left": "192.168.43.102"})
            loaded = tcd.load_saved_hosts(hosts_file)
            self.assertEqual(loaded, {"front": "192.168.43.101", "left": "192.168.43.102"})

    def test_probe_pull_frame_and_multi_camera_udp_discovery(self) -> None:
        tok_f = "1" * 64
        tok_l = "2" * 64
        tok_r = "3" * 64
        cam_f = MockCameraServer("first-sight-aaaaaaaaaaaa", "front", tok_f, (200, 30, 30))
        cam_l = MockCameraServer("first-sight-bbbbbbbbbbbb", "left", tok_l, (30, 200, 30))
        cam_r = MockCameraServer("first-sight-cccccccccccc", "right", tok_r, (30, 30, 200))
        try:
            configs = {
                "front": {"role": "front", "cameraId": cam_f.camera_id, "direction": "front", "token": tok_f, "host": f"127.0.0.1:{cam_f.port}"},
                "left": {"role": "left", "cameraId": cam_l.camera_id, "direction": "left", "token": tok_l, "host": f"127.0.0.1:{cam_l.port}"},
                "right": {"role": "right", "cameraId": cam_r.camera_id, "direction": "right", "token": tok_r, "host": f"127.0.0.1:{cam_r.port}"},
            }
            # Probe status rejects wrong role token, accepts matching token
            self.assertIsNone(tcd.probe_camera_status(f"127.0.0.1:{cam_l.port}", configs["front"]))
            st = tcd.probe_camera_status(f"127.0.0.1:{cam_l.port}", configs["left"])
            self.assertIsNotNone(st)
            self.assertEqual(st["cameraId"], cam_l.camera_id)

            # Pull verified 640x480 JPEG frame
            data, meta = tcd.pull_camera_frame(f"127.0.0.1:{cam_f.port}", configs["front"], None, -1)
            self.assertEqual(meta["direction"], "front")
            self.assertEqual(meta["sequence"], 0)
            self.assertEqual(meta["sha256"], cam_f.sha256)
            self.assertEqual(len(data), len(cam_f.jpeg))

            # Duplicate sequence check
            with self.assertRaises(ValueError):
                tcd.pull_camera_frame(f"127.0.0.1:{cam_f.port}", {**configs["front"]}, meta["bootId"], 99)

            # Tier 1 locate across all 3 cameras
            events: list[dict] = []
            found, _ = tcd.locate_cameras(
                configs,
                {
                    "front": f"127.0.0.1:{cam_f.port}",
                    "left": f"127.0.0.1:{cam_l.port}",
                    "right": f"127.0.0.1:{cam_r.port}",
                },
                enable_subnet_scan=False,
                emit_fn=events.append,
            )
            self.assertEqual(set(found.keys()), {"front", "left", "right"})

            # UDP discovery collects responders
            stop_udp = threading.Event()
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as srv:
                srv.bind(("127.0.0.1", 0))
                udp_port = srv.getsockname()[1]
                srv.settimeout(0.2)

                def udp_responder() -> None:
                    while not stop_udp.is_set():
                        try:
                            pkt, addr = srv.recvfrom(128)
                            if pkt == b"FIRST_SIGHT_DISCOVER_1":
                                srv.sendto(b"FIRST_SIGHT_CAMERA_1", addr)
                        except socket.timeout:
                            continue
                        except OSError:
                            break

                t = threading.Thread(target=udp_responder, daemon=True)
                t.start()
                try:
                    responders = tcd.discover_udp_cameras(
                        ["127.0.0.1"],
                        udp_port=udp_port,
                        wait_seconds=0.6,
                        extra_targets=["127.0.0.1"],
                    )
                    self.assertIn("127.0.0.1", responders)
                finally:
                    stop_udp.set()
                    t.join(timeout=1.0)

            # Fast batch TCP port scanner detects open local port and skips closed one
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as closed_probe:
                closed_probe.bind(("127.0.0.1", 0))
                closed_port = closed_probe.getsockname()[1]
            self.assertEqual(tcd.scan_tcp_port_open_batch(["127.0.0.1"], port=cam_f.port, timeout=0.4), ["127.0.0.1"])
            self.assertEqual(tcd.scan_tcp_port_open_batch(["127.0.0.1"], port=closed_port, timeout=0.2), [])
        finally:
            cam_f.close()
            cam_l.close()
            cam_r.close()

    def test_campus_ipconfig_and_slash18_subnet_parsing(self) -> None:
        sample = (
            "Ethernet adapter vEthernet (WSL):\n"
            "   IPv4 Address. . . . . . . . . . . : 172.25.16.1\n"
            "   Subnet Mask . . . . . . . . . . . : 255.255.240.0\n"
            "Wireless LAN adapter WLAN:\n"
            "   IPv4 地址 . . . . . . . . . . . . : 10.122.202.64\n"
            "   子网掩码  . . . . . . . . . . . . : 255.255.192.0\n"
        )
        nets = tcd.parse_ipconfig_networks(sample)
        self.assertEqual(len(nets), 2)
        self.assertEqual(nets[0][0], "10.122.202.64")
        self.assertEqual(str(nets[0][1]), "10.122.192.0/18")
        self.assertEqual(nets[1][0], "172.25.16.1")

        hosts_18 = tcd.parse_subnet_spec("10.122.192.0/18")
        self.assertEqual(len(hosts_18), 16382)
        with self.assertRaises(ValueError):
            tcd.parse_subnet_spec("10.0.0.0/8")


if __name__ == "__main__":
    unittest.main()
