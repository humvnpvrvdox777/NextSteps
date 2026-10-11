import http.client
import json
import socket
import threading
import time
import unittest
from unittest import mock

from voiced.server import HOST, MAX_TEXT, _Handler, make_server
from voiced.speaker import Speaker

from .fakes import FakeEngine, FakePlayer, wait_until

TOKEN = "t" * 32


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.engine = FakeEngine()
        self.player = FakePlayer(manual=True)
        self.speaker = Speaker(self.engine, self.player)
        self.speaker.mark_ready()
        self.server = make_server(self.speaker, TOKEN, 0)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close)

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.speaker.close()

    def call(self, method, path, body=None, token=TOKEN, raw=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {}

        if token is not None:
            headers["x-token"] = token

        payload = raw if raw is not None else (None if body is None else json.dumps(body))

        if payload is not None:
            headers["content-type"] = "application/json"

        connection.request(method, path, payload, headers)
        response = connection.getresponse()
        data = json.loads(response.read() or b"null")
        connection.close()

        return response.status, data

    def test_a_request_without_the_token_or_with_a_wrong_one_is_refused(self):
        self.assertEqual(self.call("GET", "/status", token=None)[0], 401)
        self.assertEqual(self.call("GET", "/status", token="wrong")[0], 401)
        self.assertEqual(self.call("POST", "/speak", {"text": "x"}, token="wrong")[0], 401)
        self.assertEqual(self.call("GET", "/nowhere", token="wrong")[0], 401)
        self.assertEqual(self.engine.requested, [])

    def test_the_token_is_never_echoed_in_a_reply(self):
        for token in (None, "wrong", TOKEN):
            _, data = self.call("GET", "/status", token=token)

            self.assertNotIn(TOKEN, json.dumps(data))

    def test_an_unknown_route_or_method_is_not_found(self):
        self.assertEqual(self.call("GET", "/nowhere")[0], 404)
        self.assertEqual(self.call("POST", "/status", {})[0], 404)
        self.assertEqual(self.call("GET", "/speak")[0], 404)
        self.assertEqual(self.call("DELETE", "/stop")[0], 404)

    def test_a_bad_speak_request_is_a_400_and_nothing_is_queued(self):
        bad = [
            {"raw": "not json"},
            {"raw": "[1, 2]"},
            {"raw": ""},
            {"body": {}},
            {"body": {"text": 7}},
            {"body": {"text": ""}},
            {"body": {"text": "   "}},
            {"body": {"text": "x" * (MAX_TEXT + 1)}},
            {"body": {"text": "ok", "id": 5}},
            {"body": {"text": "ok", "id": ""}},
            {"body": {"text": "ok", "id": "i" * 65}},
        ]

        for request in bad:
            status, data = self.call("POST", "/speak", **request)

            self.assertEqual((request, status, data["ok"]), (request, 400, False))

        self.assertEqual(self.engine.requested, [])

    def test_the_longest_allowed_text_is_accepted(self):
        status, data = self.call("POST", "/speak", {"id": "a", "text": "x" * MAX_TEXT})

        self.assertEqual((status, data["ok"]), (200, True))

    def test_speak_answers_with_the_queued_count_and_plays_in_order(self):
        status, data = self.call("POST", "/speak", {"id": "c0", "text": "uno"})

        self.assertEqual((status, data), (200, {"ok": True, "queued": 1}))

        wait_until(lambda: self.player.played == ["uno"], what="uno to play")

        status, data = self.call("POST", "/speak", {"id": "c1", "text": "due"})

        self.assertEqual((status, data["queued"]), (200, 1))

        self.player.finish_current()
        wait_until(lambda: self.player.played == ["uno", "due"], what="due to play")

    def test_a_chunk_without_an_id_gets_one(self):
        self.assertEqual(self.call("POST", "/speak", {"text": "uno"})[0], 200)
        wait_until(lambda: self.call("GET", "/status")[1]["playing"] is not None, what="a playing id")

    def test_status_reports_what_the_speaker_is_doing(self):
        status, data = self.call("GET", "/status")

        self.assertEqual(status, 200)
        self.assertEqual(
            data, {"ok": True, "ready": True, "speaking": False, "queued": 0, "playing": None, "lastError": None}
        )

        self.call("POST", "/speak", {"id": "c0", "text": "a"})
        self.call("POST", "/speak", {"id": "c1", "text": "b"})
        wait_until(lambda: self.call("GET", "/status")[1]["queued"] == 1, what="a playing and b waiting")

        data = self.call("GET", "/status")[1]

        self.assertTrue(data["speaking"])
        self.assertEqual(data["playing"], "c0")

        self.player.finish_current()
        self.player.finish_current()
        wait_until(lambda: not self.call("GET", "/status")[1]["speaking"], what="the end")

    def test_stop_drops_the_queue_and_status_reads_idle_at_once(self):
        for index in range(3):
            self.call("POST", "/speak", {"id": "c%d" % index, "text": "n%d" % index})

        wait_until(lambda: self.player.played == ["n0"], what="n0 to play")

        status, data = self.call("POST", "/stop", {})

        self.assertEqual((status, data), (200, {"ok": True, "dropped": 3}))

        data = self.call("GET", "/status")[1]

        self.assertEqual((data["speaking"], data["queued"], data["playing"]), (False, 0, None))
        self.assertGreaterEqual(self.player.purges, 1)

    def test_stop_needs_no_body(self):
        self.assertEqual(self.call("POST", "/stop")[0], 200)

    def test_an_oversized_body_is_refused_without_being_read(self):
        connection = socket.create_connection(("127.0.0.1", self.port), timeout=5)
        connection.sendall(
            b"POST /speak HTTP/1.1\r\nHost: x\r\nx-token: " + TOKEN.encode() + b"\r\n"
            b"Content-Type: application/json\r\nContent-Length: 1000000\r\n\r\n"
        )
        reply = connection.recv(4096)
        connection.close()

        self.assertIn(b" 400 ", reply.split(b"\r\n")[0])

    def test_a_body_nested_too_deep_for_the_json_parser_is_a_400_not_a_dropped_connection(self):
        # 60,000 brackets are under the size limit and over what the parser can recurse into.
        status, data = self.call("POST", "/speak", raw="[" * 60000)

        self.assertEqual((status, data["ok"]), (400, False))
        self.assertEqual(self.call("GET", "/status")[0], 200)

    def test_a_connection_that_goes_quiet_is_dropped_after_a_bounded_time(self):
        self.assertIsNotNone(_Handler.timeout)
        self.assertLessEqual(_Handler.timeout, 30)

    def test_a_body_that_never_arrives_does_not_hold_the_handler_for_ever(self):
        # The real limit is checked above; here a short one shows that the server really lets go at it.
        with mock.patch.object(_Handler, "timeout", 0.5):
            connection = socket.create_connection(("127.0.0.1", self.port), timeout=5)
            self.addCleanup(connection.close)
            connection.sendall(
                b"POST /speak HTTP/1.1\r\nHost: x\r\nx-token: " + TOKEN.encode() + b"\r\n"
                b"Content-Type: application/json\r\nContent-Length: 50\r\n\r\n" + b"x" * 14
            )

            started = time.monotonic()

            # The server gives up and closes: an empty read, well before the client's own five seconds.
            self.assertEqual(connection.recv(4096), b"")
            self.assertLess(time.monotonic() - started, 3)

        self.assertEqual(self.call("GET", "/status")[0], 200)

    def test_quit_answers_and_ends_the_serving_loop(self):
        status, data = self.call("POST", "/quit", {})

        self.assertEqual((status, data), (200, {"ok": True}))

        self.thread.join(3)

        self.assertFalse(self.thread.is_alive())


class BindTest(unittest.TestCase):
    def test_the_server_listens_on_loopback_only_and_the_port_is_exclusive(self):
        speaker = Speaker(FakeEngine(), FakePlayer())
        self.addCleanup(speaker.close)
        server = make_server(speaker, TOKEN, 0)
        self.addCleanup(server.server_close)

        self.assertEqual(HOST, "127.0.0.1")
        self.assertEqual(server.server_address[0], "127.0.0.1")

        port = server.server_address[1]

        with self.assertRaises(OSError):
            make_server(speaker, TOKEN, port)

        hijack = socket.socket()
        self.addCleanup(hijack.close)
        hijack.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

        with self.assertRaises(OSError):
            hijack.bind(("127.0.0.1", port))


if __name__ == "__main__":
    unittest.main()
