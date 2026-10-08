"""Statue of Liberty: the pedestal figure archetype from the NPS statistics. A star fort, the
granite pedestal and the copper figure: robe, head with seven crown rays, the raised right arm
with its gilded torch flame (lit at night), the tablet at the left side.

No S07a frame yet (S07b): it builds at the origin facing north (+y) on the land top; chunk 4
places it on Liberty Island. Heights and widths are at the measurements' `gameScale`.
"""

from archetypes import figure
from cclib import inputs

ARCHETYPE = figure
#: perf.json has no monument caps yet: it is budgeted as a building.
CATEGORY = "building"


def spec(data, true_scale=False):
    m = data["measurements"]["dimensions"]
    game = data["measurements"]["gameScale"]
    h = 1.0 if true_scale else game["height"]
    w = 1.0 if true_scale else game["plan"]
    pedestal_top = m["pedestalTopM"]["valueM"]
    pedestal = m["pedestalM"]["valueM"]
    head = m["headM"]["valueM"]
    shoulder = m["heelToHeadM"]["valueM"] - head
    statue = m["statueM"]["valueM"]
    # The torch's flame tops out at the NPS height: the arm rises from the shoulder at the
    # archetype's fixed lean (cos ~0.97), the cup is 1.4 x its radius, the flame takes the rest.
    arm_rise = m["armM"]["depthM"] * 0.968
    cup = 1.4
    flame = statue - (shoulder - head * 0.2 + arm_rise + cup * 1.4)
    if flame <= 0:
        raise ValueError("the arm and torch overshoot the statue's height")
    return {
        "id": data["id"],
        "detail": (h * w) ** 0.5,
        "land_top": inputs.land_top_y(data["scene"]),
        "fort": {"points": 11, "outer": m["fort"]["widthM"] / 2 * w, "inner": m["fort"]["depthM"] / 2 * w,
                 "height": (pedestal_top - pedestal) * h},
        "pedestal": {"base": m["pedestalPlan"]["widthM"] * w, "top": m["pedestalPlan"]["depthM"] * w,
                     "height": pedestal * h},
        "figure": {
            "robe": {"base": m["waistM"]["valueM"] * 0.62 * w, "waist": m["waistM"]["valueM"] / 2 * w,
                     "shoulder_r": m["waistM"]["valueM"] * 0.4 * w, "shoulder": shoulder * h},
            # Head and crown read a little larger than life so the silhouette holds at distance.
            "head": {"radius": m["headWidthM"]["valueM"] * 0.6 * w, "height": head * h},
            "crown": {"rays": 7, "length": 4.2 * w},
            "arm": {"length": m["armM"]["depthM"] * h, "width": m["armM"]["widthM"] * 0.7 * w},
            "torch": {"cup": cup * w, "flame": flame * h},
            "tablet": {"width": m["tablet"]["widthM"] * w, "height": m["tablet"]["depthM"] * h,
                       "thickness": 0.61 * w},
        },
        "stone": "granite",
        "metal": "patina",
        "flame": "gilt",
    }


def expected_height(data, true_scale=False):
    real = data["measurements"]["dimensions"]["heightM"]["valueM"]
    return real if true_scale else real * data["measurements"]["gameScale"]["height"]


def context(spec):
    return {"land": [], "focus": 0.0}
