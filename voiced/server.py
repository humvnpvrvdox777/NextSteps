"""The HTTP face of the speaker: JSON on loopback, one secret header."""

import hmac
import itertools
import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .speaker import Speaker

HOST = "127.0.0.1"
MAX_TEXT = 4096
MAX_ID = 64
MAX_BODY = 64 * 1024
# A client that stops sending half way through a request must not hold its handler thread for ever.
READ_TIMEOUT = 10
METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS")


class _Rejected(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


class _Server(ThreadingHTTPServer):
    daemon_threads = True
    # Where the port is taken, fail instead of sharing it: the mod retries on another port.
    allow_reuse_address = False

    def __init__(self, address: tuple[str, int], speaker: Speaker, token: str) -> None:
        self.speaker = speaker
        self.token = token.encode("utf-8")
        self.ids = itertools.count(1)

        super().__init__(address, _Handler)

    def server_bind(self) -> None:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):  # Windows: nobody else may bind this port while we hold it
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)

        super().server_bind()


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"
    server_version = "voiced"
    sys_version = ""
    timeout = READ_TIMEOUT

    def log_message(self, *args) -> None:
        pass  # no access log: nothing here should end up in a file or on a screen

    def _serve(self, method: str) -> None:
        try:
            if not self._is_authorized():
                raise _Rejected(401, "unauthorized")

            route = ROUTES.get((method, self.path.split("?", 1)[0]))

            if route is None:
                raise _Rejected(404, "not found")

            self._reply(200, {"ok": True, **route(self)})
        except _Rejected as rejected:
            self._reply(rejected.status, {"ok": False, "error": rejected.message})

    def _is_authorized(self) -> bool:
        supplied = (self.headers.get("x-token") or "").encode("utf-8")

        return hmac.compare_digest(supplied, self.server.token)

    def _reply(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode("utf-8")

        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self) -> dict:
        try:
            length = int(self.headers.get("content-length") or 0)
        except ValueError:
            raise _Rejected(400, "bad Content-Length") from None

        if length > MAX_BODY:
            raise _Rejected(400, "body too large")

        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, RecursionError):  # too deeply nested is not JSON the daemon can read either
            raise _Rejected(400, "body is not JSON") from None

        if not isinstance(data, dict):
            raise _Rejected(400, "body must be a JSON object")

        return data

    def _speak(self) -> dict:
        body = self._json()
        text = body.get("text")

        if not isinstance(text, str) or not text.strip():
            raise _Rejected(400, "text must be a non-empty string")

        if len(text) > MAX_TEXT:
            raise _Rejected(400, "text is longer than %d characters" % MAX_TEXT)

        chunk_id = body.get("id")

        if chunk_id is None:
            chunk_id = "c%d" % next(self.server.ids)
        elif not isinstance(chunk_id, str) or not 0 < len(chunk_id) <= MAX_ID:
            raise _Rejected(400, "id must be a string of 1 to %d characters" % MAX_ID)

        return {"queued": self.server.speaker.submit(chunk_id, text.strip())}

    def _stop(self) -> dict:
        return {"dropped": self.server.speaker.stop()}

    def _status(self) -> dict:
        return self.server.speaker.status()

    def _quit(self) -> dict:
        # shutdown() waits for the serving loop, so it must not run on the thread that is answering.
        threading.Thread(target=self.server.shutdown, daemon=True).start()

        return {}


ROUTES = {
    ("POST", "/speak"): _Handler._speak,
    ("POST", "/stop"): _Handler._stop,
    ("GET", "/status"): _Handler._status,
    ("POST", "/quit"): _Handler._quit,
}

for _method in METHODS:
    setattr(_Handler, "do_" + _method, lambda self, method=_method: self._serve(method))


def make_server(speaker: Speaker, token: str, port: int) -> ThreadingHTTPServer:
    """A server on 127.0.0.1 only. `port` 0 picks a free one (tests)."""
    return _Server((HOST, port), speaker, token)
