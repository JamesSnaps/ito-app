"""Give each test run its own topics.json and stats.json.

Topic edits and results are writes to real files; without this the suite
would slowly mangle the actual topic list.
"""

import json
import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


@pytest.fixture(autouse=True)
def isolated_data(tmp_path, monkeypatch):
    from core import paths, stats
    from games.ito import game

    topics = tmp_path / "topics.json"
    shutil.copy(ROOT / "games" / "ito" / "default_topics.json", topics)
    monkeypatch.setattr(game, "TOPICS_PATH", topics)

    stats_file = tmp_path / "stats.json"
    stats_file.write_text(json.dumps({}))
    monkeypatch.setattr(paths, "STATS_PATH", stats_file)
    monkeypatch.setattr(stats, "STATS_PATH", stats_file)

    # The guess throttle is a module-level singleton: without this, failed
    # lookups in one test count against the next one.
    from core.ratelimit import GuessThrottle
    import core.ratelimit as ratelimit
    from app import code_guesses as app_throttle  # noqa: F401

    fresh = GuessThrottle()
    monkeypatch.setattr(ratelimit, "code_guesses", fresh)
    monkeypatch.setattr("app.code_guesses", fresh)
    monkeypatch.setattr("games.ito.game.code_guesses", fresh)
    yield
