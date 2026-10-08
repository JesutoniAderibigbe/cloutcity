"""Stadium archetypes (generic, LEGAL-1: no logos, team names, sponsor marks, signage or text;
screens are plain colour panels). Two kinds:

- `ballpark`: an open-air baseball park. The field (mown grass, the infield skin and inner grass,
  the mound, the warning track) inside a seating bowl that wraps from foul pole to foul pole
  behind home plate: a raked lower deck, a glazed suite level, a raked upper deck round the
  infield under a canopy, an outer facade with arched openings, low outfield bleachers, a
  scoreboard panel and light towers. At night the field, the suites and the lamp banks glow.
- `arena`: an indoor arena: a rounded body clad in a weathered-metal band over a glazed base, a
  planted roof and an entrance canopy with a round opening over the plaza, its ring glowing
  at night.

Blender coordinates (z up) in map orientation: x east, y north, metres from the landmark's
landmarks.json location, on `land_top`; placed there unturned (heading 0). A ballpark is laid
out in its own frame (u from home plate toward centre field, v toward right field) and turned
to `cf_heading` (compass degrees, home plate to centre field).
"""

import math

import bmesh

from archetypes import facade, setback
from cclib import prim

LEVELS = {
    0: {"line": 12, "arc": 12, "fence": 16, "suites": True, "caps": True, "arches": True, "stripes": 8,
        "canopy": True, "infield": True, "tower_banks": True, "rows": 3, "walls": True, "masts": True},
    1: {"line": 6, "arc": 6, "fence": 9, "suites": True, "caps": True, "arches": False, "stripes": 0,
        "canopy": True, "infield": True, "tower_banks": True, "rows": 2, "walls": True, "masts": True},
    2: {"line": 3, "arc": 4, "fence": 5, "suites": False, "caps": False, "arches": False, "stripes": 0,
        "canopy": False, "infield": True, "tower_banks": False, "rows": 1, "walls": True, "masts": True},
    3: {"line": 2, "arc": 2, "fence": 3, "suites": False, "caps": False, "arches": False, "stripes": 0,
        "canopy": False, "infield": False, "tower_banks": False, "rows": 1, "walls": False, "masts": False},
}

FIELD_GLOW = 0.3
SUITE_GLOW = 0.55
SEAT_TONE = 0.9
SHEET_LIFT = 0.3
UPLIGHT = 0.24


def build(spec, level, view, density, builder):
    return {"ballpark": _ballpark, "arena": _arena}[spec["kind"]](spec, LEVELS[level], density, builder)


# ---- shared pieces -------------------------------------------------------------------------

def sheet(outline, z):
    """A flat convex sheet facing up (outline counter-clockwise seen from above)."""
    area = sum(outline[i][0] * outline[(i + 1) % len(outline)][1] - outline[(i + 1) % len(outline)][0] * outline[i][1]
               for i in range(len(outline)))
    pts = outline if area > 0 else list(reversed(outline))
    bm = bmesh.new()
    bm.faces.new([bm.verts.new((x, y, z)) for x, y in pts])
    return bm


def wall(a, b, z0, z1, away):
    """A vertical quad from a to b facing `away` (an (x, y) direction)."""
    return prim.quad((a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1), (away[0], away[1], 0.0))


def slope(a0, b0, za, a1, b1, zb, facing_up=True):
    """A quad from edge a0-b0 at za to edge a1-b1 at zb, facing up (raked seating)."""
    return prim.quad((a0[0], a0[1], za), (b0[0], b0[1], za), (b1[0], b1[1], zb), (a1[0], a1[1], zb),
                     (0.0, 0.0, 1.0 if facing_up else -1.0))


def box_at(cx, cy, w, d, z0, z1, ux, uy):
    """A closed box w (along u) x d centred on (cx, cy), turned to the unit direction (ux, uy)."""
    vx, vy = uy, -ux
    pts = [(cx + ux * a + vx * b, cy + uy * a + vy * b) for a, b in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2),
                                                                     (-w / 2, d / 2))]
    area = sum(pts[i][0] * pts[(i + 1) % 4][1] - pts[(i + 1) % 4][0] * pts[i][1] for i in range(4))
    return setback.extrude(pts if area > 0 else list(reversed(pts)), z0, z1)


