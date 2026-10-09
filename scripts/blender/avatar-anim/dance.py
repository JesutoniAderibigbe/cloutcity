"""Dance clips for the modular avatar rigs (S16c), on the beat at 120 BPM.

Licence: `dance-groove` is the Quaternius "Universal Animation Library" Standard `Dance_Loop`
(CC0 1.0, pinned in scripts/assets/sources.lock.json), retargeted. `dance-party` and
`dance-bounce` are project-original: keyframed here on the UAL skeleton and retargeted the same
way, so every rig gets the same moves.

Run by `npm run blender:build` through scripts/blender/run.py, once per body frame (`--arg
frame=f` for avatar-dance-f, `frame=m` for avatar-dance-m). The retarget machinery is
retarget.py's (a dep of this script, so a change there rebuilds these clips too):

1. `dance-groove` samples the UAL clip like talk and sit.
2. The authored clips are poses keyed on the beat (`party`, `bounce` below: a function of the
   beat count, periodic over the loop), sampled at FPS. A pose turns UAL joints relative to
   their parent in the UAL bind frame (+x the character's left, +y up, +z forward; the bind is a
   T-pose), moves the pelvis, and plants each foot where it says: the legs are solved by
   two-bone IK with the knee bending forward, so the feet stay on the floor while the hips
   bounce and sway.
3. retarget.py turns each UAL world pose into the target rig's joints, and writes the GLB: only
   the 22 joints and the three clips. The asset build ships it as its own rig model (the
   `avatar-dance-*` catalog entries), fetched only by the venue interiors.
"""

import json
import math
import runpy
import zipfile

from mathutils import Matrix, Quaternion, Vector

RETARGET = "scripts/blender/avatar-anim/retarget.py"
FRAME_PATH = "data/avatar/frame.json"
BPM = 120.0
FPS = 20
LOOP_BEATS = 4
FRAMES = {
    "f": ("quaternius-modular-women/glTF/Casual.gltf", "avatar-dance-f", "avatar-rig-f"),
    "m": ("quaternius-modular-men/glTF/Casual_Hoodie.gltf", "avatar-dance-m", "avatar-rig-m"),
}
LEGS = {"l": ("thigh_l", "calf_l", "foot_l"), "r": ("thigh_r", "calf_r", "foot_r")}


def rx(deg):
    return Quaternion((1.0, 0.0, 0.0), math.radians(deg))


def ry(deg):
    return Quaternion((0.0, 1.0, 0.0), math.radians(deg))


def rz(deg):
    return Quaternion((0.0, 0.0, 1.0), math.radians(deg))


def hit(beat, sharp=1.5):
    """1 on every beat, easing to 0 half-way between: the body's drop on the beat."""
    return ((1.0 + math.cos(2.0 * math.pi * beat)) / 2.0) ** sharp


def swing(beat, beats):
    """A smooth side-to-side over `beats` beats: 0 at 0, +1 a quarter in, -1 three quarters in."""
    return math.sin(2.0 * math.pi * beat / beats)


def ease(u):
    u = min(1.0, max(0.0, u))
    return u * u * (3.0 - 2.0 * u)


def arm(side, down_deg, forward_deg, elbow_deg, twist_deg=0.0):
    """An arm from the T-pose: lowered `down_deg` (90 hangs it, negative raises it: -90 straight up), swung
    `forward_deg` forward, the elbow bent `elbow_deg` with the forearm coming forward."""
    sign = 1.0 if side == "l" else -1.0
    upper = rx(-forward_deg) @ rz(-sign * down_deg) @ Quaternion((sign, 0.0, 0.0), math.radians(twist_deg))
    lower = ry(-sign * elbow_deg)
    return {f"upperarm_{side}": upper, f"lowerarm_{side}": lower}


