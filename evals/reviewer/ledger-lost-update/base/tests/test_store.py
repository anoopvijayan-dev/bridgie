import os
import tempfile
import unittest

from ledger.store import _read, append_entry


class Append(unittest.TestCase):
    def test_entries_are_kept_in_order(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "ledger.json")
            append_entry(path, {"id": "e1", "reconciled": False})
            append_entry(path, {"id": "e2", "reconciled": False})
            self.assertEqual([e["id"] for e in _read(path)], ["e1", "e2"])
