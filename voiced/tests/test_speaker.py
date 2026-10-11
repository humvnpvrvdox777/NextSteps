import time
import unittest

from voiced.speaker import Speaker

from .fakes import FakeEngine, FakePlayer, wait_until

IDLE = {"ready": False, "speaking": False, "queued": 0, "playing": None, "lastError": None}


class SpeakerTest(unittest.TestCase):
    def make(self, ahead: int = 3, manual: bool = False, lose_purges: int = 0, player=None):
        self.engine = FakeEngine()
        self.player = player or FakePlayer(manual=manual, lose_purges=lose_purges)
        self.speaker = Speaker(self.engine, self.player, ahead=ahead)
        self.addCleanup(self.speaker.close)

        return self.speaker

    def test_chunks_play_in_the_order_they_were_submitted(self):
        speaker = self.make()

        for index, text in enumerate(["uno", "due", "tre"]):
            speaker.submit("c%d" % index, text)

        wait_until(lambda: self.player.played == ["uno", "due", "tre"], what="three chunks played")
        wait_until(lambda: not speaker.status()["speaking"], what="the speaker to go idle")

    def test_submit_says_how_many_chunks_are_waiting(self):
        speaker = self.make(manual=True)
        gate = self.engine.hold("a")

        self.assertEqual(speaker.submit("c0", "a"), 1)
        self.assertEqual(speaker.submit("c1", "b"), 2)

        gate.set()
        wait_until(lambda: self.player.played == ["a"], what="a to start playing")
        wait_until(lambda: speaker.status()["queued"] == 1, what="b to wait alone")

    def test_status_follows_a_chunk_from_waiting_to_playing_to_done(self):
        speaker = self.make(manual=True)

        self.assertEqual(speaker.status(), IDLE)

        speaker.submit("c0", "a")
        speaker.submit("c1", "b")
        wait_until(lambda: self.player.played == ["a"], what="a to play")
        wait_until(lambda: speaker.status()["queued"] == 1, what="b to wait")

        status = speaker.status()

        self.assertTrue(status["speaking"])
        self.assertEqual(status["playing"], "c0")

        self.player.finish_current()
        wait_until(lambda: speaker.status()["playing"] == "c1", what="b to play")
        self.assertEqual(speaker.status()["queued"], 0)

        self.player.finish_current()
        wait_until(lambda: not speaker.status()["speaking"], what="the end")
        self.assertIsNone(speaker.status()["playing"])

    def test_it_is_speaking_from_the_moment_a_chunk_is_submitted_even_while_it_is_still_being_made(self):
        speaker = self.make()
        gate = self.engine.hold("slow")

        speaker.submit("c0", "slow")

        status = speaker.status()

        self.assertTrue(status["speaking"])
        self.assertIsNone(status["playing"])

        gate.set()
        wait_until(lambda: self.player.played == ["slow"], what="the chunk to play")
        wait_until(lambda: not speaker.status()["speaking"], what="the end")

    def test_ready_is_set_by_the_daemon_once_the_voice_is_warm(self):
        speaker = self.make()

        speaker.mark_ready()

        self.assertTrue(speaker.status()["ready"])

    def test_stop_drops_what_waits_cuts_the_sound_and_reads_idle_at_once(self):
        speaker = self.make(manual=True)

        for index, text in enumerate(["a", "b", "c"]):
            speaker.submit("c%d" % index, text)

        wait_until(lambda: self.player.played == ["a"], what="a to play")

        self.assertEqual(speaker.stop(), 3)
        self.assertEqual(speaker.status(), IDLE)
        self.assertGreaterEqual(self.player.purges, 1)
        wait_until(lambda: not self.player.is_playing(), what="the sound to end")

        speaker.submit("c3", "marker")
        wait_until(lambda: self.player.played == ["a", "marker"], what="only the marker after the stop")

    def test_a_synthesis_in_flight_when_stopped_is_never_played(self):
        speaker = self.make()
        gate = self.engine.hold("slow")

        speaker.submit("c0", "slow")
        wait_until(lambda: self.engine.requested == ["slow"], what="the synthesis to start")

        self.assertEqual(speaker.stop(), 1)
        self.assertEqual(speaker.status(), IDLE)

        gate.set()
        speaker.submit("c1", "after")
        wait_until(lambda: self.player.played == ["after"], what="the next chunk")
        self.assertEqual(self.player.played, ["after"])

    def test_synthesis_runs_ahead_of_playback_by_at_most_ahead_chunks(self):
        speaker = self.make(ahead=3, manual=True)

        for index in range(6):
            speaker.submit("c%d" % index, "n%d" % index)

        wait_until(lambda: self.engine.requested == ["n0", "n1", "n2", "n3"], what="three chunks ahead")
        time.sleep(0.15)
        self.assertEqual(self.engine.requested, ["n0", "n1", "n2", "n3"])

        self.player.finish_current()
        wait_until(lambda: len(self.engine.requested) == 5, what="one more once a slot is free")
        time.sleep(0.1)
        self.assertEqual(self.engine.requested, ["n0", "n1", "n2", "n3", "n4"])

    def test_an_engine_error_is_reported_and_does_not_stop_the_speaker(self):
        speaker = self.make()
        self.engine.fails.add("bad")

        speaker.submit("c0", "bad")
        speaker.submit("c1", "good")

        wait_until(lambda: self.player.played == ["good"], what="the chunk after the failure")
        self.assertIn("bad", speaker.status()["lastError"])

    def test_a_player_error_is_reported_and_does_not_stop_the_speaker(self):
        class Exploding(FakePlayer):
            def play(self, wav):
                super().play(wav)

                if self.played[-1] == "boom":
                    raise OSError("sound card gone")

        speaker = self.make(player=Exploding())

        speaker.submit("c0", "boom")
        speaker.submit("c1", "fine")

        wait_until(lambda: self.player.played == ["boom", "fine"], what="the chunk after the failure")
        self.assertIn("sound card gone", speaker.status()["lastError"])

    def test_a_chunk_of_several_audio_parts_plays_all_of_them_in_order(self):
        speaker = self.make()
        self.engine.parts["x"] = ["x1", "x2", "x3"]

        speaker.submit("c0", "x")

        wait_until(lambda: self.player.played == ["x1", "x2", "x3"], what="three parts")

    def test_a_stop_between_the_parts_of_a_chunk_skips_the_rest(self):
        speaker = self.make(manual=True)
        self.engine.parts["x"] = ["x1", "x2", "x3"]

        speaker.submit("c0", "x")
        wait_until(lambda: self.player.played == ["x1"], what="the first part")
        speaker.stop()
        wait_until(lambda: not self.player.is_playing(), what="the first part to end")

        speaker.submit("c1", "marker")
        wait_until(lambda: self.player.played == ["x1", "marker"], what="the marker without x2 and x3")

    def test_a_purge_that_arrives_before_the_sound_starts_is_repeated_until_it_takes(self):
        speaker = self.make(manual=True, lose_purges=1)

        speaker.submit("c0", "a")
        wait_until(lambda: self.player.played == ["a"], what="a to play")
        speaker.stop()

        self.assertFalse(self.player.is_playing())
        self.assertGreaterEqual(self.player.purges, 2)

    def test_a_cut_does_not_fight_a_sound_that_started_after_the_stop(self):
        speaker = self.make()

        with speaker._cond:
            speaker._sounding_epoch = 1  # a sound of the epoch that the stop has just begun

        started = time.monotonic()
        speaker._cut_sound(1)

        self.assertEqual(self.player.purges, 1)
        self.assertLess(time.monotonic() - started, 0.5)

        with speaker._cond:
            speaker._sounding_epoch = None

    def test_stop_with_nothing_to_stop_is_harmless(self):
        speaker = self.make()

        self.assertEqual(speaker.stop(), 0)
        self.assertEqual(speaker.status(), IDLE)

    def test_close_ends_the_threads_and_ignores_later_chunks(self):
        speaker = self.make()

        self.assertTrue(speaker.close())
        self.assertEqual(speaker.submit("c0", "late"), 0)
        self.assertEqual(self.engine.requested, [])


if __name__ == "__main__":
    unittest.main()
