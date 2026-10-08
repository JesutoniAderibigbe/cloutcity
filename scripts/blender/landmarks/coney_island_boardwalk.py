"""Coney Island Boardwalk (Riegelmann Boardwalk): the promenade archetype. A 2.7 km stretch of
plank deck on piles along the beach, railings, benches, double rows of lamps lit at night,
generic roofed shelters and the fishing pier out over the sea. No rides, signs or text
(LEGAL-1; copy never names rides or amusement brands).

Map-oriented: placed at the landmarks.json (Wikidata) point with heading 0; the deck runs
along its measured compass heading with the sea to the south. Numbers (all estimates) from
data/landmarks/measurements/coney-island-boardwalk.json.
"""

from archetypes import promenade
from cclib import inputs

ARCHETYPE = promenade
CATEGORY = "park"


def spec(data, true_scale=False):
    m = data["measurements"]["dimensions"]
    read = data["measurements"]["readabilityScale"]
    game = data["measurements"]["gameScale"]
    h = 1.0 if true_scale else game["height"]
    wide = 1.0 if true_scale else read["width"]
    v = lambda key: m[key]["valueM"]  # noqa: E731
    deck = v("deckM") * h
    shelter_h = v("heightM") * h - deck
    return {
        "id": data["id"],
        "detail": h ** 0.5,
        "land_top": inputs.land_top_y(data["scene"]),
        "length": v("lengthM"),
        "width": v("widthM") * wide,
        "deck": deck,
        "heading": v("headingDeg"),
        "beach": v("beachM"),
        "pier": {"along": -v("pierWestM"), "length": m["pier"]["depthM"], "width": m["pier"]["widthM"] * wide},
        "piles": 9.0,
        "benches": 40.0,
        "lamps": 30.0,
        "lamp_head": 0.5 * read["lamp"],
        "shelters": {"count": 6, "width": m["shelter"]["widthM"] * wide, "depth": m["shelter"]["depthM"] * wide,
                     "height": shelter_h},
    }


def expected_height(data, true_scale=False):
    real = data["measurements"]["dimensions"]["heightM"]["valueM"]
    return real if true_scale else real * data["measurements"]["gameScale"]["height"]


def context(spec):
    return {"land": [], "focus": 0.0, "closeM": 700.0}
