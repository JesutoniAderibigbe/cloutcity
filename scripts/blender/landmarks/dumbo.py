"""DUMBO (a generic composition): the district archetype. Brick warehouse blocks with punched
windows on a grid, a cobbled street through them, a clock-tower warehouse on the waterfront
(generic: a plain tower with a pyramid roof, no clock face), the waterfront park lawn and the
carousel's glass pavilion, lit at night. No signage.

No S07a frame yet (S07b): it builds at the origin with the waterfront to the north (+y) on the
land top; chunk 4 places and turns it. Numbers (all estimates) from
data/landmarks/measurements/dumbo.json at its `gameScale`.
"""

from archetypes import district
from cclib import inputs

ARCHETYPE = district
CATEGORY = "neighborhood"


def spec(data, true_scale=False):
    m = data["measurements"]["dimensions"]
    game = data["measurements"]["gameScale"]
    h = 1.0 if true_scale else game["height"]
    w = 1.0 if true_scale else game["plan"]
    bw, bd = m["blockPlan"]["widthM"] * w, m["blockPlan"]["depthM"] * w
    street = 14.0 * w
    tall, low = m["warehouseM"]["widthM"], m["warehouseM"]["depthM"]
    blocks = []
    # Three rows of three warehouses south of the waterfront; heights vary, deterministically.
    pattern = [0.0, 0.6, 0.3, 1.0, 0.2, 0.8, 0.5, 0.1, 0.7]
    for row in range(3):
        for col in range(3):
            if row == 0 and col == 1:
                continue  # the clock-tower warehouse stands here
            x = (col - 1) * (bw + street)
            y = -(row + 0.5) * (bd + street)
            height = (low + (tall - low) * pattern[row * 3 + col]) * h
            blocks.append({"x": x, "y": y, "w": bw, "d": bd, "h": height, "role": "brick",
                           "rows": max(3, int(height / 4.0)), "glass_share": 0.42, "window_pitch": 4.2 * w,
                           "roof": True, "tone": 0.82})
    tower_h = m["towerBlockM"]["valueM"] * h
    blocks.append({"x": 0.0, "y": -0.5 * (bd + street), "w": bw, "d": bd, "h": tower_h, "role": "brick",
                   "rows": max(3, int(tower_h / 4.0)), "glass_share": 0.42, "window_pitch": 4.2 * w, "roof": True,
                   "tone": 0.82})
    top = m["heightM"]["valueM"] * h
    cap = 8.0 * h
    blocks.append({"x": 0.0, "y": -0.5 * (bd + street), "w": 16.0 * w, "d": 16.0 * w, "h": top - cap,
                   "role": "brick", "rows": 4, "glass_share": 0.3, "window_pitch": 5.0 * w, "cap": cap,
                   "tone": 0.82})
    lawn_w, lawn_d = m["parkStrip"]["widthM"] * w, m["parkStrip"]["depthM"] * w
    side, ch = m["carousel"]["widthM"] * w, m["carousel"]["depthM"] * h
    blocks.append({"x": lawn_w * 0.25, "y": lawn_d / 2 + 4.0 * w, "w": side, "d": side, "h": ch, "role": "glass",
                   "rows": 0, "glow": True})
    span = 3 * bw + 2 * street
    plazas = [
        {"outline": [(-lawn_w / 2, 4.0 * w), (lawn_w / 2, 4.0 * w), (lawn_w / 2, 4.0 * w + lawn_d),
                     (-lawn_w / 2, 4.0 * w + lawn_d)], "role": "lawn"},
        # The cobbled street running inland from the water.
        {"outline": [(bw / 2 + 1.0 * w, -3 * (bd + street)), (bw / 2 + street - 1.0 * w, -3 * (bd + street)),
                     (bw / 2 + street - 1.0 * w, 4.0 * w), (bw / 2 + 1.0 * w, 4.0 * w)], "role": "stone", "tone": 0.8},
    ]
    if span > lawn_w + 40.0:
        raise ValueError("the blocks are wider than the waterfront")
    return {
        "id": data["id"],
        "detail": (h * w) ** 0.5,
        "land_top": inputs.land_top_y(data["scene"]),
        "plazas": plazas,
        "plaza_thickness": 0.4,
        "blocks": blocks,
    }


def expected_height(data, true_scale=False):
    m = data["measurements"]
    return m["dimensions"]["heightM"]["valueM"] * (1.0 if true_scale else m["gameScale"]["height"])


def context(spec):
    return {"land": [], "focus": 0.0}
