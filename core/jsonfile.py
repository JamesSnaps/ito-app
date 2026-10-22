"""Crash-safe JSON files for the flat-file state under data/.

Both stats.json and topics.json used to be rewritten in place: a crash, a
full disk or a container stop mid-write left half a file, and the next read
treated that as empty — so the next save wrote "empty plus one game" over the
whole history. Two rules stop that:

- Writes go to a temp file in the same directory and are swapped in with
  `os.replace`, which is atomic on one filesystem. A reader sees the old file
  or the new one, never a torn one.
- The previous good copy is kept as `<name>.bak` before each swap, so a file
  that does get mangled (by hand, usually) has something to come back from.

Reading is the caller's business: what to do with a corrupt file differs —
stats must refuse to write over it, topics can fall back to the backup.
"""

import json
import os
import shutil
import tempfile
from pathlib import Path


class Unreadable(Exception):
    """The file exists but isn't the JSON we expected. Never write over it."""


class DataUnavailable(Exception):
    """Raised by a game or by stats when its file (and backup) can't be used.

    app.py turns it into a 503 that says which file, so no game has to
    register its own handler — adding a game still doesn't touch app.py."""


def backup_path(path):
    path = Path(path)
    return path.with_name(path.name + ".bak")


def read(path):
    """Parse a JSON file. Missing → FileNotFoundError; corrupt → Unreadable."""
    path = Path(path)
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise Unreadable(f"{path.name} could not be read: {exc}") from exc


def write(path, data):
    """Atomically replace `path` with `data`, keeping the old copy as .bak.

    Callers only write after a successful read, so whatever is on disk at this
    point is a good copy and is what the backup gets.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        # mkstemp makes the file 0600; keep the mode the old file had, so a
        # rewrite doesn't quietly lock the owner out of their own data dir.
        os.chmod(tmp, path.stat().st_mode & 0o777 if path.exists() else 0o644)
        if path.exists():
            shutil.copy2(path, backup_path(path))
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise
