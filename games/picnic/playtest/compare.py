from sim import Rules
from metrics import report, TABLES
HO = {2: [['hoarder','careful'],['careful','hoarder'],['hoarder','kid'],['kid','hoarder'],['hoarder','sneaky'],['sneaky','hoarder']],
      3: [['hoarder','careful','sneaky'],['careful','hoarder','kid'],['sneaky','kid','hoarder']],
      4: [['hoarder','careful','sneaky','kid'],['careful','hoarder','greedy','sneaky'],['sneaky','kid','hoarder','careful'],['greedy','sneaky','careful','hoarder']]}
PAC = {2: [['pacifist','careful'],['careful','pacifist'],['pacifist','sneaky'],['sneaky','pacifist'],['pacifist','kid'],['kid','pacifist']],
       3: [['pacifist','careful','sneaky'],['careful','pacifist','kid'],['sneaky','kid','pacifist']],
       4: [['pacifist','careful','sneaky','kid'],['careful','pacifist','greedy','sneaky'],['sneaky','kid','pacifist','careful'],['greedy','sneaky','careful','pacifist']]}
# What engine.py plays.
BASE = dict(trap_free=True, one_each=True, trap_cap=2, gull_basket=True, no_shake=True, shoo_back=True,
            defences={"umbrella": 2, "shoo": 3}, basket_max=5, loot_overflows=True, settle_in=True)

if __name__ == "__main__":
    r = Rules(**BASE)
    for label, tables in (("family tables", TABLES), ("with a hoarder", HO), ("with a pacifist", PAC)):
        print("=====", label)
        report(r, n=1500, tables=tables)
