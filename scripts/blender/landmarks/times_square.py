"""Times Square (a generic composition, LEGAL-1: no text, logos or brand screens): the district
archetype. The bowtie plaza along the axis, five generic towers down each side with plain
colour screen panels facing the square, a screen tower at the south end and red stepped stands
at the north end. Screens glow at night.

No S07a frame yet (S07b): it builds at the origin with the square running north-south on the
land top; chunk 4 places and turns it.
"""

from archetypes import district
from cclib import inputs

ARCHETYPE = district
CATEGORY = "neighborhood"

SCREEN_ROLES = ("screen-magenta", "screen-cyan", "screen-amber", "screen-white")


def spec(data, true_scale=False):
    m = data["measurements"]["dimensions"]
    game = data["measurements"]["gameScale"]
    h = 1.0 if true_scale else game["height"]
    w = 1.0 if true_scale else game["plan"]
    length = m["squareLengthM"]["valueM"] * w
    end_w, waist = m["plazaWidthM"]["widthM"] * w, m["plazaWidthM"]["depthM"] * w
    tall, low = m["heightM"]["valueM"], m["flankLowM"]["valueM"]
    half = length / 2
    # Two triangles meeting at the waist: the bowtie.
    plazas = [
        {"outline": [(-end_w / 2, -half), (end_w / 2, -half), (waist / 2, 0.0), (-waist / 2, 0.0)], "role": "stone",
         "tone": 0.92},
        {"outline": [(-waist / 2, 0.0), (waist / 2, 0.0), (end_w / 2, half), (-end_w / 2, half)], "role": "stone",
         "tone": 0.92},
    ]
    blocks = []
    boards = []
    count = 5
    pitch = length / count
    # Each block: a screen-clad podium on the square and a generic tower set back behind it.
    heights = [tall, low + (tall - low) * 0.35, low + (tall - low) * 0.7, low, low + (tall - low) * 0.5]
    podium_h = 38.0 * h
    for side in (-1, 1):
        wall = 1 if side < 0 else 3
        for i in range(count):
            y = -half + pitch * (i + 0.5)
            span = waist + (end_w - waist) * abs(y) / half
            pw, pd = 34.0 * w, pitch * 0.86
            px = side * (span / 2 + 6.0 * w + pw / 2)
            colour = (i + side) % 4
            blocks.append({
                "x": px, "y": y, "w": pw, "d": pd, "h": podium_h, "role": "stone", "rows": 0,
                "screens": [{"wall": wall, "z0": 5.0 * h, "z1": podium_h - 3.0 * h, "share": 0.94,
                             "role": SCREEN_ROLES[colour]}],
            })
            boards.append({"x": side * (span / 2 + 6.0 * w + 4.0 * w), "y": y, "z0": podium_h, "w": pd * 0.8,
                           "h": 16.0 * h, "facing": (-side, 0.0), "role": SCREEN_ROLES[(colour + 2) % 4]})
            tw = 36.0 * w
            tx = px + side * (pw / 2 + tw / 2 - 4.0 * w)
            height = heights[(i + (0 if side < 0 else 2)) % count] * h
            blocks.append({
                "x": tx, "y": y, "w": tw, "d": pd * 0.8, "h": height, "role": "steel" if i % 2 else "stone",
                "rows": max(4, int(height / 9.0)),
                "screens": [{"wall": wall, "z0": podium_h + 22.0 * h, "z1": min(height - 6.0 * h, podium_h + 50.0 * h),
                             "share": 0.8, "role": SCREEN_ROLES[(colour + 1) % 4]}],
            })
    central = m["centralTowerM"]["valueM"] * h
    blocks.append({
        "x": 0.0, "y": -half - 14.0 * w, "w": 30.0 * w, "d": 22.0 * w, "h": central, "role": "stone",
        "rows": m["centralTowerFloors"]["count"],
        "screens": [{"wall": 2, "z0": 10.0 * h + 20.0 * h * i, "z1": 26.0 * h + 20.0 * h * i, "share": 0.92,
                     "role": SCREEN_ROLES[i % 4]} for i in range(4)],
    })
    for b in blocks:
        b["screens"] = [s for s in b["screens"] if s["z1"] > s["z0"] + 4.0]
    return {
        "id": data["id"],
        "detail": (h * w) ** 0.5,
        "land_top": inputs.land_top_y(data["scene"]),
        "plazas": plazas,
        "plaza_thickness": 0.4,
        "blocks": blocks,
        "boards": boards,
        "stands": [{"x": 0.0, "y": half * 0.72, "w": 26.0 * w, "d": 24.0 * w, "h": 9.0 * h, "steps": 6,
                    "role": "signal", "facing": -1}],
    }


def expected_height(data, true_scale=False):
    m = data["measurements"]
    return m["dimensions"]["heightM"]["valueM"] * (1.0 if true_scale else m["gameScale"]["height"])


def context(spec):
    return {"land": [], "focus": 0.0}
