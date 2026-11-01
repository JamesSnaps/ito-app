# Picnic Raid playtest harness

The simulator the rules in `../engine.py` were tuned with — kept so a rule
change can be tried against the same table before anyone plays it. It is
**not** the game: it's a separate, simpler model of the rules with switches
for every variant tried (`Rules` in `sim.py`), and five personalities (kid,
careful, greedy, sneaky, plus the controls: pacifist and hoarder).

    cd games/picnic/playtest
    python3 compare.py                # the rules as played, at family tables and against the controls
    python3 -c "from sim import *; from compare import BASE; print('\n'.join(table(Rules(**BASE), ['kid','careful','sneaky'], 1).lines))"
    python3 play_by_hand.py 77 '[]'   # play seat 0 yourself, a turn per call (it plays the earlier basket rule)

`compare.py`'s `BASE` is what the engine plays; `Rules()` with no switches is
the first draft. What to look at: no personality far from a fair share of wins (1.0),
the pacifist well under it (trapping must pay), the hoarder not over it,
seats even, and big moments per game.
