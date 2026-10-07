"""bmesh operations every primitive shares: chamfer, triangulate, transform."""

import math

import bmesh


def chamfer(bm, ratio, min_dim):
    """Bevel every edge by `ratio` of the part's smallest dimension (one segment: a flat chamfer).

    A chamfer catches a highlight on each edge, which is what makes a low-poly block read as
    hand-made rather than a raw box. One segment keeps the cost to 2 triangles per edge.
    """
    offset = ratio * min_dim
    if offset <= 0:
        return
    bmesh.ops.bevel(
        bm,
        geom=list(bm.verts) + list(bm.edges),
        offset=offset,
        offset_type="OFFSET",
        segments=1,
        profile=0.5,
        affect="EDGES",
        clamp_overlap=True,
    )


def triangulate(bm):
    bmesh.ops.triangulate(bm, faces=list(bm.faces), quad_method="FIXED", ngon_method="EAR_CLIP")


def recalc_normals(bm):
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))


def rotate_z(point, angle_rad):
    c, s = math.cos(angle_rad), math.sin(angle_rad)
    x, y, z = point
    return (c * x - s * y, s * x + c * y, z)


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def scale(a, k):
    return (a[0] * k, a[1] * k, a[2] * k)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(a):
    length = math.sqrt(dot(a, a))
    if length < 1e-12:
        raise ValueError("zero-length vector")
    return scale(a, 1.0 / length)


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)
