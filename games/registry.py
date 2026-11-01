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
    # Rooms are optional, and the two halves are independent. A game whose
    # room is started from the hub sets host_endpoint (ito); a game whose room
    # is only ever opened from inside the game leaves it None (Flip 7 shares
    # a spectator room from the scorekeeper). player_endpoint is what a code
    # typed at /join resolves to, so it's the one that makes a game joinable.
    new_room_state: Optional[Callable[[], dict]] = None
    # Where "start a game" lands, given a room code.
    host_endpoint: Optional[str] = None
    player_endpoint: Optional[str] = None
    # The tile's call to action when it doesn't start a room.
    hub_action: str = "Open"
    available: bool = True
    # The iOS app has a screen of its own for this game. Games without one
    # are still in the app: /api/games lists them, and the app opens their
    # web page full screen (app 1.16.0) — so a new web game reaches the app
    # with no app update.
    native_app: bool = False

    @property
    def has_rooms(self):
        """Can a code for this game be typed in at /join?"""
        return self.player_endpoint is not None

    @property
    def starts_rooms(self):
        """Does the hub tile start a room, or just open the game?"""
        return self.host_endpoint is not None


def all_games():
    from games.final_approach.game import GAME as FINAL_APPROACH
    from games.final_vector.game import GAME as FINAL_VECTOR
    from games.flip7.game import GAME as FLIP7
    from games.fugitive.game import GAME as FUGITIVE
    from games.gem_delve.game import GAME as GEM_DELVE
    from games.ito.game import GAME as ITO
    from games.picnic.game import GAME as PICNIC
    from games.wildwood.game import GAME as WILDWOOD

    return [ITO, FLIP7, FUGITIVE, WILDWOOD, FINAL_APPROACH, PICNIC, FINAL_VECTOR, GEM_DELVE]


def playable_games():
    return [g for g in all_games() if g.available]


def get_game(game_id):
    for game in all_games():
        if game.id == game_id:
            return game
    return None