# ---- ballpark ------------------------------------------------------------------------------

class Frame:
    """Home-plate frame -> map: u toward centre field, v toward right field."""

    def __init__(self, heading_deg, home_offset):
        t = math.radians(heading_deg)
        self.u = (math.sin(t), math.cos(t))
        self.v = (math.cos(t), -math.sin(t))
        self.o = (-self.u[0] * home_offset, -self.u[1] * home_offset)

    def xy(self, u, v):
        return (self.o[0] + u * self.u[0] + v * self.v[0], self.o[1] + u * self.u[1] + v * self.v[1])

    def home(self):
        return self.o


C45 = math.cos(math.radians(45))


def bowl_line(spec, offset, steps_line, steps_arc, reach=None):
    """The seating edge `offset` metres outside the foul lines and behind home plate, in (u, v):
    out along the left-field line from `reach` (default the foul pole) to home, round behind
    home, and out the right-field line."""
    lf, rf = spec["fence"]["lf"], spec["fence"]["rf"]
    left_reach = lf if reach is None else min(reach, lf)
    right_reach = rf if reach is None else min(reach, rf)
    pts = []
    nl = (-C45, -C45)
    for i in range(steps_line + 1):
        d = left_reach * (1 - i / steps_line)
        pts.append((d * C45 + offset * nl[0], -d * C45 + offset * nl[1]))
    for j in range(1, steps_arc):
        a = math.radians(225.0 - 90.0 * j / steps_arc)
        pts.append((offset * math.cos(a), offset * math.sin(a)))
    nr = (-C45, C45)
    for i in range(steps_line + 1):
        d = right_reach * i / steps_line
        pts.append((d * C45 + offset * nr[0], d * C45 + offset * nr[1]))
    return pts


def fence_line(spec, steps, grow=0.0):
    """The outfield fence from the left-field pole to the right-field pole, `grow` beyond it."""
    f = spec["fence"]
    pts = []
    for i in range(steps + 1):
        phi = -45.0 + 90.0 * i / steps
        t = phi / 45.0
        d = f["cf"] + ((f["lf"] if t < 0 else f["rf"]) - f["cf"]) * t * t + grow
        pts.append((d * math.cos(math.radians(phi)), d * math.sin(math.radians(phi))))
    return pts


def _tier(builder, frame, inner, outer, z_in, z_out, role, sections=True, rows=1):
    """Raked seating between two (u, v) edges, in alternating section tones, split into `rows`
    bands (a lighter aisle tone every other band)."""
    for r in range(rows):
        t0, t1 = r / rows, (r + 1) / rows
        za, zb = z_in + (z_out - z_in) * t0, z_in + (z_out - z_in) * t1
        for i in range(len(inner) - 1):
            p = [frame.xy(*inner[j]) for j in (i, i + 1)]
            q = [frame.xy(*outer[j]) for j in (i, i + 1)]
            a0, b0 = [(p[j][0] + (q[j][0] - p[j][0]) * t0, p[j][1] + (q[j][1] - p[j][1]) * t0) for j in (0, 1)]
            a1, b1 = [(p[j][0] + (q[j][0] - p[j][0]) * t1, p[j][1] + (q[j][1] - p[j][1]) * t1) for j in (0, 1)]
            tone = SEAT_TONE * (1.08 if sections and i % 2 else 1.0) * (1.06 if r % 2 else 1.0)
            builder.add(slope(a0, b0, za, a1, b1, zb), role, tone=tone, jitter=False)


def _outward(frame, p, q, centre):
    mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
    return (mx - centre[0], my - centre[1])


