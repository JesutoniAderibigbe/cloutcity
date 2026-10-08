"""Locs: a crown with twelve locs falling to the shoulders at the back and sides.

Licence: project-original. Modelled for Clout City: NYC (S16a A0.3, DEC-28; refit to the modular frame in S16b P2a): a cap over the skull and locs that run from under it, out over its rim and down, none in front of the face.
Attaches to the `head` joint; colour slot: `hair` (hair-900, takes the hair colour).
"""

# --- Shared avatar-attachment helpers. The lock pins only the runner, this script and
# --- data/avatar/frame.json, so each avatar script carries its own copy; keep the copies identical
# --- (scripts/blender/avatar/*.py).
#
# Frame (S16b): the Quaternius modular characters' bind pose (T-pose, metres, glTF axes: +y up,
# +z out of the face), read from data/avatar/frame.json, which `npm run assets:build` derives
# from the packs. Both faces (head-f, head-m) hang off the same `head` joint at about
# (0, 1.587, 0.043). The skull is a superellipsoid, boxy like the pack heads, set from the
# frame's eye line, crown, back and face width so that it encloses the scalp of both faces (the
# women's face is open behind the hairline, so the men's closed skull sets the crown; the women
# wear scalp-cap-f there). The torso joint is the pack's Chest. Everything is modelled in that bind space: the runtime skins each
# attachment with weight 1 on its joint, so it lines up with no offset. Colours are theme.json
# `models` token hexes.
#
# Face anchors the frame file does not carry (the mouth, the chin, the jaw outline, the ear lobe)
# are offsets from the measured eye line, measured on both pack heads in Blender 5.2.2 (P2a).
#
# Geometry is written triangle by triangle (no bpy.ops primitives or modifiers, whose face order
# varies from run to run), so the GLB is byte-identical every build.

import json
import math

FRAME_PATH = "data/avatar/frame.json"
EYES = {"head-f": "Brown", "head-m": "Eye"}
BROWS = {"head-f": "Hair_Brown", "head-m": "Eyebrows"}
# Superellipsoid exponents of the skull, fitted in Blender to the scalp vertices of both pack
# heads: from the crown down (SQUIRCLE) and round the head (BOXY); 1 and 2 would be an ellipsoid.
SQUIRCLE = 0.6
BOXY = 3.5
# The jaw outline below the eyes, (eye-relative height, half width, front z), the widest of the
# two pack heads at each height; the outline is a half ellipse about z = JAW_Z.
JAW = (
    (-0.150, 0.036, 0.085),
    (-0.133, 0.048, 0.146),
    (-0.110, 0.057, 0.153),
    (-0.090, 0.072, 0.157),
    (-0.070, 0.082, 0.160),
    (-0.050, 0.088, 0.152),
    (-0.010, 0.094, 0.150),
)
JAW_Z = 0.055


def _linear(channel):
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _lerp(a, b, t):
    return a + (b - a) * t


def _signed_pow(value, power):
    return math.copysign(abs(value) ** power, value)


