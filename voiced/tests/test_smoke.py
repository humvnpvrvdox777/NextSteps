import unittest

from voiced.smoke import silences_between_chunks


class SilencesTest(unittest.TestCase):
    def test_the_wait_before_the_first_chunk_is_not_a_gap(self):
        self.assertEqual(silences_between_chunks([(0.0, None), (0.8, "c1"), (4.0, "c2"), (9.0, None)]), [])

    def test_a_silence_between_two_chunks_is_measured(self):
        seen = [(0.0, None), (0.8, "c1"), (4.0, None), (4.5, "c2")]

        self.assertEqual(silences_between_chunks(seen), [0.5])

    def test_each_silence_counts_once_however_often_it_was_seen(self):
        seen = [(0.0, None), (0.8, "c1"), (4.0, None), (4.1, None), (4.6, "c2"), (6.0, None), (6.2, "c3")]

        self.assertEqual([round(gap, 2) for gap in silences_between_chunks(seen)], [0.6, 0.2])

    def test_the_silence_after_the_last_chunk_is_not_a_gap(self):
        self.assertEqual(silences_between_chunks([(0.0, "c1"), (3.0, None)]), [])

    def test_nothing_played_gives_no_gaps(self):
        self.assertEqual(silences_between_chunks([]), [])
        self.assertEqual(silences_between_chunks([(0.0, None)]), [])


if __name__ == "__main__":
    unittest.main()
