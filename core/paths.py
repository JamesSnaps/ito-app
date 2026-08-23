"""Where the flat-file state lives. One place so Docker only mounts one dir."""

from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
STATS_PATH = DATA_DIR / "stats.json"


def game_data_dir(game_id):
    """Per-game data directory, e.g. data/ito/. Created on demand."""
    path = DATA_DIR / game_id
    path.mkdir(parents=True, exist_ok=True)
    return path