class Frame:
    """The bind-pose head and torso from data/avatar/frame.json, and the skull fitted to it."""

    def __init__(self, ctx):
        with open(ctx["deps"][FRAME_PATH], encoding="utf-8") as handle:
            models = json.load(handle)["models"]
        faces = [models["head-f"], models["head-m"]]
        for name in ("neck", "head", "torso"):
            a, b = faces[0]["joints"][name], faces[1]["joints"][name]
            if max(abs(a[i] - b[i]) for i in range(3)) > 1e-3:
                raise RuntimeError(f"frame: joint {name} differs between head-f and head-m")
        self.joints = faces[0]["joints"]
        self.head = tuple(self.joints["head"])
        self.torso = tuple(self.joints["torso"])

        def bounds(model, material):
            return models[model]["materials"][material]

        eyes = [bounds(model, material) for model, material in EYES.items()]
        brows = [bounds(model, material) for model, material in BROWS.items()]
        skins = [bounds(model, "Skin") for model in ("head-f", "head-m")]
        self.eye_lo = min(e["min"][1] for e in eyes)
        self.eye_hi = max(e["max"][1] for e in eyes)
        self.eye_y = (self.eye_lo + self.eye_hi) / 2
        self.eye_x = max(e["max"][0] for e in eyes)
        self.eye_z = max(e["max"][2] for e in eyes)
        self.brow_y = max(b["max"][1] for b in brows)
        self.brow_z = max(b["max"][2] for b in brows)
        self.top = max(s["max"][1] for s in skins)
        self.back = min(s["min"][2] for s in skins)
        self.face_x = min(s["max"][0] for s in skins)
        self.ear_x = max(max(s["max"][0], -s["min"][0]) for s in skins)
        self.nose_z = max(s["max"][2] for s in skins)
        cy, cz = self.eye_y + 0.022, self.head[2]
        self.centre = (0.0, cy, cz)
        self.radii = (self.face_x + 0.004, self.top - cy + 0.001, cz - self.back)
        self.mouth_y = self.eye_y - 0.092
        self.chin_y = self.eye_y - 0.135
        self.lobe = (0.0995, self.eye_y - 0.030, 0.066)
        # The bodies: the back of the everyday tops and the shoulder line (tote, drapes).
        tops = [
            bounds("outfit-w-casual", "White"),
            bounds("outfit-m-casual", "LightBrown"),
            bounds("outfit-w-casual", "Orange"),
            bounds("outfit-m-casual", "LightBlue"),
        ]
        self.body_back = min(t["min"][2] for t in tops)
        self.shoulder = max(
            models[m]["joints"]["upper-arm-left"][1] for m in ("head-f", "head-m")
        )

    # Points on the skull: polar angle p from the crown, azimuth az from +x towards the face
    # (+z), so az = pi/2 is the front and 3*pi/2 the back; grow lifts the point off the skull.
    def skull(self, polar, az, grow=0.0):
        g = grow if isinstance(grow, tuple) else (grow, grow, grow)
        c, s = math.cos(polar), math.sin(polar)
        fy, fh = _signed_pow(c, SQUIRCLE), abs(s) ** SQUIRCLE
        fx, fz = _signed_pow(math.cos(az), 2 / BOXY), _signed_pow(math.sin(az), 2 / BOXY)
        cx, cy, cz = self.centre
        rx, ry, rz = self.radii
        return (
            cx + (rx + g[0]) * fh * fx,
            cy + (ry + g[1]) * fy,
            cz + (rz + g[2]) * fh * fz,
        )

    def polar_at(self, y):
        """The polar angle at which the skull reaches height y."""
        t = max(-1.0, min(1.0, (y - self.centre[1]) / self.radii[1]))
        return math.acos(_signed_pow(t, 1 / SQUIRCLE))

    def skull_norm(self, point):
        """1 on the skull, below 1 inside it."""
        dx = (point[0] - self.centre[0]) / self.radii[0]
        dy = (point[1] - self.centre[1]) / self.radii[1]
        dz = (point[2] - self.centre[2]) / self.radii[2]
        exponent = 2 / SQUIRCLE
        around = (abs(dx) ** BOXY + abs(dz) ** BOXY) ** (1 / BOXY)
        return abs(dy) ** exponent + around**exponent

    def hairline(self, points):
        """An edge (az -> polar) through (azimuth in degrees, height) points on the +x side, from
        the front (90) round to the back (-90), mirrored to the -x side, linear in azimuth."""
        marks = {}
        for degrees, y in points:
            for a in (degrees, 180 - degrees):
                marks[round(math.radians(a % 360), 9)] = self.polar_at(y)
        ring = sorted(marks.items())
        ring = [(ring[-1][0] - 2 * math.pi, ring[-1][1])] + ring + [(ring[0][0] + 2 * math.pi, ring[0][1])]

        def edge(az):
            a = az % (2 * math.pi)
            for (a0, p0), (a1, p1) in zip(ring, ring[1:]):
                if a0 <= a <= a1:
                    return p0 + (p1 - p0) * (a - a0) / (a1 - a0)
            return ring[0][1]

        return edge

    def jaw(self, y, theta, grow=0.0):
        """A point on the jaw outline at height y; theta runs 0 (the +x side) to pi (-x side)."""
        dy = y - self.eye_y
        rows = JAW
        if dy <= rows[0][0]:
            _, half, front = rows[0]
        elif dy >= rows[-1][0]:
            _, half, front = rows[-1]
        else:
            for (y0, a0, f0), (y1, a1, f1) in zip(rows, rows[1:]):
                if y0 <= dy <= y1:
                    t = (dy - y0) / (y1 - y0)
                    half, front = _lerp(a0, a1, t), _lerp(f0, f1, t)
                    break
        return (
            (half + grow) * math.cos(theta),
            y,
            JAW_Z + (front - JAW_Z + grow) * math.sin(theta),
        )

    def jaw_norm(self, point):
        """1 on the jaw outline at the point's height, below 1 inside it."""
        on_side = self.jaw(point[1], 0.0)
        on_front = self.jaw(point[1], math.pi / 2)
        dx = point[0] / on_side[0]
        dz = (point[2] - JAW_Z) / (on_front[2] - JAW_Z)
        return math.sqrt(dx * dx + dz * dz)


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

    def grid(self, colour, rows, inside, skip=None):
        """Quads between consecutive rows of points (each row the same length)."""
        for i in range(len(rows) - 1):
            for j in range(len(rows[i]) - 1):
                if skip is not None and skip(i, j):
                    continue
                a, b = rows[i][j], rows[i][j + 1]
                c, d = rows[i + 1][j + 1], rows[i + 1][j]
                self._quad(colour, a, b, c, d, inside)

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

    def bar(self, colour, start, end, radius, sides=4, caps=(True, True)):
        """A prism of `sides` sides between points start and end (a lock, a strap), capped at the
        ends caps says (an end hidden inside another shape needs none)."""
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
        for origin, capped in zip((start, end), caps):
            if not capped:
                continue
            for k in range(1, sides - 1):
                self._add(colour, at(origin, 0), at(origin, k), at(origin, k + 1), centre)

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

    def shell(self, colour, frame, edge, grow, segments, rings, offset=0.5, shape=None):
        """A cap over the skull from the crown down to edge(az); grow(t) is its lift (a number or
        an (x, y, z) triple) at the fraction t of the way to the edge, so a style can swell over
        the crown and close onto the scalp at its hairline; shape(point, t) may move each point
        on (towards a rounder outline). Azimuths sit half a step off +x."""

        def inside(_point):
            return frame.centre

        def az(j):
            return 2 * math.pi * ((j % segments) + offset) / segments

        def point(i, j):
            p = frame.skull(edge(az(j)) * i / rings, az(j), grow(i / rings))
            return p if shape is None else shape(p, i / rings)

        pts = [[point(i, j) for j in range(segments)] for i in range(rings + 1)]
        for j in range(segments):
            k = (j + 1) % segments
            self._add(colour, pts[0][j], pts[1][j], pts[1][k], inside)
            for i in range(1, rings):
                self._quad(colour, pts[i][j], pts[i][k], pts[i + 1][k], pts[i + 1][j], inside)
        return pts

    def ring_band(self, colour, frame, lower, upper, segments, offset=0.5):
        """A raised band round the skull: lower(az) and upper(az) give (polar, grow) of its two
        edges, the band standing proud between them (a cuff, a wrap)."""

        def az(j):
            return 2 * math.pi * ((j % segments) + offset) / segments

        def inside(_point):
            return frame.centre

        for j in range(segments):
            k = (j + 1) % segments
            rows = []
            for fn in (lower, upper):
                rows.append([frame.skull(fn(az(n))[0], az(n), fn(az(n))[1]) for n in (j, k)])
            self._quad(colour, rows[0][0], rows[0][1], rows[1][1], rows[1][0], inside)

    def slab(self, colour, frame, theta, height, grow, steps):
        """A thick patch on the jaw outline (a moustache, a chin beard): theta and height are
        (start, end) ranges, grow (inner, outer); the inner face lies on the skin, unseen."""
        t0, t1 = theta
        y0, y1 = height
        g_in, g_out = grow
        thetas = [_lerp(t0, t1, k / steps) for k in range(steps + 1)]
        outer_lo = [frame.jaw(y0, t, g_out) for t in thetas]
        outer_hi = [frame.jaw(y1, t, g_out) for t in thetas]
        inner_lo = [frame.jaw(y0, t, g_in) for t in thetas]
        inner_hi = [frame.jaw(y1, t, g_in) for t in thetas]
        every = outer_lo + outer_hi + inner_lo + inner_hi
        mid = tuple(sum(p[i] for p in every) / len(every) for i in range(3))

        def inside(_point):
            return mid

        for k in range(steps):
            self._quad(colour, outer_lo[k], outer_lo[k + 1], outer_hi[k + 1], outer_hi[k], inside)
            self._quad(colour, outer_hi[k], outer_hi[k + 1], inner_hi[k + 1], inner_hi[k], inside)
            self._quad(colour, outer_lo[k], outer_lo[k + 1], inner_lo[k + 1], inner_lo[k], inside)
        for k in (0, steps):
            self._quad(colour, outer_lo[k], outer_hi[k], inner_hi[k], inner_lo[k], inside)

    def points(self):
        return [p for tris in self.tris.values() for tri in tris for p in tri]

    def triangles(self):
        return sum(len(tris) for tris in self.tris.values())

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


