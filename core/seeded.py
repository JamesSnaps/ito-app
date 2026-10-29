"""Seeded randomness a Swift port can repeat exactly.

mulberry32, 32-bit state: the same generator as fugitive.js's mulberry32 and
the iOS app's `Seeded`. Fugitive's and Wildwood's computer opponents choose
with it, and Wildwood reshuffles its discard pile with it, so the app's
offline games make the same choices as the server from the same seed. Every
draw is an integer pick, never a weighted float sum, so nothing can round
differently in Swift.
"""


class Mulberry32:
    """mulberry32, 32-bit state. `below(n)` is the only way anything draws."""

    def __init__(self, seed):
        self.a = seed & 0xFFFFFFFF

    def next(self):
        self.a = (self.a + 0x6D2B79F5) & 0xFFFFFFFF
        t = self.a
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return (t ^ (t >> 14)) & 0xFFFFFFFF

    def below(self, n):
        """An integer in [0, n)."""
        return self.next() % n

    def pick(self, options):
        return options[self.below(len(options))]

    def shuffle(self, items):
        """Fisher–Yates in place, from the end, one `below` per swap."""
        for i in range(len(items) - 1, 0, -1):
            j = self.below(i + 1)
            items[i], items[j] = items[j], items[i]
        return items


def move_rng(seed, seq):
    """The generator for the move at `seq`. The seed is the room's secret, so
    a person can't work the computer's choices out from the code; mixing in
    `seq` means a restart mid-game picks up exactly where it would have."""
    return Mulberry32((seed ^ ((seq * 0x9E3779B1) & 0xFFFFFFFF)) & 0xFFFFFFFF)
