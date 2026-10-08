"""Vertex colours: one palette role per face, with a small seeded value jitter.

The jitter (±3 % brightness per face) breaks up large flat areas the way hand-painted low-poly
packs do, without textures. It is seeded per landmark (env.seeded_rng), so it is reproducible.
"""

VALUE_JITTER = 0.03


def jittered(rgb, rng, amount=VALUE_JITTER):
    k = 1.0 + rng.uniform(-amount, amount)
    return tuple(min(1.0, max(0.0, c * k)) for c in rgb)


def shade(rgb, k):
    """A darker or lighter variant of a role colour (k < 1 darker), for trims and soffits."""
    return tuple(min(1.0, max(0.0, c * k)) for c in rgb)


def linear(rgb):
    """sRGB (0..1) to linear: night-glow colours are linear (the S04f `_EMISSIVE` contract)."""
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb)