def _ballpark(spec, flags, density, builder):
    k = spec["detail"]
    z0 = spec["land_top"]
    frame = Frame(spec["cf_heading"], spec["home_offset"])
    home = frame.home()
    nl = max(2, int(round(flags["line"] * density)))
    na = max(2, int(round(flags["arc"] * density)))
    nf = max(3, int(round(flags["fence"] * density)))
    bowl = spec["bowl"]
    roles = spec["roles"]
    flood = facade.floodlight(builder)
    lit_field = builder.colour("lamp", FIELD_GLOW)

    # The field: grass to the stands and the fence, then the infield and the warning track.
    foul = bowl["foul"]
    edge = bowl_line(spec, foul, nl, na)
    fence = fence_line(spec, nf)
    field = [frame.xy(*p) for p in edge] + [frame.xy(*p) for p in reversed(fence)]
    builder.add(sheet(field, z0 + SHEET_LIFT), "lawn", tone=1.08, jitter=False, glow=lit_field)
    if flags["stripes"]:
        for i in range(flags["stripes"]):
            if i % 2:
                continue
            u0 = spec["fence"]["cf"] * (0.32 + 0.68 * i / flags["stripes"])
            u1 = spec["fence"]["cf"] * (0.32 + 0.68 * (i + 1) / flags["stripes"])
            half = 0.62 * u0
            stripe = [frame.xy(u0, -half), frame.xy(u1, -half * u1 / u0), frame.xy(u1, half * u1 / u0),
                      frame.xy(u0, half)]
            builder.add(sheet(stripe, z0 + SHEET_LIFT + 0.05), "lawn", tone=1.18, jitter=False, glow=lit_field)
    if flags["infield"]:
        base = spec["base_path"]
        skin = base * 1.42
        diamond = [frame.xy(0.0, 0.0), frame.xy(skin * C45, skin * C45), frame.xy(skin * 2 * C45, 0.0),
                   frame.xy(skin * C45, -skin * C45)]
        builder.add(sheet(diamond, z0 + SHEET_LIFT + 0.1), "bridge-tan", tone=0.92, jitter=False)
        inner = base * 0.86
        o = base * 0.12
        grass = [frame.xy(o, 0.0), frame.xy(o + inner * C45, inner * C45), frame.xy(o + inner * 2 * C45, 0.0),
                 frame.xy(o + inner * C45, -inner * C45)]
        builder.add(sheet(grass, z0 + SHEET_LIFT + 0.15), "lawn", tone=1.12, jitter=False, glow=lit_field)
        mx, my = frame.xy(spec["mound"], 0.0)
        mound = [(mx + 3.0 * k * math.cos(2 * math.pi * i / 8), my + 3.0 * k * math.sin(2 * math.pi * i / 8))
                 for i in range(8)]
        builder.add(sheet(mound, z0 + SHEET_LIFT + 0.2), "bridge-tan", tone=0.95, jitter=False)
        track = fence_line(spec, nf, -bowl["track"])
        if flags["stripes"]:
            for i in range(len(fence) - 1):
                quad = [frame.xy(*fence[i]), frame.xy(*fence[i + 1]), frame.xy(*track[i + 1]), frame.xy(*track[i])]
                builder.add(sheet(quad, z0 + SHEET_LIFT + 0.1), "bridge-tan", tone=0.9, jitter=False)

    # The lower deck: a front wall to the field, the raked seats, the outer facade.
    lower_in = bowl_line(spec, foul, nl, na)
    lower_out = bowl_line(spec, foul + bowl["lower_depth"], nl, na)
    z_front = z0 + bowl["front"]
    z_lower = z0 + bowl["lower_top"]
    _tier(builder, frame, lower_in, lower_out, z_front, z_lower, roles["seats"], rows=flags["rows"])
    for i in range(len(lower_in) - 1 if flags["walls"] else 0):
        a, b = frame.xy(*lower_in[i]), frame.xy(*lower_in[i + 1])
        builder.add(wall(a, b, z0, z_front, (home[0] - (a[0] + b[0]) / 2, home[1] - (a[1] + b[1]) / 2)),
                    roles["trim"], tone=0.85, jitter=False)

    # The upper deck round the infield, the glazed suite level under its front, the canopy.
    up = bowl["upper"]
    upper_in = bowl_line(spec, foul + up["setback"], nl, na, up["reach"])
    upper_out = bowl_line(spec, foul + up["setback"] + up["depth"], nl, na, up["reach"])
    z_up_in, z_up_out = z0 + up["front"], z0 + up["top"]
    _tier(builder, frame, upper_in, upper_out, z_up_in, z_up_out, roles["seats"], rows=flags["rows"])
    if flags["suites"]:
        glow = builder.colour("window", SUITE_GLOW)
        for i in range(len(upper_in) - 1):
            a, b = frame.xy(*upper_in[i]), frame.xy(*upper_in[i + 1])
            away = (home[0] - (a[0] + b[0]) / 2, home[1] - (a[1] + b[1]) / 2)
            builder.add(wall(a, b, z_lower, z_up_in, away), "glass", tone=0.75, jitter=False, glow=glow)
    if flags["canopy"]:
        canopy_in = bowl_line(spec, foul + up["setback"] + up["depth"] * 0.78, nl, na, up["reach"])
        for i in range(len(upper_out) - 1):
            a0, b0 = frame.xy(*canopy_in[i]), frame.xy(*canopy_in[i + 1])
            a1, b1 = frame.xy(*upper_out[i]), frame.xy(*upper_out[i + 1])
            zc = z_up_out + 4.0 * k
            builder.add(slope(a0, b0, zc, a1, b1, zc), roles["canopy"], tone=1.1, jitter=False, glow=flood)
            builder.add(slope(a0, b0, zc - 0.4, a1, b1, zc - 0.4, facing_up=False), roles["canopy"], tone=0.8,
                        jitter=False)

    # The outer facade: up to the lower deck everywhere and to the upper deck round the infield.
    _facade(spec, flags, frame, lower_out, z0, z_lower, home, builder)
    _facade(spec, flags, frame, upper_out, z0, z_up_out, home, builder)
    if flags["caps"]:
        for inner, outer, zi, zo in ((lower_in, lower_out, z_front, z_lower), (upper_in, upper_out, z_up_in, z_up_out)):
            for i in (0, -1):
                a, b = frame.xy(*inner[i]), frame.xy(*outer[i])
                j = 1 if i == 0 else -2
                c = frame.xy(*inner[j])
                away = (a[0] - c[0], a[1] - c[1])
                builder.add(prim.quad((a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], zo), (a[0], a[1], zi),
                                      (away[0], away[1], 0.0)), roles["facade"], tone=0.9)

    # Outfield bleachers along the fence, and the scoreboard panel beyond right-centre.
    b = spec["bleachers"]
    fence_in = fence_line(spec, nf, 2.0)
    fence_out = fence_line(spec, nf, 2.0 + b["depth"])
    _tier(builder, frame, fence_in, fence_out, z0 + 2.5, z0 + b["top"], roles["seats"], sections=False)
    _facade(spec, flags, frame, fence_out, z0, z0 + b["top"], home, builder, arches=False)
    for i in range(len(fence_in) - 1 if flags["walls"] else 0):
        p, q = frame.xy(*fence_in[i]), frame.xy(*fence_in[i + 1])
        builder.add(wall(p, q, z0, z0 + 2.5, (home[0] - (p[0] + q[0]) / 2, home[1] - (p[1] + q[1]) / 2)),
                    roles["fence"], tone=1.0, jitter=False)
    sb = spec["scoreboard"]
    phi = math.radians(sb["angle"])
    dist = spec["fence"]["cf"] + b["depth"] + sb["behind"]
    su, sv = dist * math.cos(phi), dist * math.sin(phi)
    sx, sy = frame.xy(su, sv)
    dx, dy = home[0] - sx, home[1] - sy
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    builder.add(box_at(sx, sy, sb["depth"], sb["width"], z0 + sb["base"], z0 + sb["base"] + sb["height"], ux, uy),
                "steel-dark", tone=0.8)
    for side in ((-1, 1) if flags["masts"] else ()):
        px, py = sx + uy * side * sb["width"] * 0.35, sy - ux * side * sb["width"] * 0.35
        builder.add(box_at(px, py, 1.5 * k, 1.5 * k, z0, z0 + sb["base"], ux, uy), "steel-dark", tone=0.7)
    fx, fy = sx + ux * (sb["depth"] / 2 + 0.15), sy + uy * (sb["depth"] / 2 + 0.15)
    vx, vy = uy * sb["width"] * 0.46, -ux * sb["width"] * 0.46
    zb, zt = z0 + sb["base"] + 1.0 * k, z0 + sb["base"] + sb["height"] - 1.0 * k
    builder.add(prim.quad((fx - vx, fy - vy, zb), (fx + vx, fy + vy, zb), (fx + vx, fy + vy, zt), (fx - vx, fy - vy, zt),
                          (ux, uy, 0.0)), roles["screen"], group="windows", jitter=False)

    # Light towers on the rim: a mast and a glowing lamp bank facing the field.
    t = spec["towers"]
    for (tu, tv) in t["at"]:
        x, y = frame.xy(tu, tv)
        dx, dy = home[0] + frame.u[0] * spec["fence"]["cf"] * 0.45 - x, home[1] + frame.u[1] * spec["fence"]["cf"] * 0.45 - y
        length = math.hypot(dx, dy)
        ux, uy = dx / length, dy / length
        top = z0 + t["top"]
        if flags["masts"]:
            builder.add(box_at(x, y, 1.6 * k, 1.6 * k, z0 + t["from"], top - t["bank"], ux, uy), "steel", tone=0.95)
        bank = box_at(x, y, 1.2 * k, t["bank_w"], top - t["bank"], top, ux, uy)
        if flags["tower_banks"]:
            builder.add(bank, "steel", tone=1.05)
            bx, by = x + ux * 0.7 * k, y + uy * 0.7 * k
            vx, vy = uy * t["bank_w"] * 0.45, -ux * t["bank_w"] * 0.45
            builder.add(prim.quad((bx - vx, by - vy, top - t["bank"] * 0.9), (bx + vx, by + vy, top - t["bank"] * 0.9),
                                  (bx + vx, by + vy, top - t["bank"] * 0.1), (bx - vx, by - vy, top - t["bank"] * 0.1),
                                  (ux, uy, 0.0)), "lamp", group="windows", jitter=False)
        else:
            builder.add(bank, "lamp", group="windows", jitter=False)
    return builder


