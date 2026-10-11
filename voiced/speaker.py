"""The speaker: chunks of text in, one voice out, in order, with the next sounds made while one plays."""

import threading
import time
from collections import deque
from dataclasses import dataclass, field

from .engine import Engine
from .player import Player

CUT_TIMEOUT_SECONDS = 1.0
CUT_RETRY_SECONDS = 0.02
JOIN_TIMEOUT_SECONDS = 2.0


@dataclass
class _Chunk:
    id: str
    text: str
    epoch: int
    wavs: list[bytes] = field(default_factory=list)


class Speaker:
    """Two threads: one synthesizes up to `ahead` chunks beyond the one playing, one plays them in order.

    `stop` bumps an epoch. A chunk belongs to the epoch it was submitted in, so a synthesis still running when
    the stop came is thrown away when it ends, and a sound of an older epoch is never started."""

    def __init__(self, engine: Engine, player: Player, ahead: int = 3) -> None:
        self._engine = engine
        self._player = player
        self._ahead = ahead
        self._cond = threading.Condition()
        self._pending: deque[_Chunk] = deque()
        self._audio: deque[_Chunk] = deque()
        self._synthesizing: _Chunk | None = None
        self._playing: str | None = None
        self._sounding_epoch: int | None = None
        self._epoch = 0
        self._closed = False
        self._warm = False
        self._last_error: str | None = None
        self._threads = [
            threading.Thread(target=self._synthesize_loop, name="voiced-synthesis", daemon=True),
            threading.Thread(target=self._play_loop, name="voiced-playback", daemon=True),
        ]

        for thread in self._threads:
            thread.start()

    def mark_ready(self) -> None:
        with self._cond:
            self._warm = True

    def submit(self, chunk_id: str, text: str) -> int:
        """Queues a chunk and returns how many are waiting, not counting the one that plays."""
        with self._cond:
            if self._closed:
                return 0

            self._pending.append(_Chunk(chunk_id, text, self._epoch))
            self._cond.notify_all()

            return self._waiting()

    def stop(self) -> int:
        """Drops everything and cuts the sound; returns how many chunks would still have been spoken."""
        with self._cond:
            dropped = self._waiting() + (1 if self._playing is not None else 0)
            epoch = self._forget()

        self._cut_sound(epoch)

        return dropped

    def status(self) -> dict:
        with self._cond:
            waiting = self._waiting()

            return {
                "ready": self._warm,
                "speaking": self._playing is not None or waiting > 0,
                "queued": waiting,
                "playing": self._playing,
                "lastError": self._last_error,
            }

    def close(self) -> bool:
        """Stops for good. True when both threads ended in time."""
        with self._cond:
            self._closed = True
            epoch = self._forget()

        self._cut_sound(epoch)

        for thread in self._threads:
            thread.join(JOIN_TIMEOUT_SECONDS)

        return not any(thread.is_alive() for thread in self._threads)

    # Everything below runs with, or is called from code that holds, the lock where it says so.

    def _waiting(self) -> int:
        """Chunks submitted and not yet playing. Call with the lock held."""
        return len(self._pending) + len(self._audio) + (1 if self._synthesizing is not None else 0)

    def _forget(self) -> int:
        """Starts a new epoch and empties every queue. Call with the lock held; returns the new epoch."""
        self._epoch += 1
        self._pending.clear()
        self._audio.clear()
        self._synthesizing = None
        self._playing = None
        self._cond.notify_all()

        return self._epoch

    def _cut_sound(self, epoch: int) -> None:
        """Purges until no sound from before `epoch` is left. A purge that lands just before a sound starts
        misses it, so one purge is not enough."""
        deadline = time.monotonic() + CUT_TIMEOUT_SECONDS

        while True:
            self._player.purge()

            with self._cond:
                old = self._sounding_epoch is not None and self._sounding_epoch < epoch

                if not old or time.monotonic() > deadline:
                    return

                self._cond.wait(CUT_RETRY_SECONDS)

    def _synthesize_loop(self) -> None:
        while True:
            with self._cond:
                while not self._closed and not (self._pending and len(self._audio) < self._ahead):
                    self._cond.wait()

                if self._closed:
                    return

                chunk = self._pending.popleft()
                self._synthesizing = chunk

            wavs: list[bytes] = []
            error: str | None = None

            try:
                wavs = self._engine.synthesize(chunk.text)
            except Exception as exc:  # one bad chunk must not end the daemon
                error = "%s: %s" % (chunk.id, exc)

            with self._cond:
                if self._synthesizing is chunk:
                    self._synthesizing = None

                if chunk.epoch == self._epoch and not self._closed:
                    if error is not None:
                        self._last_error = error
                    elif wavs:
                        chunk.wavs = wavs
                        self._audio.append(chunk)

                self._cond.notify_all()

    def _play_loop(self) -> None:
        while True:
            with self._cond:
                while not self._closed and not self._audio:
                    self._cond.wait()

                if self._closed:
                    return

                chunk = self._audio.popleft()
                self._playing = chunk.id
                self._cond.notify_all()  # a slot is free for the synthesizer

            try:
                for wav in chunk.wavs:
                    with self._cond:
                        if self._epoch != chunk.epoch or self._closed:
                            break

                        self._sounding_epoch = chunk.epoch

                    try:
                        self._player.play(wav)
                    finally:
                        with self._cond:
                            self._sounding_epoch = None
                            self._cond.notify_all()
            except Exception as exc:
                with self._cond:
                    if chunk.epoch == self._epoch:
                        self._last_error = "%s: %s" % (chunk.id, exc)
            finally:
                with self._cond:
                    if chunk.epoch == self._epoch:
                        self._playing = None

                    self._cond.notify_all()
