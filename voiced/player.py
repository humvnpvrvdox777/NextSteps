"""Playback: a sound that can be cut short."""

import io
import os
import tempfile
import threading
import time
import wave
from typing import Protocol

TAIL_SECONDS = 0.03


class Player(Protocol):
    def play(self, wav: bytes) -> None:
        """Plays the sound; returns when it has ended or a purge cut it."""

    def purge(self) -> None:
        """Cuts the sound that is playing, at once. Harmless when nothing plays."""


def wav_seconds(data: bytes) -> float:
    with wave.open(io.BytesIO(data)) as handle:
        return handle.getnframes() / handle.getframerate()


class _Timer:
    """Waits for as long as a sound lasts and wakes early when a purge comes."""

    def __init__(self) -> None:
        self._cond = threading.Condition()
        self._purges = 0

    def mark(self) -> int:
        with self._cond:
            return self._purges

    def wait(self, mark: int, seconds: float) -> bool:
        """True when the time ran out, False when a purge came after `mark`."""
        deadline = time.monotonic() + seconds

        with self._cond:
            while self._purges == mark:
                remaining = deadline - time.monotonic()

                if remaining <= 0:
                    return True

                self._cond.wait(remaining)

        return False

    def cut(self) -> None:
        with self._cond:
            self._purges += 1
            self._cond.notify_all()


class NullPlayer:
    """Plays nothing, but takes the time the sound would take (divided by `speed`), so the speaker behaves as
    if it were speaking. For tests and measurements."""

    def __init__(self, speed: float = 1.0) -> None:
        self._speed = speed
        self._timer = _Timer()

    def play(self, wav: bytes) -> None:
        self._timer.wait(self._timer.mark(), wav_seconds(wav) / self._speed)

    def purge(self) -> None:
        self._timer.cut()


class WinsoundPlayer:
    """Windows playback with the standard library only. The sound starts from a temporary file and runs on its
    own, so a purge stops it within milliseconds. Measured on this machine: the call to start takes 5 ms, a purge
    8 ms; asynchronous playback from memory is refused, and a synchronous play from memory cannot be cut from
    another thread."""

    def __init__(self) -> None:
        import winsound

        self._winsound = winsound
        self._timer = _Timer()

    def play(self, wav: bytes) -> None:
        winsound = self._winsound
        mark = self._timer.mark()
        handle, path = tempfile.mkstemp(suffix=".wav", prefix="voiced-")

        try:
            with os.fdopen(handle, "wb") as file:
                file.write(wav)

            winsound.PlaySound(path, winsound.SND_FILENAME | winsound.SND_ASYNC)

            if not self._timer.wait(mark, wav_seconds(wav) + TAIL_SECONDS):
                # A purge that came before the sound had started would have missed it: cut it again.
                winsound.PlaySound(None, winsound.SND_PURGE)
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass

    def purge(self) -> None:
        self._winsound.PlaySound(None, self._winsound.SND_PURGE)
        self._timer.cut()
