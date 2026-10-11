import glob
import os
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest import mock

from voiced.engine import wav_bytes
from voiced.player import NullPlayer, wav_seconds

PCM_ONE_SECOND = b"\x00\x00" * 22050
PCM_TENTH = b"\x00\x00" * 2205


class WavTest(unittest.TestCase):
    def test_wav_bytes_makes_a_valid_wav_of_the_given_format(self):
        import io
        import wave

        data = wav_bytes(PCM_ONE_SECOND, 22050, 2, 1)

        with wave.open(io.BytesIO(data)) as handle:
            self.assertEqual(
                (handle.getnchannels(), handle.getsampwidth(), handle.getframerate(), handle.getnframes()),
                (1, 2, 22050, 22050),
            )

    def test_wav_seconds_is_the_length_of_the_sound(self):
        self.assertAlmostEqual(wav_seconds(wav_bytes(PCM_ONE_SECOND, 22050, 2, 1)), 1.0, places=3)
        self.assertAlmostEqual(wav_seconds(wav_bytes(PCM_ONE_SECOND * 3, 22050, 2, 1)), 3.0, places=3)


class StubWinsound(types.ModuleType):
    """A winsound that plays nothing and records what it was asked, so the player can be tested anywhere."""

    SND_FILENAME = 0x20000
    SND_ASYNC = 0x1
    SND_PURGE = 0x40

    def __init__(self):
        super().__init__("winsound")
        self.calls = []
        self.files_at_play = []

    def PlaySound(self, sound, flags):
        self.calls.append((sound, flags))

        if sound is not None:
            self.files_at_play.append(os.path.exists(sound))


def winsound_player():
    stub = StubWinsound()

    with mock.patch.dict(sys.modules, {"winsound": stub}):
        from voiced.player import WinsoundPlayer

        return stub, WinsoundPlayer()


class WinsoundPlayerTest(unittest.TestCase):
    def test_a_sound_starts_asynchronously_from_a_file_that_exists_and_is_removed_after(self):
        stub, player = winsound_player()
        before = set(glob.glob(os.path.join(tempfile.gettempdir(), "voiced-*.wav")))

        player.play(wav_bytes(PCM_TENTH, 22050, 2, 1))

        sound, flags = stub.calls[0]

        self.assertTrue(sound.endswith(".wav"))
        self.assertEqual(flags, stub.SND_FILENAME | stub.SND_ASYNC)
        self.assertEqual(stub.files_at_play, [True])
        self.assertFalse(os.path.exists(sound))
        self.assertEqual(set(glob.glob(os.path.join(tempfile.gettempdir(), "voiced-*.wav"))), before)

    def test_a_purge_during_the_sound_ends_play_early_and_purges_the_device(self):
        stub, player = winsound_player()
        long_sound = wav_bytes(PCM_TENTH * 30, 22050, 2, 1)  # three seconds
        done = threading.Event()

        threading.Thread(target=lambda: (player.play(long_sound), done.set()), daemon=True).start()
        time.sleep(0.15)

        started = time.monotonic()

        player.purge()

        self.assertTrue(done.wait(1.0))
        self.assertLess(time.monotonic() - started, 0.5)
        self.assertIn((None, stub.SND_PURGE), stub.calls)
        # The player repeats the purge itself once its timer was cut, so a purge that landed too early is not lost.
        self.assertGreaterEqual(sum(1 for call in stub.calls if call == (None, stub.SND_PURGE)), 2)


class NullPlayerTest(unittest.TestCase):
    def test_it_takes_the_length_of_the_sound_divided_by_its_speed(self):
        player = NullPlayer(speed=20)
        started = time.monotonic()

        player.play(wav_bytes(PCM_ONE_SECOND, 22050, 2, 1))

        elapsed = time.monotonic() - started

        self.assertGreaterEqual(elapsed, 0.04)
        self.assertLess(elapsed, 0.5)

    def test_a_purge_ends_it_early(self):
        player = NullPlayer(speed=1)
        done = threading.Event()
        started = time.monotonic()

        def run():
            player.play(wav_bytes(PCM_ONE_SECOND * 5, 22050, 2, 1))
            done.set()

        threading.Thread(target=run, daemon=True).start()
        time.sleep(0.05)
        player.purge()

        self.assertTrue(done.wait(1.0))
        self.assertLess(time.monotonic() - started, 1.0)

    def test_a_purge_with_nothing_playing_does_not_cut_the_next_sound(self):
        player = NullPlayer(speed=20)

        player.purge()

        started = time.monotonic()
        player.play(wav_bytes(PCM_ONE_SECOND, 22050, 2, 1))

        self.assertGreaterEqual(time.monotonic() - started, 0.04)


if __name__ == "__main__":
    unittest.main()
