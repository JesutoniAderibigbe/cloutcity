"""The Queens ballpark (a generic label, LEGAL-1: no logos, team or sponsor names, signage or
text): the ballpark archetype. A brick bowl with stone trim wrapping the field from foul pole
to foul pole, a raked lower deck, glazed suites, an upper deck round the infield under a
canopy, outfield bleachers, a plain scoreboard panel and light towers.

Numbers come from data/landmarks/measurements/queens-ballpark.json (Wikidata for the point and
capacity; the field, the rules of baseball; the rest estimates). Map-oriented: placed at the
landmarks.json location with heading 0, centre field toward its measured heading.
"""

from archetypes import stadium
from cclib import inputs

ARCHETYPE = stadium
CATEGORY = "stadium"


def spec(data, true_scale=False):
    data = dict(data, land_top=inputs.land_top_y(data["scene"]))
    return stadium.ballpark_spec(data, true_scale,
                                 {"seats": "steel-dark", "trim": "stone", "facade": "brick", "canopy": "steel", "fence": "steel-dark",
                    "screen": "screen-cyan"})


def expected_height(data, true_scale=False):
    return stadium.expected_height(data, true_scale)


def context(spec):
    return {"land": [], "focus": 0.0, "closeM": 450.0}
