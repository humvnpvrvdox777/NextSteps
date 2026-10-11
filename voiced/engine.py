"""Speech synthesis: text in, WAV audio out."""

import io
import wave
from typing import Protocol


class Engine(Protocol):
    def synthesize(self, text: str) -> list[bytes]:
        """WAV bytes, one per piece of audio the voice produces for the text."""


def wav_bytes(pcm: bytes, rate: int, width: int, channels: int) -> bytes:
    buffer = io.BytesIO()

    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(channels)
        handle.setsampwidth(width)
        handle.setframerate(rate)
        handle.writeframes(pcm)

    return buffer.getvalue()


class PiperEngine:
    """Piper through its Python API. Piper is imported here, so importing this module stays cheap."""

    WARM_UP_TEXT = "Pronto."

    def __init__(self, model_path: str) -> None:
        from piper import PiperVoice

        self._voice = PiperVoice.load(model_path)

    def synthesize(self, text: str) -> list[bytes]:
        return [
            wav_bytes(chunk.audio_int16_bytes, chunk.sample_rate, chunk.sample_width, chunk.sample_channels)
            for chunk in self._voice.synthesize(text)
        ]

    def warm_up(self) -> None:
        # The first call loads the model into the ONNX session, which is most of the 4 s a cold start takes.
        self.synthesize(self.WARM_UP_TEXT)
