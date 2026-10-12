"""Threaded local review server with byte-range support for video seeking."""
import argparse
import functools
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class ReviewHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        self.byte_range = None
        path = self.translate_path(self.path)
        import os
        if not os.path.isfile(path):
            return super().send_head()
        file = open(path, 'rb')
        size = os.fstat(file.fileno()).st_size
        header = self.headers.get('Range')
        start, end = 0, size - 1
        if header:
            match = re.fullmatch(r'bytes=(\d*)-(\d*)', header)
            if not match or not any(match.groups()):
                file.close(); self.send_error(416); return None
            a, b = match.groups()
            if a:
                start = int(a); end = min(int(b), end) if b else end
            else:
                start = max(0, size - int(b))
            if start > end or start >= size:
                file.close(); self.send_response(416)
                self.send_header('Content-Range', f'bytes */{size}')
                self.send_header('Content-Length', '0'); self.end_headers(); return None
            self.byte_range = (start, end)
        self.send_response(206 if header else 200)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(end - start + 1))
        self.send_header('Cache-Control', 'no-cache')
        if header:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.end_headers()
        file.seek(start)
        return file

    def copyfile(self, source, outputfile):
        remaining = self.byte_range[1] - self.byte_range[0] + 1 if self.byte_range else None
        try:
            while remaining is None or remaining > 0:
                chunk = source.read(min(256 * 1024, remaining) if remaining is not None else 256 * 1024)
                if not chunk:
                    break
                outputfile.write(chunk)
                if remaining is not None:
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # Browser cancelled an old seek/download.


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', default='run/review-site')
    parser.add_argument('--port', type=int, default=8879)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), functools.partial(ReviewHandler, directory=args.directory))
    print(f'Review site: http://127.0.0.1:{args.port}/', flush=True)
    server.serve_forever()
