#!/usr/bin/env python3
"""OpenOS dev server — static files with caching disabled.

ES modules are cached aggressively by browsers; during development that means
an edited module keeps running the old code. This server answers every request
with `Cache-Control: no-store`, so a plain reload always picks up the change.
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.osh': 'text/plain; charset=utf-8',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):          # quieter console
        if '200' not in (args[1] if len(args) > 1 else ''):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    # Ortamdaki PORT, harness'ın atadığı bağlantı noktasını verir; komut
    # satırı argümanı onu ezer, ikisi de yoksa 8080'e düşülür.
    import os
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT') or 8080)
    handler = partial(NoCacheHandler, directory='.')
    print(f'OpenOS  site →  http://localhost:{port}/')
    print(f'OpenOS   os  →  http://localhost:{port}/os/     (önbellek kapalı)')
    ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