def party(beat):
    """Hands up: both arms high, pumping on every beat and leaning left then right over a bar,
    knees dropping on the beat, the hips swaying over two beats and the head nodding."""
    k = hit(beat)
    side = swing(beat, 4)
    sway = swing(beat, 2)
    rel = {
        "pelvis": ry(10.0 * sway) @ rz(-5.0 * sway),
        "spine_01": rx(-4.0) @ rz(3.0 * sway),
        "spine_02": rx(-3.0 + 3.0 * k) @ rz(4.0 * side),
        "spine_03": rx(-2.0 + 3.0 * k) @ ry(-6.0 * sway),
        "neck_01": rx(4.0 * k),
        "Head": rx(-6.0 + 12.0 * k) @ rz(-5.0 * side),
        "clavicle_l": rz(12.0 + 6.0 * k),
        "clavicle_r": rz(-12.0 - 6.0 * k),
        "hand_l": rz(-15.0 * k),
        "hand_r": rz(15.0 * k),
    }
    lift_l = 0.5 + 0.5 * side
    lift_r = 0.5 - 0.5 * side
    rel.update(arm("l", -(40.0 + 22.0 * lift_l + 14.0 * k), 14.0, 18.0 + 34.0 * (1.0 - k)))
    rel.update(arm("r", -(40.0 + 22.0 * lift_r + 14.0 * k), 14.0, 18.0 + 34.0 * (1.0 - k)))
    pelvis = Vector((0.045 * sway, -0.03 - 0.055 * k, 0.01))
    # Feet wide and planted; the unweighted heel comes up a little as the hips sway off it.
    feet = {
        "l": (Vector((0.06, 0.0, 0.02)), rz(-4.0) @ ry(12.0), 0.025 * max(0.0, -sway)),
        "r": (Vector((-0.06, 0.0, 0.02)), rz(4.0) @ ry(-12.0), 0.025 * max(0.0, sway)),
    }
    return rel, pelvis, feet


def step_out(beat, start):
    """0..1..0 over two beats from `start`: out on the first beat, back in on the second."""
    u = (beat - start) % LOOP_BEATS
    if u >= 2.0:
        return 0.0, 0.0
    out = ease(u) if u < 1.0 else 1.0 - ease(u - 1.0)
    lift = math.sin(math.pi * (u % 1.0))
    return out, lift


def bounce(beat):
    """A hip-hop two-step: the right foot steps out and back in over beats 1-2, the left over 3-4,
    the body bouncing low on every beat and leaning into the step, elbows bent and swinging
    against the feet, shoulders rocking and the head nodding on the beat."""
    k = hit(beat, 1.2)
    out_r, lift_r = step_out(beat, 0.0)
    out_l, lift_l = step_out(beat, 2.0)
    lean = out_l - out_r
    rock = swing(beat, 2)
    rel = {
        "pelvis": ry(-14.0 * lean) @ rz(4.0 * lean),
        "spine_01": rx(6.0 + 4.0 * k),
        "spine_02": rx(4.0 + 3.0 * k) @ rz(-5.0 * lean),
        "spine_03": rx(2.0 + 3.0 * k) @ ry(12.0 * lean) @ rz(5.0 * rock),
        "neck_01": rx(-6.0 * k),
        "Head": rx(-8.0 + 16.0 * hit(beat - 0.08, 2.0)) @ rz(-4.0 * rock),
        "clavicle_l": rz(6.0 * max(0.0, rock)),
        "clavicle_r": rz(-6.0 * max(0.0, -rock)),
    }
    rel.update(arm("l", 72.0, 30.0 - 26.0 * lean + 10.0 * k, 88.0 + 12.0 * k, 20.0))
    rel.update(arm("r", 72.0, 30.0 + 26.0 * lean + 10.0 * k, 88.0 + 12.0 * k, 20.0))
    pelvis = Vector((0.09 * lean, -0.06 - 0.07 * k, 0.0))
    feet = {
        "l": (Vector((0.05 + 0.2 * out_l, 0.0, -0.02)), ry(10.0), 0.07 * lift_l * (out_l > 0.0)),
        "r": (Vector((-0.05 - 0.2 * out_r, 0.0, -0.02)), ry(-10.0), 0.07 * lift_r * (out_r > 0.0)),
    }
    return rel, pelvis, feet


