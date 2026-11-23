import json
import os
import time
from contextlib import contextmanager


@contextmanager
def locked(path, timeout=5.0):
    """One writer at a time: an exclusive lock file beside the ledger."""
    lock = path + ".lock"
    deadline = time.monotonic() + timeout
    while True:
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            break
        except FileExistsError:
            if time.monotonic() > deadline:
                raise TimeoutError(f"ledger is locked: {lock}")
            time.sleep(0.01)
    try:
        yield
    finally:
        os.close(fd)
        os.unlink(lock)


def _read(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _write(path, entries):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(entries, f)
    os.replace(tmp, path)


def append_entry(path, entry):
    with locked(path):
        entries = _read(path)
        entries.append(entry)
        _write(path, entries)
def mark_reconciled(path, entry_id):
    """Set the entry's reconciled flag. Returns False when there is no such entry."""
    entries = _read(path)
    for entry in entries:
        if entry["id"] == entry_id:
            entry["reconciled"] = True
            _write(path, entries)
            return True
    return False
