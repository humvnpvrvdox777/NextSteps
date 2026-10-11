"""python -m voiced --port N --voice PATH [--quiet]: serves the voice on loopback until it is told to quit.

The secret comes from the environment (VOICED_TOKEN), never from the arguments, and is never printed."""

import argparse
import os
import sys
import threading
import time

from .engine import PiperEngine
from .parent import watch_parent
from .player import NullPlayer, WinsoundPlayer
from .server import HOST, make_server
from .speaker import Speaker

TOKEN_ENV = "VOICED_TOKEN"
MIN_TOKEN = 16


def _fail(code: int, message: str) -> int:
    print("voiced: " + message, file=sys.stderr, flush=True)

    return code


def main(argv: list[str] | None = None, make_engine=PiperEngine, parent_pid: int | None = None) -> int:
    parser = argparse.ArgumentParser(prog="voiced", description="A local voice daemon: Piper speaks, winsound plays.")
    parser.add_argument("--port", type=int, required=True, help="the loopback port to listen on; 0 lets the system pick")
    parser.add_argument("--voice", required=True, help="the Piper model (.onnx)")
    parser.add_argument("--quiet", action="store_true", help="synthesize and keep the time, but play nothing")
    args = parser.parse_args(argv)

    token = os.environ.get(TOKEN_ENV, "")

    if len(token) < MIN_TOKEN:
        return _fail(2, "set %s to a random secret of at least %d characters" % (TOKEN_ENV, MIN_TOKEN))

    started = time.perf_counter()

    try:
        engine = make_engine(args.voice)
    except Exception as error:  # a missing file, no Piper installed, a broken model
        return _fail(4, "cannot load the voice %s: %s" % (args.voice, error))

    try:
        player = NullPlayer() if args.quiet else WinsoundPlayer()
    except ImportError:
        return _fail(5, "playback needs Windows (winsound); use --quiet to run without sound")

    speaker = Speaker(engine, player)

    try:
        server = make_server(speaker, token, args.port)
    except OSError as error:
        speaker.close()

        return _fail(3, "cannot listen on %s:%d: %s" % (HOST, args.port, error))

    serving = threading.Thread(target=server.serve_forever, name="voiced-http", daemon=True)
    serving.start()

    # Whoever started the daemon owns it: when that process is gone, so is the daemon.
    watch_parent(os.getppid() if parent_pid is None else parent_pid, server.shutdown)

    loaded = time.perf_counter() - started
    engine.warm_up()
    warm = time.perf_counter() - started - loaded
    speaker.mark_ready()

    print("voiced: voice loaded in %.1f s, warm after %.1f s more" % (loaded, warm), file=sys.stderr, flush=True)
    print("ready %d" % server.server_address[1], flush=True)

    try:
        while serving.is_alive():
            serving.join(0.5)  # in slices, so that Ctrl+C gets through
    except KeyboardInterrupt:
        server.shutdown()

    speaker.close()
    server.server_close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