class Authored:
    """A pose function as a retarget sampler: the UAL world pose at every key."""

    def __init__(self, source, pose, beats):
        self.pose = pose
        bind = source.bind("pelvis")
        self.brot = {name: matrix.to_3x3().normalized().to_quaternion() for name, matrix in bind.items()}
        self.bpos = {name: matrix.to_translation() for name, matrix in bind.items()}
        self.parent = {}
        for name in bind:
            p = source.parent.get(source.by_name[name])
            while p is not None and source.nodes[p].get("name") not in bind:
                p = source.parent.get(p)
            self.parent[name] = None if p is None else source.nodes[p]["name"]

        def depth(name):
            d, p = 0, self.parent[name]
            while p is not None:
                d, p = d + 1, self.parent[p]
            return d

        self.order = sorted(bind, key=lambda name: (depth(name), name))
        duration = beats * 60.0 / BPM
        count = round(duration * FPS)
        self.times = [round(duration * k / count, 6) for k in range(count + 1)]
        self.length = {}
        for thigh, calf, foot in LEGS.values():
            self.length[thigh] = (self.bpos[calf] - self.bpos[thigh]).length
            self.length[calf] = (self.bpos[foot] - self.bpos[calf]).length

    def leg(self, hip, ankle, thigh, calf):
        """World rotations (from bind) of the thigh and calf putting the ankle at `ankle`."""
        a, b = self.length[thigh], self.length[calf]
        reach = ankle - hip
        d = min(max(reach.length, 1e-4), (a + b) * 0.9995)
        axis = reach.normalized()
        along = (a * a - b * b + d * d) / (2.0 * d)
        up = math.sqrt(max(0.0, a * a - along * along))
        pole = Vector((0.0, 0.0, 1.0))
        pole = (pole - axis * pole.dot(axis)).normalized()
        knee = hip + axis * along + pole * up
        ankle = hip + axis * d
        bind_thigh = (self.bpos[calf] - self.bpos[thigh]).normalized()
        bind_calf = (self.bpos[LEGS[thigh[-1]][2]] - self.bpos[calf]).normalized()
        return (
            bind_thigh.rotation_difference((knee - hip).normalized()),
            bind_calf.rotation_difference((ankle - knee).normalized()),
        )

    def world(self, t):
        rel, pelvis, feet = self.pose(t * BPM / 60.0)
        rot, pos = {}, {}
        solved = {}
        for name in self.order:
            p = self.parent[name]
            if p is None:
                rot[name], pos[name] = Quaternion(), self.bpos[name].copy()
                continue
            pos[name] = pos[p] + rot[p] @ (self.bpos[name] - self.bpos[p])
            if name == "pelvis":
                pos[name] += pelvis
            if name in solved:
                rot[name] = solved[name]
            elif name.startswith("foot_"):
                rot[name] = feet[name[-1]][1]
            else:
                rot[name] = rot[p] @ rel.get(name, Quaternion())
            for side, (thigh, calf, foot) in LEGS.items():
                if name == thigh:
                    offset, _turn, lift = feet[side]
                    ankle = self.bpos[foot] + offset + Vector((0.0, lift, 0.0))
                    solved[thigh], solved[calf] = self.leg(pos[name], ankle, thigh, calf)
                    rot[name] = solved[thigh]
        return {name: pose_matrix(pos[name], rot[name] @ self.brot[name]) for name in self.order}


def pose_matrix(position, rotation):
    return Matrix.Translation(position) @ rotation.to_matrix().to_4x4()


def check(rig, order, clips, t_pos):
    """The dances stand, loop seamlessly and stay finite."""
    standing = t_pos["Body"].y
    for name, (_times, frames) in clips.items():
        heights = [translation.y for translation, _ in frames["Body"]]
        if min(heights) < standing - 0.22 or max(heights) > standing + 0.06:
            raise RuntimeError(f"{rig}: {name} does not stay standing ({min(heights):.3f}..{max(heights):.3f})")
        for joint in order:
            first, last = frames[joint][0], frames[joint][-1]
            if (first[0] - last[0]).length > 2e-3 or abs(first[1].rotation_difference(last[1]).angle) > 0.02:
                raise RuntimeError(f"{rig}: {name} {joint} does not loop")
            for translation, rotation in frames[joint]:
                if not all(math.isfinite(v) for v in (*translation, *rotation)):
                    raise RuntimeError(f"{rig}: {name} {joint} is not finite")


RESULT = {}


def build(bpy, ctx):
    retarget = runpy.run_path(ctx["deps"][RETARGET])
    args = dict(arg.split("=", 1) for arg in ctx["args"])
    pack_path, rig, frame_rig = FRAMES[args["frame"]]
    with open(ctx["deps"][FRAME_PATH], encoding="utf-8") as handle:
        frame_joints = json.load(handle)["models"][frame_rig]["joints"]
    with zipfile.ZipFile(ctx["sources"][retarget["UAL_ZIP"]]) as archive:
        source = retarget["Gltf"].from_glb(archive.read(retarget["UAL_ENTRY"]))
    target = retarget["Gltf"].from_gltf(ctx["sources"][pack_path])
    samplers = [
        ("dance-groove", retarget["UalClip"](source, "Dance_Loop")),
        ("dance-party", Authored(source, party, LOOP_BEATS)),
        ("dance-bounce", Authored(source, bounce, LOOP_BEATS)),
    ]
    order, parent, rest, clips, t_pos = retarget["retarget"](source, target, frame_joints, rig, samplers)
    check(rig, order, clips, t_pos)
    moving = retarget["moving_joints"](target, order, rest)
    RESULT["glb"] = retarget["glb"](order, parent, rest, clips, moving, generator="dance.py")


def export(bpy, ctx, out):
    with open(out, "wb") as handle:
        handle.write(RESULT["glb"])
