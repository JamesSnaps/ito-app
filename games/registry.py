"""The list of games the hub knows about.

Adding a game is: write games/<id>/game.py exposing a GAME spec, then
add it here. Everything else — room codes, joining, stats, QR — is shared.
"""

from dataclasses import dataclass
from typing import Callable, Optional

from flask import Blueprint


@dataclass(frozen=True)
class GameSpec:
    id: str
    name: str
    tagline: str
    blueprint: Blueprint
    # Colour the hub tints this game's card with, so the menu reads as two
    # different games rather than two rows of the same one.
    accent: str
    # Rooms are optional. A game that is one shared device on the table (the
    # Flip 7 scorekeeper) has no host and no players to route, so these are
    # None and nothing in the hub tries to build a room for it.
    new_room_state: Optional[Callable[[], dict]] = None
    # Where "start a game" lands, given a room code.
    host_endpoint: Optional[str] = None
    player_endpoint: Optional[str] = None
    available: bool = True

    @property
    def has_rooms(self):
        return self.player_endpoint is not None


def all_games():
    from games.flip7.game import GAME as FLIP7
    from games.ito.game import GAME as ITO

    return [ITO, FLIP7]


def playable_games():
    return [g for g in all_games() if g.available]


def get_game(game_id):
    for game in all_games():
        if game.id == game_id:
            return game
    return None