# Bounds checks: a failed check fails the Blender build (run.py exits 1).


def _fail(name, message):
    raise RuntimeError(f"{name}: {message}")


def check_triangles(name, parts, cap):
    if parts.triangles() > cap:
        _fail(name, f"{parts.triangles()} triangles, over the cap of {cap}")


def check_covers_crown(name, parts, frame):
    """Hair and head coverings: over the top of the head, and never inside the skull."""
    pts = parts.points()
    crown = [p for p in pts if abs(p[0]) < 0.03 and abs(p[2] - frame.centre[2]) < 0.04]
    if not crown or max(p[1] for p in crown) < frame.top + 0.002:
        _fail(name, "does not cover the top of the head")
    for p in pts:
        if p[1] > frame.eye_y + 0.02 and frame.skull_norm(p) < 0.97:
            _fail(name, f"sinks into the skull at {tuple(round(v, 4) for v in p)}")


def check_clear_of_face(name, parts, frame):
    """Nothing in front of the eyes: the face stays open between the brows and the chin."""
    for p in parts.points():
        if abs(p[0]) < frame.eye_x and frame.chin_y < p[1] < frame.brow_y and p[2] > 0.11:
            _fail(name, f"covers the face at {tuple(round(v, 4) for v in p)}")


def check_ahead_of_face(name, parts, frame):
    """Facial hair: below the eyes, above the neck, never inside the jaw outline."""
    for p in parts.points():
        if not frame.chin_y - 0.03 < p[1] < frame.eye_lo:
            _fail(name, f"leaves the lower face at y {p[1]:.4f}")
        if frame.jaw_norm(p) < 0.999:
            _fail(name, f"sinks into the face at {tuple(round(v, 4) for v in p)}")
    front = max(p[2] for p in parts.points())
    if front < frame.eye_z - 0.02:
        _fail(name, "does not reach the front of the face")