def _facade(spec, flags, frame, outer, z0, z1, home, builder, arches=True):
    """The outer wall along a deck's back edge, with darker arched openings on the finest level."""
    roles = spec["roles"]
    k = spec["detail"]
    for i in range(len(outer) - 1):
        a, b = frame.xy(*outer[i]), frame.xy(*outer[i + 1])
        away = _outward(frame, a, b, home)
        builder.add(wall(a, b, z0, z1, away), roles["facade"], glow=builder.colour("lamp", UPLIGHT) if arches else None)
        if flags["walls"]:
            builder.add(wall(a, b, z1 - 1.4 * k, z1, away), roles["trim"], tone=1.1, jitter=False)
        if arches and flags["arches"]:
            length = math.hypot(b[0] - a[0], b[1] - a[1])
            n = max(1, int(length / (6.0 * k)))
            al = math.hypot(*away) or 1.0
            ox, oy = away[0] / al * 0.12, away[1] / al * 0.12
            for j in range(n):
                t0, t1 = (j + 0.22) / n, (j + 0.78) / n
                p = (a[0] + (b[0] - a[0]) * t0 + ox, a[1] + (b[1] - a[1]) * t0 + oy)
                q = (a[0] + (b[0] - a[0]) * t1 + ox, a[1] + (b[1] - a[1]) * t1 + oy)
                builder.add(wall(p, q, z0 + 1.0 * k, z0 + (z1 - z0) * 0.42, away), roles["facade"], tone=0.55,
                            jitter=False)


