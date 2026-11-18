"""Kalsa's guarded entry point for mlx_lm.server 0.32.2.

The key arrives in KALSA_ENGINE_KEY, never in argv. The handler is wrapped at
parse_request time so no upstream request is answered without a valid Bearer
key and a loopback Host for this exact port.
"""

import hmac
import os
import sys

from mlx_lm import server


def _port_from_argv():
    for index, argument in enumerate(sys.argv):
        if argument == "--port" and index + 1 < len(sys.argv):
            return int(sys.argv[index + 1])
    raise SystemExit("Kalsa: missing --port")


PORT = _port_from_argv()
KEY = os.environ.get("KALSA_ENGINE_KEY", "")
if not KEY:
    raise SystemExit("Kalsa: missing engine key")
EXPECTED_HOSTS = (f"127.0.0.1:{PORT}", f"localhost:{PORT}")


class GuardedHandler(server.APIHandler):
    def parse_request(self):
        if not super().parse_request():
            return False
        host = (self.headers.get("Host") or "").lower()
        authorization = self.headers.get("Authorization") or ""
        supplied = authorization[7:] if authorization.startswith("Bearer ") else ""
        try:
            authorized = hmac.compare_digest(supplied, KEY)
        except TypeError:
            authorized = False
        # Browsers only: the M4 chat will call engines through Rust, never fetch()
        # with an Origin header. Refuse cross-origin use outright.
        if self.headers.get("Origin") is not None or host not in EXPECTED_HOSTS or not authorized:
            body = b'{"error":"unauthorized"}'
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)
            self.close_connection = True
            return False
        return True


def guarded_run(host, port, model_provider, *args, **kwargs):
    prompt_cache = server.LRUPromptCache(model_provider.cli_args.prompt_cache_size)
    generator = server.ResponseGenerator(model_provider, prompt_cache)
    server._run_http_server(host, port, generator, handler_class=GuardedHandler)


server.run = guarded_run
server.main()
