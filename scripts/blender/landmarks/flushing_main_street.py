"""Flushing Main Street (a generic composition): the district archetype. Main Street running
north-south with sidewalks, low shopfront blocks down both sides with plain colour sign bands
at the first floor (no text, no brands; LEGAL-1) that glow at night, and glass towers behind.

No S07a frame yet (S07b): it builds at the origin with the street north-south on the land
top; chunk 4 places and turns it. Numbers (all estimates) from
data/landmarks/measurements/flushing-main-street.json at its `gameScale`.
"""

from archetypes import district
from cclib import inputs

ARCHETYPE = district
CATEGORY = "neighborhood"

SIGN_ROLES = ("screen-amber", "signal", "screen-white", "screen-cyan", "screen-magenta")


def spec(data, true_scale=False):
    m = data["measurements"]["dimensions"]
    game = data["measurements"]["gameScale"]
    h = 1.0 if true_scale else game["height"]
    w = 1.0 if true_scale else game["plan"]
    length = m["streetLengthM"]["valueM"] * w
    street = m["streetWidthM"]["valueM"] * w
    tall, low = m["frontageM"]["widthM"], m["frontageM"]["depthM"]
    half = length / 2
    blocks = []
    count = 8
    pitch = length / count
    pattern = [0.2, 0.9, 0.5, 0.0, 0.7, 0.3, 1.0, 0.4]
    for side in (-1, 1):
        wall = 1 if side < 0 else 3
        for i in range(count):
            y = -half + pitch * (i + 0.5)
            bw, bd = 22.0 * w, pitch * 0.9
            x = side * (street / 2 + bw / 2)
            height = (low + (tall - low) * pattern[(i + (side > 0) * 3) % count]) * h
            blocks.append({
                "x": x, "y": y, "w": bw, "d": bd, "h": height, "role": "brick" if i % 3 else "stone",
                "tone": 0.85 + 0.05 * (i % 3), "rows": max(2, int(height / 3.6)), "glass_share": 0.45,
                "window_pitch": 3.8 * w, "roof": True,
                # The shop sign band over the ground floor, and a deeper awning-height band.
                "screens": [{"wall": wall, "z0": 3.4 * h, "z1": 5.6 * h, "share": 0.9,
                             "role": SIGN_ROLES[(i + side) % len(SIGN_ROLES)]}],
            })
    towers = [(-1, -0.3, 1.0), (1, 0.25, 0.0), (-1, 0.35, 0.55)]
    for side, f, mix in towers:
        th = (m["towerLowM"]["valueM"] + (m["heightM"]["valueM"] - m["towerLowM"]["valueM"]) * mix) * h
        blocks.append({"x": side * (street / 2 + 22.0 * w + 26.0 * w), "y": f * length, "w": 30.0 * w,
                       "d": 30.0 * w, "h": th, "role": "glass", "rows": max(4, int(th / 3.6)), "roof": True})
    plazas = [
        {"outline": [(-street / 2, -half), (street / 2, -half), (street / 2, half), (-street / 2, half)],
         "role": "asphalt"},
    ]
    for side in (-1, 1):
        x0, x1 = sorted((side * street / 2, side * (street / 2 - 4.0 * w)))
        plazas.append({"outline": [(x0, -half), (x1, -half), (x1, half), (x0, half)], "role": "stone",
                       "tone": 0.9})
    return {
        "id": data["id"],
        "detail": (h * w) ** 0.5,
        "land_top": inputs.land_top_y(data["scene"]),
        "plazas": plazas,
        "plaza_thickness": 0.3,
        "blocks": blocks,
    }


def expected_height(data, true_scale=False):
    m = data["measurements"]
    return m["dimensions"]["heightM"]["valueM"] * (1.0 if true_scale else m["gameScale"]["height"])


def context(spec):
    return {"land": [], "focus": 0.0}
