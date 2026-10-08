"""Sweeps: a closed cross-section carried along a path (cables, deck girders)."""

import math

import bmesh

from . import ops


def _frames(path, up_hint):
    """Per-point (side, up) unit vectors perpendicular to the path's tangent."""
    frames = []
    for i, point in enumerate(path):
        prev_p = path[max(0, i - 1)]
        next_p = path[min(len(path) - 1, i + 1)]
        tangent = ops.norm(ops.sub(next_p, prev_p))
        side = ops.cross(tangent, up_hint)
        if ops.dot(side, side) < 1e-9:
            side = ops.cross(tangent, (1.0, 0.0, 0.0))
        side = ops.norm(side)
        up = ops.norm(ops.cross(side, tangent))
        frames.append((side, up))
    return frames


def sweep(path, section, up_hint=(0.0, 0.0, 1.0), caps=False):
    """Carry `section` [(side, up), ...] (a closed loop) along `path` [(x, y, z), ...]."""
    frames = _frames(path, up_hint)
    m = len(section)
    bm = bmesh.new()
    rings = []
    for point, (side, up) in zip(path, frames):
        ring = []
        for (a, b) in section:
            co = ops.add(point, ops.add(ops.scale(side, a), ops.scale(up, b)))
            ring.append(bm.verts.new(co))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for j in range(m):
            k = (j + 1) % m
            bm.faces.new((r0[j], r0[k], r1[k], r1[j]))
    if caps:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    ops.recalc_normals(bm)
    return bm


def circle(radius, sides, phase=0.5):
    """A regular polygon section; phase 0.5 puts a flat side on top (cables read rounder)."""
    return [
        (radius * math.cos(2 * math.pi * (i + phase) / sides), radius * math.sin(2 * math.pi * (i + phase) / sides))
        for i in range(sides)
    ]


def tube(path, radius, sides, caps=False):
    return sweep(path, circle(radius, sides), caps=caps)
