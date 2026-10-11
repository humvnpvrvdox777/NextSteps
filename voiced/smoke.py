"""Manual smoke test of the real daemon with the real voice. Silent by default: the sound is only timed.

    <python of the voice's venv> -m voiced.smoke --voice PATH [--loud]

It starts the daemon on a free loopback port, speaks three chunks, stops a long one, quits, and prints the
timings that matter: start-up, time to the first sound, gaps between chunks, how fast a stop reads idle.
"""

import argparse
import http.client
import json
import os
import queue
import secrets
import subprocess
import sys
import threading
import time

FIRST = "Ho letto la tua risposta, ecco come possiamo proseguire."
SECOND = "Ti propongo tre strade: continuare con i test, verificare il risultato oppure provare un approccio diverso."
THIRD = "Quale preferisci?"
LONG = "Questa è una frase volutamente lunga, per avere il tempo di fermarla a metà mentre la voce sta ancora parlando."


class Daemon:
    def __init__(self, voice: str, loud: bool) -> None:
        self.port = 0  # the system picks it; the daemon prints it with its ready line
        self.token = secrets.token_hex(16)
        command = [sys.executable, "-m", "voiced", "--port", "0", "--voice", voice]

        if not loud:
            command.append("--quiet")

        environment = {**os.environ, "VOICED_TOKEN": self.token}
        self.started = time.perf_counter()
        self.process = subprocess.Popen(
            command, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
        self.lines: queue.Queue[str] = queue.Queue()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self) -> None:
        for line in self.process.stdout:
            self.lines.put(line.strip())

    def wait_ready(self, timeout: float = 90.0) -> float:
        deadline = time.perf_counter() + timeout

        while time.perf_counter() < deadline:
            try:
                line = self.lines.get(timeout=0.2)

                if line.startswith("ready "):
                    self.port = int(line.split()[1])

                    return time.perf_counter() - self.started
            except queue.Empty:
                if self.process.poll() is not None:
                    raise RuntimeError("the daemon exited before it was ready: " + self.process.stderr.read())

        raise RuntimeError("the daemon was not ready in %.0f s" % timeout)

    def call(self, method: str, path: str, body: dict | None = None) -> dict:
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        headers = {"x-token": self.token}
        payload = None

        if body is not None:
            payload = json.dumps(body)
            headers["content-type"] = "application/json"

        connection.request(method, path, payload, headers)
        data = json.loads(connection.getresponse().read())
        connection.close()

        return data


def report(name: str, ok: bool, detail: str = "") -> bool:
    print("%-5s %s %s" % ("PASS" if ok else "FAIL", name, detail))

    return ok


def timeline(daemon: Daemon, seconds: float) -> list[tuple[float, str | None]]:
    """The id that was playing, each time it changed, as (seconds since the call, id)."""
    seen: list[tuple[float, str | None]] = []
    begin = time.perf_counter()

    while time.perf_counter() - begin < seconds:
        playing = daemon.call("GET", "/status")["playing"]

        if not seen or seen[-1][1] != playing:
            seen.append((time.perf_counter() - begin, playing))

        time.sleep(0.004)

    return seen


def silences_between_chunks(seen: list[tuple[float, str | None]]) -> list[float]:
    """How long nothing played between one chunk and the next. The wait before the first chunk is not a gap."""
    gaps: list[float] = []
    silent_since: float | None = None
    started = False

    for moment, chunk in seen:
        if chunk is None:
            if started and silent_since is None:
                silent_since = moment
        else:
            if silent_since is not None:
                gaps.append(moment - silent_since)

            silent_since = None
            started = True

    return gaps


def main() -> int:
    parser = argparse.ArgumentParser(prog="voiced.smoke")
    parser.add_argument("--voice", required=True)
    parser.add_argument("--loud", action="store_true", help="play the sound for real (about 15 s)")
    args = parser.parse_args()

    daemon = Daemon(args.voice, args.loud)
    results: list[bool] = []

    try:
        startup = daemon.wait_ready()
        status = daemon.call("GET", "/status")
        results.append(report("ready after start-up", status["ready"] is True, "(%.1f s from launch)" % startup))

        begin = time.perf_counter()
        daemon.call("POST", "/speak", {"id": "c1", "text": FIRST})
        first_audio = None

        while time.perf_counter() - begin < 10:
            if daemon.call("GET", "/status")["playing"] == "c1":
                first_audio = time.perf_counter() - begin
                break

            time.sleep(0.002)

        results.append(report("first sound starts", first_audio is not None, "(%.0f ms after the request)" % ((first_audio or 0) * 1000)))

        while daemon.call("GET", "/status")["speaking"]:
            time.sleep(0.01)

        daemon.call("POST", "/speak", {"id": "c1", "text": FIRST})
        daemon.call("POST", "/speak", {"id": "c2", "text": SECOND})
        daemon.call("POST", "/speak", {"id": "c3", "text": THIRD})
        seen = timeline(daemon, 22 if args.loud else 14)
        order = [chunk for _, chunk in seen if chunk is not None]
        results.append(report("three chunks play in order", order == ["c1", "c2", "c3"], str(order)))

        for index in range(len(seen) - 1):
            if seen[index][1] is not None:
                print("      %s plays %.2f s" % (seen[index][1], seen[index + 1][0] - seen[index][0]))

        gaps = silences_between_chunks(seen)
        gap_text = "(silences between chunks: %s ms)" % [round(gap * 1000) for gap in gaps]
        results.append(report("no audible gap between chunks", all(gap < 0.08 for gap in gaps), gap_text))

        daemon.call("POST", "/speak", {"id": "long", "text": LONG})

        while daemon.call("GET", "/status")["playing"] != "long":
            time.sleep(0.003)

        time.sleep(0.5)
        begin = time.perf_counter()
        dropped = daemon.call("POST", "/stop")["dropped"]
        after = daemon.call("GET", "/status")
        results.append(report("stop reads idle at once", after["speaking"] is False and after["playing"] is None, "(%.0f ms, dropped %d)" % ((time.perf_counter() - begin) * 1000, dropped)))
        time.sleep(0.4)
        results.append(report("nothing plays after a stop", daemon.call("GET", "/status")["speaking"] is False))

        daemon.call("POST", "/quit")

        try:
            code = daemon.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            code = None

        results.append(report("quit ends the process", code == 0, "(exit code %s)" % code))
        print(daemon.process.stderr.read().strip())
    finally:
        if daemon.process.poll() is None:
            daemon.process.kill()

    print("\n%d of %d checks passed" % (sum(results), len(results)))

    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
