"""Generic city bus for the living city (S04l, DEC-52): the ambient traffic's far-away bus.

Licence: project-original. Modelled for Clout City: NYC (DEC-25/28 rule for our own models): a
generic 12 m low-floor city bus, about 2.55 m wide and 3.1 m tall, drawn at ambient scale
(a few pixels on a phone), so it is a bevelled body with a glass band, pillars, doors, lamps,
bumpers and two axles. No livery, logo, route number, destination text or transit-agency
colours (LEGAL, GR-31): the body is plain silver-300 and the runtime repaints it per instance.

Frame: metres, glTF axes (+y up), the nose towards +z, centred on x and z, wheels on y = 0.
The kerb-side doors are on the bus's right (-x when facing +z). Colour roles for the ambient
buckets (src/scene/ambient/vehicleKits.ts): `body` slot silver-300 (paint), glass-600, rubber-900
and asphalt-800 (glass), lamp-200 and signal-500 (light). Colours are theme.json `models` hexes.
"""

# --- Shared helpers, copied from the avatar attachment scripts (scripts/blender/avatar/*.py):
# --- the lock pins only the runner and this script, so each script carries its own copy.
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

LENGTH = 12.0
WIDTH = 2.55
HEIGHT = 3.1

PAINT = "#b9bec4"  # silver-300
GLASS = "#4f6b78"  # glass-600
RUBBER = "#1f2023"  # rubber-900
BUMPER = "#333538"  # asphalt-800
LAMP = "#ffe2a8"  # lamp-200
TAIL = "#c8362b"  # signal-500


def build(bpy):
    parts = Parts()
    half_l = LENGTH / 2
    half_w = WIDTH / 2
    roof = HEIGHT - 0.15

    # Body and roof cap (paint).
    parts.box(PAINT, (-half_w, 0.35, -half_l), (half_w, roof, half_l), bevel=0.08)
    parts.box(PAINT, (-half_w + 0.12, roof, -half_l + 0.3), (half_w - 0.12, HEIGHT, half_l - 0.4))

    # Side window band, through the body so one box shows on both sides, and its pillars.
    parts.box(GLASS, (-half_w - 0.015, 1.55, -half_l + 0.6), (half_w + 0.015, 2.6, half_l - 1.4))
    for z in (-3.6, -1.6, 0.4, 2.4):
        parts.box(PAINT, (-half_w - 0.025, 1.5, z - 0.12), (half_w + 0.025, 2.65, z + 0.12))

    # Windscreen and rear window.
    parts.box(GLASS, (-half_w + 0.12, 1.2, half_l - 0.01), (half_w - 0.12, 2.7, half_l + 0.02))
    parts.box(GLASS, (-1.0, 1.9, -half_l - 0.02), (1.0, 2.6, -half_l + 0.01))

    # Front and middle doors on the kerb side.
    for z0, z1 in ((4.3, 5.4), (0.6, 1.8)):
        parts.box(GLASS, (-half_w - 0.035, 0.45, z0), (-half_w + 0.02, 2.55, z1))

    # Head lamps, tail lamps, bumpers.
    for x in (-0.85, 0.85):
        parts.box(LAMP, (x - 0.2, 0.6, half_l - 0.01), (x + 0.2, 0.85, half_l + 0.04))
    for x in (-0.95, 0.95):
        parts.box(TAIL, (x - 0.12, 0.9, -half_l - 0.04), (x + 0.12, 1.4, -half_l + 0.01))
    parts.box(BUMPER, (-half_w + 0.05, 0.3, half_l - 0.05), (half_w - 0.05, 0.55, half_l + 0.12))
    parts.box(BUMPER, (-half_w + 0.05, 0.3, -half_l - 0.12), (half_w - 0.05, 0.55, -half_l + 0.05))

    # Two axles, each one six-sided bar through both wheels.
    for z in (3.6, -2.6):
        parts.bar(RUBBER, (-half_w - 0.03, 0.5, z), (half_w + 0.03, 0.5, z), 0.5, 6)

    parts.build(bpy, "bus-ambient")