# --- End of the shared helpers.


# Azimuths (degrees from +x towards the face) of the locs round the back and the sides.
LOCS = (198, 216, 234, 252, 270, 288, 306, 324, 342, 164, -6, 16)


def build(bpy, ctx):
    frame = Frame(ctx)
    parts = Parts()
    hair = "#1d1714"
    edge = frame.hairline(((90, frame.brow_y + 0.072), (60, frame.brow_y + 0.062), (32, frame.eye_y - 0.004), (14, frame.eye_y + 0.016), (-12, frame.eye_y + 0.008), (-50, frame.eye_y - 0.045), (-90, frame.eye_y - 0.080)))
    parts.shell(hair, frame, edge, lambda t: 0.004 + 0.010 * (1 - t**4), 12, 4)
    for degrees in LOCS:
        az = math.radians(degrees)
        back = math.sin(az) < -0.3
        root = frame.skull(edge(az) - 0.30, az, 0.011)
        rim = frame.skull(edge(az) + 0.03, az, 0.020)
        end = (
            rim[0] * 1.04,
            frame.shoulder - 0.02 if back else frame.chin_y - 0.02,
            rim[2] - (0.022 if back else 0.0),
        )
        parts.bar(hair, root, rim, 0.0095, 3, caps=(False, False))
        parts.bar(hair, rim, end, 0.0095, 3, caps=(False, True))
    check_triangles("hair-locs", parts, 260)
    check_covers_crown("hair-locs", parts, frame)
    check_clear_of_face("hair-locs", parts, frame)
    parts.build(bpy, "hair-locs")