# ---- arena ---------------------------------------------------------------------------------

def rounded_rect(cx, cy, length, width, heading_deg, sides_per_end):
    """A stadium-shaped outline (a rectangle with round ends), counter-clockwise."""
    t = math.radians(heading_deg)
    ux, uy = math.sin(t), math.cos(t)
    vx, vy = uy, -ux
    r = width / 2
    half = max(0.0, length / 2 - r)
    pts = []
    for end, sign in ((half, 1.0), (-half, -1.0)):
        for i in range(sides_per_end + 1):
            a = math.radians(-90.0 + 180.0 * i / sides_per_end)
            along = end + sign * r * math.cos(a)
            across = sign * r * math.sin(a)
            pts.append((cx + ux * along + vx * across, cy + uy * along + vy * across))
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    return pts if area > 0 else list(reversed(pts))


def _arena(spec, flags, density, builder):
    k = spec["detail"]
    z0 = spec["land_top"]
    a = spec["arena"]
    ends = max(3, int(round(flags["arc"] * min(density, 1.5))))
    body = rounded_rect(0.0, 0.0, a["length"], a["width"], a["heading"], ends)
    flood = facade.floodlight(builder)
    # A glazed base (lit at night), the metal-clad band above it, the planted roof.
    base_top = z0 + a["base"]
    builder.add(setback.extrude(body, z0, base_top), "glass", tone=0.8, glow=builder.colour("window", SUITE_GLOW))
    band = rounded_rect(0.0, 0.0, a["length"] + 2.0 * k, a["width"] + 2.0 * k, a["heading"], ends)
    builder.add(setback.extrude(band, base_top, z0 + a["height"]), a["cladding"], tone=1.0 * a["cladding_tone"], glow=flood)
    if flags["arches"] or flags["suites"]:
        # Horizontal ribs on the band: darker lines that read as its layered panels.
        ribs = 4 if flags["arches"] else 2
        for i in range(1, ribs + 1):
            zr = base_top + (a["height"] - a["base"]) * i / (ribs + 1)
            rib = rounded_rect(0.0, 0.0, a["length"] + 2.6 * k, a["width"] + 2.6 * k, a["heading"], ends)
            builder.add(setback.extrude(rib, zr - 0.5 * k, zr + 0.5 * k), a["cladding"], tone=0.72 * a["cladding_tone"])
    roof = rounded_rect(0.0, 0.0, a["length"] - 2.0 * k, a["width"] - 2.0 * k, a["heading"], ends)
    builder.add(sheet(roof, z0 + a["height"] + 0.3), "lawn", tone=0.95)
    if flags["suites"]:
        # The roof over the bowl, a paler panel whose edge glows as a skylight band at night.
        inner_roof = rounded_rect(0.0, 0.0, a["length"] * 0.62, a["width"] * 0.58, a["heading"], ends)
        builder.add(setback.extrude(inner_roof, z0 + a["height"], z0 + a["height"] + 0.6), "steel", tone=1.05,
                    glow=builder.colour("window", SUITE_GLOW * 0.6))
    if flags["arches"]:
        # Mullions on the glazed base: darker uprights between the panes.
        n = len(body)
        for i in range(n):
            p, q = body[i], body[(i + 1) % n]
            mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
            away = (mx, my)
            dx, dy = q[0] - p[0], q[1] - p[1]
            length = math.hypot(dx, dy) or 1.0
            al = math.hypot(*away) or 1.0
            ox, oy = away[0] / al * 0.15, away[1] / al * 0.15
            for j in range(max(1, int(length / (5.0 * k)))):
                t = (j + 0.5) / max(1, int(length / (5.0 * k)))
                cx, cy = p[0] + dx * t + ox, p[1] + dy * t + oy
                hx, hy = dx / length * 0.35 * k, dy / length * 0.35 * k
                builder.add(wall((cx - hx, cy - hy), (cx + hx, cy + hy), z0, base_top, away), "steel-dark", tone=0.8,
                            jitter=False)
    # The entrance canopy toward the plaza: a broad slab on the corner with a round opening.
    c = a["canopy"]
    t = math.radians(c["heading"])
    ux, uy = math.sin(t), math.cos(t)
    cx, cy = ux * c["distance"], uy * c["distance"]
    zc = z0 + c["height"]
    ring_sides = 16 if flags["arches"] else (10 if flags["suites"] else (8 if flags["walls"] else 6))
    outer = [(cx + c["radius"] * math.cos(2 * math.pi * i / ring_sides), cy + c["radius"] * math.sin(2 * math.pi * i / ring_sides))
             for i in range(ring_sides)]
    hole = c["opening"]
    inner = [(cx + ux * c["radius"] * 0.15 + hole * math.cos(2 * math.pi * i / ring_sides),
              cy + uy * c["radius"] * 0.15 + hole * math.sin(2 * math.pi * i / ring_sides)) for i in range(ring_sides)]
    for i in range(ring_sides):
        j = (i + 1) % ring_sides
        builder.add(prim.quad((outer[i][0], outer[i][1], zc), (outer[j][0], outer[j][1], zc), (inner[j][0], inner[j][1], zc),
                              (inner[i][0], inner[i][1], zc), (0.0, 0.0, 1.0)), a["cladding"], tone=0.95 * a["cladding_tone"], jitter=False)
        if not flags["walls"]:
            continue
        builder.add(prim.quad((outer[i][0], outer[i][1], zc - c["thickness"]), (outer[j][0], outer[j][1], zc - c["thickness"]),
                              (inner[j][0], inner[j][1], zc - c["thickness"]), (inner[i][0], inner[i][1], zc - c["thickness"]),
                              (0.0, 0.0, -1.0)), a["cladding"], tone=0.7 * a["cladding_tone"], jitter=False)
        builder.add(wall(outer[i], outer[j], zc - c["thickness"], zc, (outer[i][0] - cx, outer[i][1] - cy)),
                    a["cladding"], tone=0.85 * a["cladding_tone"], jitter=False)
        # The opening's rim: a plain ring screen that glows at night (no text).
        builder.add(wall(inner[i], inner[j], zc - c["thickness"], zc, (cx - inner[i][0], cy - inner[i][1])),
                    a["screen"], group="windows", jitter=False)
    if flags["walls"]:
        # The plaza under the canopy, paved.
        builder.add(sheet(outer, z0 + 0.3), "granite", tone=0.95, jitter=False)
    return builder


