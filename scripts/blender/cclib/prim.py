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

#: Night-glow sources: `windows` faces glow in their own colour; `body` faces glow only when
#: given an explicit `glow` (a floodlit trim). See cclib/paint.py `linear`.
GROUPS = ("body", "windows")


class Builder:
    """Collects one level's triangles: per face an sRGB colour and a linear night-glow colour
    (zero = no glow), the S04f `_EMISSIVE` contract."""

    def __init__(self, palette, rng, chamfer_ratio=0.0):
        self.palette = palette
        self.rng = rng
        self.chamfer_ratio = chamfer_ratio
        self.verts = []
        self.faces = []
        self.colors = []
        self.glows = []

    def triangles(self):
        return len(self.faces)

    def colour(self, role, tone=1.0):
        if role not in self.palette:
            raise KeyError("theme.json scene.landmarks has no role %r" % role)
        return paint.shade(self.palette[role], tone)

    def add(self, bm, role, group="body", tone=1.0, chamfer_dim=None, jitter=True, glow=None):
        """Append a bmesh, painted `role` (times `tone`), chamfered when chamfer_dim is given.

        `group="windows"` glows in the face colour; `glow` (sRGB) gives any face its own glow.
        """
        if group not in GROUPS:
            raise ValueError("unknown group %r" % group)
        if chamfer_dim is not None and self.chamfer_ratio > 0:
            ops.chamfer(bm, self.chamfer_ratio, chamfer_dim)
        base = self.colour(role, tone)
        light = paint.linear(base if group == "windows" else glow) if (group == "windows" or glow) else NO_GLOW
        self._append(bm, lambda face: paint.jittered(base, self.rng) if jitter else base, light)

    def add_toned(self, bm, role, tone_of, glow=None):
        """Append a bmesh whose faces take tone_of(centre, normal) times the role colour."""

        def colour_of(face):
            c = face.calc_center_median()
            n = face.normal
            return paint.jittered(self.colour(role, tone_of((c.x, c.y, c.z), (n.x, n.y, n.z))), self.rng)

        self._append(bm, colour_of, paint.linear(glow) if glow else NO_GLOW)

    def _append(self, bm, colour_of, glow):
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
        shared = {}
        for face in bm.faces:
            polygon = face[layer]
            corners = []
            for loop in face.loops:
                key = (polygon, loop.vert.index)
                if key not in shared:
                    shared[key] = len(self.verts)
                    co = loop.vert.co
                    self.verts.append((co.x, co.y, co.z))
                    self.glows.append(glow)
                corners.append(shared[key])
            self.faces.append(tuple(corners))
            self.colors.append(colours[polygon])
        bm.free()


NO_GLOW = (0.0, 0.0, 0.0)


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


def _two_sided(verts, faces):
    """Faces plus their reverses on their own vertices. The runtime's shared model material
    culls back faces, so a sheet (a ribbon, a truss panel) must carry both sides."""
    n = len(verts)
    back = [tuple(n + i for i in reversed(face)) for face in faces]
    return _bm_from(list(verts) + list(verts), list(faces) + back)


def quad_strip(left, right):
    """A two-sided sheet of quads between two equal-length point rows."""
    n = len(left)
    verts = list(left) + list(right)
    faces = [(i, i + 1, n + i + 1, n + i) for i in range(n - 1)]
    return _two_sided(verts, faces)


def diamond(centre, r):
    """An octahedron of radius r: a lamp or light bulb in 8 triangles."""
    x, y, z = centre
    verts = [(x + r, y, z), (x - r, y, z), (x, y + r, z), (x, y - r, z), (x, y, z + r), (x, y, z - r)]
    faces = [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)]
    bm = _bm_from(verts, faces)
    ops.recalc_normals(bm)
    return bm


def quad(a, b, c, d, facing):
    """One flat quad (an inset panel laid just proud of a face), wound so its front faces
    `facing`: the runtime culls back faces."""
    normal = ops.cross(ops.sub(b, a), ops.sub(c, a))
    corners = [a, b, c, d] if ops.dot(normal, facing) > 0 else [d, c, b, a]
    return _bm_from(corners, [(0, 1, 2, 3)])


def ribbon(a, b, half_width, across):
    """A flat two-triangle strip from a to b, `half_width` either side along `across`.

    Suspenders and stays are ribbons: a few px wide at game distance, so a box's extra sides
    would never be seen. Two-sided (4 triangles), as the runtime culls back faces.
    """
    off = ops.scale(across, half_width)
    verts = [ops.sub(a, off), ops.add(a, off), ops.add(b, off), ops.sub(b, off)]
    return _two_sided(verts, [(0, 1, 2, 3)])
