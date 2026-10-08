"""Locs: a crown with eleven locs falling past the shoulders at the back and sides.

Licence: project-original. Modelled for Clout City: NYC (S16a A0.3, DEC-28): a shell over the skull and square locs, none in front of the face.
Attaches to the `head` joint; colour slot: `hair` (hair-900, takes the hair colour).
"""

# --- Shared avatar-attachment helpers. The lock pins only the runner and this script, so each
# --- avatar script carries its own copy; keep the copies identical (scripts/blender/avatar/*.py).
#
# Frame: the Kenney Mini Characters bind pose as the asset build fits it (fit.scale 2.2, metres),
# glTF axes (+y up, +z out of the face). The head is a rounded block about x +-0.46,
# y 0.75..1.45, z +-0.35 (the face's front plane at z 0.352, the eyes at y 1.01..1.12, the mouth
# at y 0.88..0.92, the ears at x +-0.50); the torso is about x +-0.33, z -0.36..0.23 below
# y 0.8, the arms out to the sides. The runtime hangs the model off its joint at that joint's
# bind pose, so it lines up with no offset. Colours are theme.json `models` token hexes.
#
# Geometry is written triangle by triangle (no bpy.ops primitives or modifiers, whose face order
# varies from run to run), so the GLB is byte-identical every build.

import math


def _linear(channel):
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


