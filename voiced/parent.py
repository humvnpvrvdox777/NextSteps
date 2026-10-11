"""Ends the daemon when the process that started it is gone, so that a host that dies leaves no daemon behind."""

import ctypes
import os
import threading
from collections.abc import Callable

SYNCHRONIZE = 0x00100000
INFINITE = 0xFFFFFFFF


def watch_parent(pid: int, on_gone: Callable[[], None]) -> bool:
    """Calls `on_gone` once, from its own thread, when process `pid` has ended.

    Returns False when it cannot watch: not Windows, no such process, no right to wait for it. A daemon whose
    parent cannot be watched simply lives until it is told to quit."""
    if os.name != "nt" or pid <= 0:
        return False

    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
    kernel32.OpenProcess.restype = ctypes.c_void_p
    kernel32.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel32.OpenProcess(SYNCHRONIZE, False, pid)

    if not handle:
        return False

    def wait() -> None:
        kernel32.WaitForSingleObject(handle, INFINITE)
        kernel32.CloseHandle(handle)
        on_gone()

    threading.Thread(target=wait, name="voiced-parent", daemon=True).start()

    return True
