"""Detail that matches what the game camera can see.

The game camera (data/config/scene.json `camera`) has a vertical field of view and a minimum
orbit distance; a level of detail is first shown at the switch distance of the tiers that use
it (scene.json `landmarks.lod`, times `bridgeDistanceMultiplier` for bridges). From those, a
level knows how many metres one screen pixel covers when it is nearest, and so:

- how finely a curve must be split for its facets to stay within half a pixel, and
- whether a thin member (cable, suspender, lamp) is wide enough to show at all.

The reference viewport is the 390 x 844 phone of the cc-mid-4g profile (CLAUDE.md).
"""

import math

from . import lod

VIEWPORT_HEIGHT_PX = 844
#: A curve's facets may deviate from the true curve by this many pixels at the nearest view.
CURVE_TOLERANCE_PX = 0.5
#: Members thinner than this many pixels at a level's nearest view are left out of it.
MIN_MEMBER_PX = 0.2


def metres_per_px(distance_m, scene):
    fov = math.radians(scene["camera"]["fovDeg"])
    return 2.0 * distance_m * math.tan(fov / 2.0) / VIEWPORT_HEIGHT_PX


def nearest_distance(level, scene, bridge):
    """The closest the camera gets to a model while it shows `level`."""
    config = scene["landmarks"]
    multiplier = config["bridgeDistanceMultiplier"] if bridge else 1.0
    nearest = None
    for tier, levels in lod.TIER_LEVELS.items():
        if level in levels:
            start = config["lod"][tier]["distancesM"][levels.index(level)] * multiplier
            nearest = start if nearest is None else min(nearest, start)
    if nearest is None:
        raise ValueError("level %d is used by no tier" % level)
    return max(nearest, scene["camera"]["minDistanceM"])


class View:
    """What one level can show: tolerances in metres at its nearest camera distance."""

    def __init__(self, level, scene, bridge):
        self.level = level
        self.distance = nearest_distance(level, scene, bridge)
        self.mpp = metres_per_px(self.distance, scene)
        self.tolerance = CURVE_TOLERANCE_PX * self.mpp

    def shows(self, width_m):
        return width_m / self.mpp >= MIN_MEMBER_PX

    def arc_segments(self, radius, angle_rad, lo=1, hi=24, density=1.0):
        """Segments for an arc so its chords stay within the curve tolerance."""
        if radius <= self.tolerance:
            return lo
        per = 2.0 * math.acos(max(-1.0, 1.0 - self.tolerance / radius))
        return int(min(hi, max(lo, math.ceil(density * angle_rad / per))))

    def parabola_segments(self, sag, lo=2, hi=48, density=1.0):
        """Segments for a parabolic cable: the chord error of n equal segments is sag / n^2."""
        n = math.sqrt(max(sag, 0.0) / self.tolerance) if self.tolerance > 0 else hi
        return int(min(hi, max(lo, math.ceil(density * n))))