class Parts:
    """Triangles by colour, in glTF coordinates; build() makes one object per colour."""

    def __init__(self):
        self.tris = {}

    def _add(self, colour, a, b, c, inside):
        # Wind each triangle so its normal points away from the shape's inside.
        centroid = tuple((a[i] + b[i] + c[i]) / 3 for i in range(3))
        if _dot(_cross(_sub(b, a), _sub(c, a)), _sub(centroid, inside(centroid))) < 0:
            b, c = c, b
        self.tris.setdefault(colour, []).append((a, b, c))

    def _quad(self, colour, a, b, c, d, inside):
        self._add(colour, a, b, c, inside)
        self._add(colour, a, c, d, inside)

    def box(self, colour, lo, hi, bevel=0.0):
        """An axis-aligned box between corners lo and hi, its edges chamfered by bevel."""
        mid = tuple((lo[i] + hi[i]) / 2 for i in range(3))
        half = tuple((hi[i] - lo[i]) / 2 for i in range(3))

        def inside(_point):
            return mid

        def corner(s, axis):
            # Corner s (a sign per axis) on the face across `axis`: inset on the other two axes.
            return tuple(
                mid[i] + s[i] * (half[i] if i == axis or bevel == 0 else half[i] - bevel)
                for i in range(3)
            )

        def signs(fixed):
            # The two corners along the edge where the axes in `fixed` take the given signs.
            free = [i for i in range(3) if i not in fixed][0]
            out = []
            for sign in (-1, 1):
                s = [0, 0, 0]
                for axis, value in fixed.items():
                    s[axis] = value
                s[free] = sign
                out.append(s)
            return out

        for axis in range(3):
            u, v = [i for i in range(3) if i != axis]
            for side in (-1, 1):
                ring = []
                for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    s = [0, 0, 0]
                    s[axis], s[u], s[v] = side, su, sv
                    ring.append(corner(s, axis))
                self._quad(colour, *ring, inside)
        if bevel == 0:
            return
        for x in (-1, 1):
            for y in (-1, 1):
                for z in (-1, 1):
                    s = (x, y, z)
                    self._add(colour, corner(s, 0), corner(s, 1), corner(s, 2), inside)
        for a, b in ((0, 1), (0, 2), (1, 2)):
            for sa in (-1, 1):
                for sb in (-1, 1):
                    first, second = signs({a: sa, b: sb})
                    self._quad(
                        colour,
                        corner(first, a),
                        corner(second, a),
                        corner(second, b),
                        corner(first, b),
                        inside,
                    )

    def ellipsoid(self, colour, centre, radii, segments, rings):
        """A UV ellipsoid with radii (x, y, z) about the vertical axis."""

        def inside(_point):
            return centre

        def at(ring, seg):
            polar = math.pi * ring / rings
            azimuth = 2 * math.pi * (seg % segments) / segments
            return (
                centre[0] + radii[0] * math.sin(polar) * math.cos(azimuth),
                centre[1] + radii[1] * math.cos(polar),
                centre[2] + radii[2] * math.sin(polar) * math.sin(azimuth),
            )

        for ring in range(rings):
            for seg in range(segments):
                a, b = at(ring, seg), at(ring, seg + 1)
                c, d = at(ring + 1, seg + 1), at(ring + 1, seg)
                if ring == 0:
                    self._add(colour, a, c, d, inside)
                elif ring == rings - 1:
                    self._add(colour, a, b, c, inside)
                else:
                    self._quad(colour, a, b, c, d, inside)

    def bar(self, colour, start, end, radius, sides=4):
        """A capped prism of `sides` sides between points start and end (a lock, a strap)."""
        axis = _sub(end, start)
        length = math.sqrt(_dot(axis, axis))
        w = tuple(value / length for value in axis)
        helper = (0.0, 0.0, 1.0) if abs(w[2]) < 0.9 else (1.0, 0.0, 0.0)
        u = _cross(w, helper)
        norm = math.sqrt(_dot(u, u))
        u = tuple(value / norm for value in u)
        v = _cross(w, u)
        mid = tuple((start[i] + end[i]) / 2 for i in range(3))

        def on_axis(point):
            t = _dot(_sub(point, start), w)
            return tuple(start[i] + w[i] * t for i in range(3))

        def centre(_point):
            return mid

        def at(origin, k):
            angle = 2 * math.pi * (k % sides) / sides + math.pi / sides
            return tuple(
                origin[i] + radius * (math.cos(angle) * u[i] + math.sin(angle) * v[i])
                for i in range(3)
            )

        for k in range(sides):
            self._quad(colour, at(start, k), at(start, k + 1), at(end, k + 1), at(end, k), on_axis)
        for origin in (start, end):
            for k in range(1, sides - 1):
                self._add(colour, at(origin, 0), at(origin, k), at(origin, k + 1), centre)

    def strand(self, colour, top, bottom_y, radius, sides):
        """A vertical prism (a lock or a braid) from point top down to y bottom_y."""
        self.bar(colour, (top[0], bottom_y, top[2]), top, radius, sides)

    def hoop(self, colour, centre, major, minor, segments, sides):
        """A ring standing in the yz plane (an earring seen side on)."""

        def at(k, j):
            angle = 2 * math.pi * (k % segments) / segments
            tube = 2 * math.pi * (j % sides) / sides
            r = major + minor * math.cos(tube)
            return (
                centre[0] + minor * math.sin(tube),
                centre[1] + r * math.cos(angle),
                centre[2] + r * math.sin(angle),
            )

        def inside(point):
            dy, dz = point[1] - centre[1], point[2] - centre[2]
            scale = major / max(math.sqrt(dy * dy + dz * dz), 1e-9)
            return (centre[0], centre[1] + dy * scale, centre[2] + dz * scale)

        for k in range(segments):
            for j in range(sides):
                self._quad(colour, at(k, j), at(k + 1, j), at(k + 1, j + 1), at(k, j + 1), inside)

    def build(self, bpy, name):
        for index, (colour, tris) in enumerate(self.tris.items()):
            verts = [(p[0], -p[2], p[1]) for tri in tris for p in tri]  # glTF to Blender z-up
            faces = [(3 * i, 3 * i + 1, 3 * i + 2) for i in range(len(tris))]
            mesh = bpy.data.meshes.new(f"{name}-{index}")
            mesh.from_pydata(verts, [], faces)
            mesh.polygons.foreach_set("use_smooth", [False] * len(faces))
            mesh.update()
            rgb = [_linear(int(colour[i : i + 2], 16) / 255) for i in (1, 3, 5)]
            mat = bpy.data.materials.new(f"{name}-{index}")
            mat.use_nodes = True
            bsdf = mat.node_tree.nodes["Principled BSDF"]
            bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
            bsdf.inputs["Roughness"].default_value = 1.0
            mesh.materials.append(mat)
            obj = bpy.data.objects.new(f"{name}-{index}", mesh)
            bpy.context.scene.collection.objects.link(obj)


# --- End of the shared helpers.

LOCS = [(-0.34, -0.4), (-0.17, -0.4), (0.0, -0.4), (0.17, -0.4), (0.34, -0.4), (-0.5, -0.24), (-0.5, -0.04), (-0.5, 0.16), (0.5, -0.24), (0.5, -0.04), (0.5, 0.16)]


def build(bpy):
    parts = Parts()
    hair = "#1d1714"
    parts.box(hair, (-0.485, 1.18, -0.38), (0.485, 1.49, 0.37), bevel=0.04)
    for x, z in LOCS:
        parts.strand(hair, (x, 1.3, z), 0.5 if z < -0.3 else 0.62, 0.05, 4)
    parts.build(bpy, "hair-locs")
