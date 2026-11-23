import os
import tempfile
import unittest

from ledger.store import _read, append_entry, mark_reconciled


class Append(unittest.TestCase):
    def test_entries_are_kept_in_order(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "ledger.json")
            append_entry(path, {"id": "e1", "reconciled": False})
            append_entry(path, {"id": "e2", "reconciled": False})
            self.assertEqual([e["id"] for e in _read(path)], ["e1", "e2"])


class MarkReconciled(unittest.TestCase):
    def test_only_the_named_entry_changes(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "ledger.json")
            append_entry(path, {"id": "e1", "reconciled": False})
            append_entry(path, {"id": "e2", "reconciled": False})
            self.assertTrue(mark_reconciled(path, "e2"))
            self.assertEqual(_read(path), [{"id": "e1", "reconciled": False}, {"id": "e2", "reconciled": True}])

    def test_unknown_entry_changes_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "ledger.json")
            append_entry(path, {"id": "e1", "reconciled": False})
            self.assertFalse(mark_reconciled(path, "nope"))
            self.assertEqual(_read(path), [{"id": "e1", "reconciled": False}])