# ---- specs from measurements ---------------------------------------------------------------

def ballpark_spec(data, true_scale, roles):
    """A ballpark spec from a measurements file (the keys the ballpark files share)."""
    m = data["measurements"]["dimensions"]
    game = data["measurements"]["gameScale"]
    h = 1.0 if true_scale else game["height"]
    p = 1.0 if true_scale else game["plan"]
    v = lambda key: m[key]["valueM"]  # noqa: E731
    foul = v("foulM") * p
    lower = v("lowerDepthM") * p
    up_setback, up_depth = v("upperSetbackM") * p, v("upperDepthM") * p
    reach = v("upperReachM") * p
    rim = foul + up_setback + up_depth + 2.0 * p
    lf, rf = v("fenceLeftM") * p, v("fenceRightM") * p
    # Light towers: on the upper deck's back corners and out along both lines past it.
    towers = []
    for d in (reach * 0.45, reach * 0.98):
        towers.append((d * C45 - rim * C45, -d * C45 - rim * C45))
        towers.append((d * C45 - rim * C45, d * C45 + rim * C45))
    for d, side in ((lf * 0.98, -1), (rf * 0.98, 1)):
        o = foul + lower + 4.0 * p
        towers.append((d * C45 - o * C45, side * (d * C45 + o * C45)))
    top = expected_height(data, true_scale)
    return {
        "kind": "ballpark",
        "id": data["id"],
        "detail": (h * p) ** 0.5,
        "land_top": data["land_top"],
        "roles": roles,
        "cf_heading": v("centreFieldHeadingDeg"),
        "home_offset": v("homeOffsetM") * p,
        "fence": {"lf": lf, "cf": v("fenceCentreM") * p, "rf": rf},
        "base_path": v("basePathM") * p,
        "mound": v("moundM") * p,
        "bowl": {
            "foul": foul,
            "track": 4.5 * p,
            "lower_depth": lower,
            "front": v("lowerFrontM") * h,
            "lower_top": v("lowerTopM") * h,
            "upper": {"setback": up_setback, "depth": up_depth, "front": v("upperFrontM") * h,
                      "top": v("upperTopM") * h, "reach": reach},
        },
        "bleachers": {"depth": v("bleacherDepthM") * p, "top": v("bleacherTopM") * h},
        "scoreboard": {"angle": 18.0, "behind": 6.0 * p, "width": v("scoreboardWidthM") * p,
                       "height": v("scoreboardHeightM") * h, "base": v("scoreboardBaseM") * h, "depth": 3.0 * p},
        "towers": {"at": towers, "top": top, "from": v("upperTopM") * h * 0.5, "bank": 7.0 * h, "bank_w": 16.0 * p},
    }


def expected_height(data, true_scale=False):
    real = data["measurements"]["dimensions"]["heightM"]["valueM"]
    return real if true_scale else real * data["measurements"]["gameScale"]["height"]
