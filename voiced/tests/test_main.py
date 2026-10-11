import contextlib
import http.client
import io
import json
import os
import threading
import unittest
from unittest import mock

from voiced.__main__ import TOKEN_ENV, main

TOKEN = "s3cret-" + "x" * 24


def run(argv, token=TOKEN):
    environment = {} if token is None else {TOKEN_ENV: token}
    errors = io.StringIO()
    output = io.StringIO()

    with mock.patch.dict(os.environ, environment, clear=False):
        if token is None:
            os.environ.pop(TOKEN_ENV, None)

        with contextlib.redirect_stderr(errors), contextlib.redirect_stdout(output):
            code = main(argv)

    return code, output.getvalue(), errors.getvalue()


class FakeVoice:
    """Stands in for Piper: nothing to load, nothing to say."""

    def __init__(self, path):
        self.path = path

    def synthesize(self, text):
        return []

    def warm_up(self):
        pass


class Watched(io.StringIO):
    """A stdout that says when the daemon has printed its ready line."""

    def __init__(self):
        super().__init__()
        self.ready = threading.Event()

    def write(self, text):
        written = super().write(text)

        if "ready " in self.getvalue():
            self.ready.set()

        return written


class MainTest(unittest.TestCase):
    def test_it_serves_on_the_port_it_prints_and_quits_when_told(self):
        output = Watched()
        result = {}

        def serve():
            with mock.patch.dict(os.environ, {TOKEN_ENV: TOKEN}), contextlib.redirect_stdout(output), contextlib.redirect_stderr(io.StringIO()):
                result["code"] = main(["--port", "0", "--voice", "fake.onnx", "--quiet"], make_engine=FakeVoice)

        thread = threading.Thread(target=serve, daemon=True)
        thread.start()

        self.assertTrue(output.ready.wait(5), "the daemon never printed ready")

        line = output.getvalue().strip()
        port = int(line.split()[1])

        def call(method, path):
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            connection.request(method, path, headers={"x-token": TOKEN})
            response = connection.getresponse()
            body = json.loads(response.read())
            connection.close()

            return response.status, body

        status, body = call("GET", "/status")

        self.assertEqual((status, body["ok"], body["ready"]), (200, True, True))
        self.assertEqual(call("POST", "/quit")[0], 200)

        thread.join(5)

        self.assertFalse(thread.is_alive())
        self.assertEqual(result["code"], 0)
        self.assertEqual(line, "ready %d" % port)
        self.assertGreater(port, 0)

    @unittest.skipUnless(os.name == "nt", "the parent is watched through the Windows process API")
    def test_it_quits_by_itself_when_the_process_that_started_it_is_gone(self):
        import subprocess
        import sys

        parent = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(1.5)"])
        self.addCleanup(parent.wait)

        output = Watched()
        result = {}

        def serve():
            with mock.patch.dict(os.environ, {TOKEN_ENV: TOKEN}), contextlib.redirect_stdout(output), contextlib.redirect_stderr(io.StringIO()):
                result["code"] = main(["--port", "0", "--voice", "fake.onnx", "--quiet"], make_engine=FakeVoice, parent_pid=parent.pid)

        thread = threading.Thread(target=serve, daemon=True)
        thread.start()

        self.assertTrue(output.ready.wait(5), "the daemon never printed ready")
        self.assertTrue(thread.is_alive(), "the daemon quit while its parent was still there")

        thread.join(8)

        self.assertFalse(thread.is_alive(), "the daemon outlived its parent")
        self.assertEqual(result["code"], 0)

    def test_it_refuses_to_start_without_a_token(self):
        code, output, errors = run(["--port", "0", "--voice", "none.onnx"], token=None)

        self.assertEqual(code, 2)
        self.assertIn(TOKEN_ENV, errors)
        self.assertEqual(output, "")

    def test_it_refuses_a_token_that_is_too_short(self):
        code, _, errors = run(["--port", "0", "--voice", "none.onnx"], token="short")

        self.assertEqual(code, 2)
        self.assertNotIn("short", errors.replace("too short", ""))

    def test_a_voice_that_cannot_be_loaded_is_reported_without_the_token(self):
        code, output, errors = run(["--port", "0", "--voice", "missing-voice.onnx", "--quiet"])

        self.assertEqual(code, 4)
        self.assertEqual(output, "")
        self.assertNotIn(TOKEN, errors)
        self.assertIn("voice", errors)


if __name__ == "__main__":
    unittest.main()
