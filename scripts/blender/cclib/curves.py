"""Curves a bridge hangs on: catenaries for cables and piecewise-linear deck profiles."""

import math


def catenary_y(u, y0, y1, sag):
    """Height at fraction u (0..1) of a cable from y0 to y1 that dips `sag` below their chord.

    A true catenary under a uniform deck load is a parabola to within a fraction of a metre at
    these spans; the parabola keeps the low point exactly where the measurements put it.
    """
    return y0 + (y1 - y0) * u - 4.0 * sag * u * (1.0 - u)


def sample_catenary(a, b, sag, segments):
    """Points (x, y, z) from a to b (Blender coords, z up) sagging `sag` in z."""
    points = []
    for i in range(segments + 1):
        u = i / segments
        points.append(
            (
                a[0] + (b[0] - a[0]) * u,
                a[1] + (b[1] - a[1]) * u,
                catenary_y(u, a[2], b[2], sag),
            )
        )
    return points


def sag_for_low_point(y_top, y_low):
    """The sag of a level cable whose mid-point is at y_low."""
    return y_top - y_low


def profile_at(profile, s):
    """Linear interpolation of a [(s, y), ...] profile (s increasing)."""
    if s <= profile[0][0]:
        return profile[0][1]
    for (s0, y0), (s1, y1) in zip(profile, profile[1:]):
        if s <= s1:
            t = (s - s0) / (s1 - s0) if s1 > s0 else 0.0
            return y0 + (y1 - y0) * t
    return profile[-1][1]


def crowned_span(s0, s1, y_ends, y_mid, segments):
    """A deck between two supports that rises (parabolically) from y_ends to y_mid mid-way."""
    points = []
    for i in range(segments + 1):
        u = i / segments
        points.append((s0 + (s1 - s0) * u, y_ends + (y_mid - y_ends) * 4.0 * u * (1.0 - u)))
    return points


def pointed_arch(cx, half_span, spring_z, radius, segments):
    """Points (x, z) of a two-centred pointed (Gothic) arch, left springing to right springing.

    Each side is an arc of `radius` centred on the opposite side of the opening, so the arcs
    meet at the apex: the arch the towers' openings use.
    """
    offset = radius - half_span
    rise = math.sqrt(max(0.0, radius * radius - offset * offset))
    left = []
    # Left arc: centre at (cx + offset, spring_z), from the left springing up to the apex.
    a0 = math.pi
    a1 = math.atan2(rise, -offset)
    for i in range(segments + 1):
        a = a0 + (a1 - a0) * (i / segments)
        left.append((cx + offset + radius * math.cos(a), spring_z + radius * math.sin(a)))
    right = [(2 * cx - x, z) for (x, z) in reversed(left[:-1])]
    return left + right, rise
