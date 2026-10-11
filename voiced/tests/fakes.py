"""Test doubles for the speaker: an engine and a player the tests can hold, release and cut."""

import io
import threading
import time
import wave


def wav_of(text: str) -> bytes:
    """A valid mono 16-bit WAV whose samples are the text, so a player can tell what it was given."""
    data = text.encode("utf-8")

    if len(data) % 2:
        data += b" "

    buffer = io.BytesIO()

    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(22050)
        handle.writeframes(data)

    return buffer.getvalue()


def text_of(wav: bytes) -> str:
    with wave.open(io.BytesIO(wav)) as handle:
        return handle.readframes(handle.getnframes()).decode("utf-8").rstrip(" ")


def wait_until(predicate, timeout: float = 3.0, what: str = "the condition") -> None:
    deadline = time.monotonic() + timeout

    while time.monotonic() < deadline:
        if predicate():
            return

        time.sleep(0.004)

    raise AssertionError("timed out waiting for " + what)


class FakeEngine:
    """Synthesizes at once unless a text is held; records every request in order."""

    def __init__(self) -> None:
        self.requested: list[str] = []
        self.fails: set[str] = set()
        self.parts: dict[str, list[str]] = {}
        self._gates: dict[str, threading.Event] = {}
        self._lock = threading.Lock()

    def hold(self, text: str) -> threading.Event:
        """Makes the next synthesis of `text` wait until the returned event is set."""
        gate = threading.Event()
        self._gates[text] = gate

        return gate

    def synthesize(self, text: str) -> list[bytes]:
        with self._lock:
            self.requested.append(text)

        gate = self._gates.get(text)

        if gate is not None and not gate.wait(5):
            raise AssertionError("a held synthesis was never released")

        if text in self.fails:
            raise RuntimeError("cannot synthesize " + text)

        return [wav_of(part) for part in self.parts.get(text, [text])]


class FakePlayer:
    """Plays at once or, when manual, keeps each sound going until the test finishes it or a purge cuts it."""

    def __init__(self, manual: bool = False, lose_purges: int = 0) -> None:
        self.manual = manual
        self.played: list[str] = []
        self.purges = 0
        self._lose = lose_purges
        self._cond = threading.Condition()
        self._current: str | None = None
        self._cut = False
        self._finish = 0

    def play(self, wav: bytes) -> None:
        text = text_of(wav)

        with self._cond:
            self.played.append(text)
            self._current = text
            self._cond.notify_all()

            if self.manual:
                deadline = time.monotonic() + 5

                while self._finish == 0 and not self._cut:
                    if time.monotonic() > deadline:
                        raise AssertionError("a sound was never finished or cut")

                    self._cond.wait(0.05)

                if not self._cut:
                    self._finish -= 1

            self._cut = False
            self._current = None
            self._cond.notify_all()

    def purge(self) -> None:
        with self._cond:
            self.purges += 1

            if self._lose > 0:
                self._lose -= 1

                return

            if self._current is not None:
                self._cut = True
                self._cond.notify_all()

    def finish_current(self) -> None:
        with self._cond:
            self._finish += 1
            self._cond.notify_all()

    def is_playing(self) -> bool:
        with self._cond:
            return self._current is not None
