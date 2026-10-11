import os
import subprocess
import sys
import threading
import time
import unittest

from voiced.parent import watch_parent

WINDOWS = os.name == "nt"


def sleeper(seconds: float) -> subprocess.Popen:
    return subprocess.Popen([sys.executable, "-c", "import time; time.sleep(%s)" % seconds])


@unittest.skipUnless(WINDOWS, "the parent is watched through the Windows process API")
class ParentTest(unittest.TestCase):
    def test_it_calls_back_once_the_watched_process_has_ended(self):
        child = sleeper(1.2)
        gone = threading.Event()
        self.addCleanup(child.wait)

        self.assertTrue(watch_parent(child.pid, gone.set))
        self.assertFalse(gone.wait(0.4), "the callback came while the process was still running")
        self.assertTrue(gone.wait(6), "the callback never came")

    def test_a_process_that_is_not_there_is_not_watched(self):
        finished = sleeper(0)
        finished.wait()
        time.sleep(0.3)

        self.assertFalse(watch_parent(0, lambda: None))
        self.assertFalse(watch_parent(-5, lambda: None))
        self.assertFalse(watch_parent(finished.pid + 400000, lambda: None))


if __name__ == "__main__":
    unittest.main()
