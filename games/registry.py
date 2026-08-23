"""The list of games the hub knows about.

Adding a game is: write games/<id>/game.py exposing a GAME spec, then
add it here. Everything else — room codes, joining, stats, QR — is shared.
"""

from dataclasses import dataclass
from typing import Callable

from flask import Blueprint


@dataclass(frozen=True)
class GameSpec:
    id: str
    name: str
    tagline: str
    blueprint: Blueprint
    new_room_state: Callable[[], dict]
    # Where "start a game" lands, given a room code.
    host_endpoint: str
    player_endpoint: str
    available: bool = True


def all_games():
    from games.ito.game import GAME as ITO

    return [ITO]


def playable_games():
    return [g for g in all_games() if g.available]


def get_game(game_id):
    for game in all_games():
        if game.id == game_id:
            return game
    return None
