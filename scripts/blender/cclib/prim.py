"""Primitives and the Builder that collects them into a level's meshes.

Coordinates are Blender's (z up). A bridge's axis runs along +y (its second end at +y), which
the glTF exporter's +Y-up conversion turns into the game's model space (front facing -z; see
src/scene/landmarks/archetypes/bridgeDeck.ts).

Each primitive is built as its own bmesh, optionally chamfered, triangulated and appended to
the Builder with one palette role per face. Vertices are not shared between faces: every face
is flat-shaded with its own colour, which is the low-poly look.
"""

import bmesh

from . import ops, paint

GROUPS = ("body", "windows")


class Builder:
    def __init__(self, palette, rng, chamfer_ratio=0.0):
        self.palette = palette
        self.rng = rng
        self.chamfer_ratio = chamfer_ratio
        self.data = {group: {"verts": [], "faces": [], "colors": []} for group in GROUPS}

    def triangles(self, group=None):
        groups = GROUPS if group is None else (group,)
        return sum(len(self.data[g]["faces"]) for g in groups)

    def colour(self, role, tone=1.0):
        if role not in self.palette:
            raise KeyError("theme.json scene.landmarks has no role %r" % role)
        return paint.shade(self.palette[role], tone)

    def add(self, bm, role, group="body", tone=1.0, chamfer_dim=None, jitter=True):
        """Append a bmesh, painted `role` (times `tone`), chamfered when chamfer_dim is given."""
        if chamfer_dim is not None and self.chamfer_ratio > 0:
            ops.chamfer(bm, self.chamfer_ratio, chamfer_dim)
        base = self.colour(role, tone)
        self._append(bm, group, lambda face: paint.jittered(base, self.rng) if jitter else base)

    def add_toned(self, bm, role, tone_of, group="body"):
        """Append a bmesh whose faces take tone_of(centre, normal) times the role colour."""

        def colour_of(face):
            c = face.calc_center_median()
            n = face.normal
            return paint.jittered(self.colour(role, tone_of((c.x, c.y, c.z), (n.x, n.y, n.z))), self.rng)

        self._append(bm, group, colour_of)

    def _append(self, bm, group, colour_of):
        """Colour each polygon, then triangulate; a polygon's triangles share its vertices.

        One colour per polygon (not per triangle) lets the exporter share a quad's corners,
        which keeps the file smaller and the jitter reading as painted panels.
        """
        bm.faces.ensure_lookup_table()
        layer = bm.faces.layers.int.new("cc_polygon")
        colours = []
        for face in bm.faces:
            face[layer] = len(colours)
            colours.append(colour_of(face))
        ops.triangulate(bm)
        bm.verts.index_update()
        target = self.data[group]
        shared = {}
        for face in bm.faces:
            polygon = face[layer]
            corners = []
            for loop in face.loops:
                key = (polygon, loop.vert.index)
                if key not in shared:
                    shared[key] = len(target["verts"])
                    co = loop.vert.co
                    target["verts"].append((co.x, co.y, co.z))
                corners.append(shared[key])
            target["faces"].append(tuple(corners))
            target["colors"].append(colours[polygon])
        bm.free()


def _bm_from(verts, faces):
    bm = bmesh.new()
    handles = [bm.verts.new(v) for v in verts]
    for face in faces:
        bm.faces.new([handles[i] for i in face])
    return bm


def box(x0, x1, y0, y1, z0, z1):
    """An axis-aligned box."""
    return frustum((x0 + x1) / 2, (y0 + y1) / 2, z0, z1, x1 - x0, y1 - y0, x1 - x0, y1 - y0)


def frustum(cx, cy, z0, z1, w0, d0, w1, d1):
    """A box tapering from w0 x d0 at z0 to w1 x d1 at z1 (towers batter as they rise)."""
    verts = [
        (cx - w0 / 2, cy - d0 / 2, z0),
        (cx + w0 / 2, cy - d0 / 2, z0),
        (cx + w0 / 2, cy + d0 / 2, z0),
        (cx - w0 / 2, cy + d0 / 2, z0),
        (cx - w1 / 2, cy - d1 / 2, z1),
        (cx + w1 / 2, cy - d1 / 2, z1),
        (cx + w1 / 2, cy + d1 / 2, z1),
        (cx - w1 / 2, cy + d1 / 2, z1),
    ]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return _bm_from(verts, faces)


def prism_xz(outline, y0, y1, caps=True):
    """A 2D outline [(x, z), ...] (counter-clockwise seen from -y) extruded from y0 to y1."""
    n = len(outline)
    verts = [(x, y0, z) for (x, z) in outline] + [(x, y1, z) for (x, z) in outline]
    faces = []
    if caps:
        faces.append(tuple(reversed(range(n))))
        faces.append(tuple(range(n, 2 * n)))
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    bm = _bm_from(verts, faces)
    ops.recalc_normals(bm)
    return bm


def quad_strip(left, right):
    """Quads between two equal-length point rows (a ribbon or a deck surface)."""
    n = len(left)
    verts = list(left) + list(right)
    faces = [(i, i + 1, n + i + 1, n + i) for i in range(n - 1)]
    return _bm_from(verts, faces)


def diamond(centre, r):
    """An octahedron of radius r: a lamp or light bulb in 8 triangles."""
    x, y, z = centre
    verts = [(x + r, y, z), (x - r, y, z), (x, y + r, z), (x, y - r, z), (x, y, z + r), (x, y, z - r)]
    faces = [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)]
    bm = _bm_from(verts, faces)
    ops.recalc_normals(bm)
    return bm


def quad(a, b, c, d):
    """One flat quad (a trim or an inset panel laid just proud of a face)."""
    return _bm_from([a, b, c, d], [(0, 1, 2, 3)])


def ribbon(a, b, half_width, across):
    """A flat two-triangle strip from a to b, `half_width` either side along `across`.

    Suspenders and stays are ribbons: a few px wide at game distance, so a box's extra sides
    would never be seen. The body material is double-sided, so a ribbon reads from both sides.
    """
    off = ops.scale(across, half_width)
    verts = [ops.sub(a, off), ops.add(a, off), ops.add(b, off), ops.sub(b, off)]
    return _bm_from(verts, [(0, 1, 2, 3)])
