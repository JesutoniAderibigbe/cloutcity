"""Talk and sit clips for the modular avatar rigs, retargeted from the Universal Animation Library.

Licence: the motion comes from Quaternius "Universal Animation Library" Standard (CC0 1.0, pinned
in scripts/assets/sources.lock.json); the retarget is project-original (S16b P2b, DEC-51).

Run by `npm run blender:build` through scripts/blender/run.py, once per body frame
(`--arg frame=f` for avatar-rig-f from the women's Casual.gltf, `frame=m` for avatar-rig-m from
the men's Casual_Hoodie.gltf). It reads both glTF files itself (the UAL GLB straight out of the
pinned zip), so no importer setting can change the result:

1. Bind poses come from each skin's inverse bind matrices. Both rigs are in a T-pose, but their
   bones point differently (the UAL clavicles run back, the pack shoulders up and out), so each
   target joint gets a rest correction: the rotation taking its bind bone direction onto the
   matching UAL bone's.
2. Every UAL key time is evaluated by forward kinematics (linear translation and scale,
   spherical-linear rotation). A target joint's world rotation is the UAL joint's world rotation
   change since its bind pose, applied to the corrected target bind rotation. Positions follow by
   forward kinematics from the target's own bone lengths; the body (pelvis) moves with the UAL
   pelvis, scaled by the ratio of the two hip heights; the feet (children of the root in the pack
   rig) sit at the end of their lower legs.
3. Each joint's local rotation (and the translation of the body and the feet, the joints that
   move) is baked at every key time and written, with the joints renamed as the asset build renames them (data/avatar/frame.json), to a GLB holding only
   the 22 joints and two animations: `talk` (from Idle_Talking_Loop) and `sit` (from
   Sitting_Idle_Loop). The GLB is assembled byte by byte here, so it is byte-identical every run.
"""

import base64
import json
import math
import struct
import zipfile

from mathutils import Matrix, Quaternion, Vector

FRAME_PATH = "data/avatar/frame.json"
UAL_ZIP = "quaternius-ual/quaternius-ual-standard.zip"
UAL_ENTRY = "Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb"
FRAMES = {
    "f": ("quaternius-modular-women/glTF/Casual.gltf", "avatar-rig-f"),
    "m": ("quaternius-modular-men/glTF/Casual_Hoodie.gltf", "avatar-rig-m"),
}
CLIPS = (("talk", "Idle_Talking_Loop"), ("sit", "Sitting_Idle_Loop"))

# Pack joint -> (renamed joint, UAL joint it follows, child joints whose directions match).
JOINTS = {
    "Root": ("root", None, None),
    "Body": ("body", "pelvis", ("Hips", "spine_01")),
    "Hips": ("hips", "pelvis", ("Abdomen", "spine_01")),
    "Abdomen": ("abdomen", "spine_01", ("Torso", "spine_02")),
    "Torso": ("spine", "spine_02", ("Chest", "spine_03")),
    "Chest": ("torso", "spine_03", ("Neck", "neck_01")),
    "Neck": ("neck", "neck_01", ("Head", "Head")),
    "Head": ("head", "Head", None),
}
for _side, _s in (("L", "l"), ("R", "r")):
    _name = "left" if _side == "L" else "right"
    JOINTS.update(
        {
            f"Shoulder.{_side}": (f"shoulder-{_name}", f"clavicle_{_s}", (f"UpperArm.{_side}", f"upperarm_{_s}")),
            f"UpperArm.{_side}": (f"upper-arm-{_name}", f"upperarm_{_s}", (f"LowerArm.{_side}", f"lowerarm_{_s}")),
            f"LowerArm.{_side}": (f"lower-arm-{_name}", f"lowerarm_{_s}", (f"Wrist.{_side}", f"hand_{_s}")),
            f"Wrist.{_side}": (f"hand-{_name}", f"hand_{_s}", None),
            f"UpperLeg.{_side}": (f"upper-leg-{_name}", f"thigh_{_s}", (f"LowerLeg.{_side}", f"calf_{_s}")),
            f"LowerLeg.{_side}": (f"lower-leg-{_name}", f"calf_{_s}", (f"Foot.{_side}", f"foot_{_s}")),
            f"Foot.{_side}": (f"foot-{_name}", f"foot_{_s}", None),
        }
    )
# A foot is a child of the root in the pack rig; it is placed at the end of this lower leg.
FOOT_LEG = {"Foot.L": "LowerLeg.L", "Foot.R": "LowerLeg.R"}

COMPONENTS = {"SCALAR": 1, "VEC3": 3, "VEC4": 4, "MAT4": 16}
FORMATS = {5126: "f", 5125: "I", 5123: "H", 5121: "B"}


class Gltf:
    """A glTF document's JSON and its buffers (a .gltf with data URIs, or a GLB)."""

    def __init__(self, data, binary):
        self.json = data
        self.buffers = []
        for buffer in data.get("buffers", []):
            uri = buffer.get("uri")
            if uri is None:
                self.buffers.append(binary)
            elif uri.startswith("data:"):
                self.buffers.append(base64.b64decode(uri.split(",", 1)[1]))
            else:
                raise RuntimeError(f"external buffer {uri} is not supported")
        self.nodes = data["nodes"]
        self.parent = {}
        for index, node in enumerate(self.nodes):
            for child in node.get("children", []):
                self.parent[child] = index
        self.by_name = {}
        for index, node in enumerate(self.nodes):
            self.by_name.setdefault(node.get("name", ""), index)

    @classmethod
    def from_gltf(cls, path):
        with open(path, encoding="utf-8") as handle:
            return cls(json.load(handle), None)

    @classmethod
    def from_glb(cls, blob):
        magic, _version, _length = struct.unpack_from("<III", blob, 0)
        if magic != 0x46546C67:
            raise RuntimeError("not a GLB")
        offset, data, binary = 12, None, None
        while offset < len(blob):
            size, kind = struct.unpack_from("<II", blob, offset)
            chunk = blob[offset + 8 : offset + 8 + size]
            if kind == 0x4E4F534A:
                data = json.loads(chunk.decode("utf-8"))
            elif kind == 0x004E4942:
                binary = chunk
            offset += 8 + size
        return cls(data, binary)

    def read(self, index):
        accessor = self.json["accessors"][index]
        view = self.json["bufferViews"][accessor["bufferView"]]
        width = COMPONENTS[accessor["type"]]
        fmt = FORMATS[accessor["componentType"]]
        size = struct.calcsize(fmt)
        stride = view.get("byteStride", width * size)
        base = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        blob = self.buffers[view["buffer"]]
        out = []
        for i in range(accessor["count"]):
            values = struct.unpack_from(f"<{width}{fmt}", blob, base + i * stride)
            out.append(values if width > 1 else values[0])
        return out

    def rest(self, index):
        node = self.nodes[index]
        if "matrix" in node:
            m = node["matrix"]
            return Matrix([m[0:4], m[4:8], m[8:12], m[12:16]]).transposed()
        t = node.get("translation", (0, 0, 0))
        r = node.get("rotation", (0, 0, 0, 1))
        s = node.get("scale", (1, 1, 1))
        return trs(Vector(t), Quaternion((r[3], r[0], r[1], r[2])), Vector(s))

    def skin_of(self, joint_name):
        for skin in self.json["skins"]:
            names = [self.nodes[j].get("name") for j in skin["joints"]]
            if joint_name in names:
                return skin
        raise RuntimeError(f"no skin holds {joint_name}")

    def bind(self, joint_name):
        """name -> bind world matrix of every joint of the skin holding joint_name."""
        skin = self.skin_of(joint_name)
        out = {}
        for joint, flat in zip(skin["joints"], self.read(skin["inverseBindMatrices"])):
            m = Matrix([flat[0:4], flat[4:8], flat[8:12], flat[12:16]]).transposed()
            out[self.nodes[joint]["name"]] = m.inverted()
        return out


def trs(t, r, s):
    return Matrix.Translation(t) @ r.to_matrix().to_4x4() @ Matrix.Diagonal((s[0], s[1], s[2], 1.0))


def pose_matrix(position, rotation):
    return Matrix.Translation(position) @ rotation.to_matrix().to_4x4()


def rotation_of(matrix):
    return matrix.to_3x3().normalized().to_quaternion().normalized()


class Clip:
    """One glTF animation, sampled per node."""

    def __init__(self, gltf, name):
        found = [a for a in gltf.json["animations"] if a.get("name") == name]
        if not found:
            raise RuntimeError(f"no animation {name}")
        animation = found[0]
        self.tracks = {}
        times = set()
        for channel in animation["channels"]:
            sampler = animation["samplers"][channel["sampler"]]
            if sampler.get("interpolation", "LINEAR") != "LINEAR":
                raise RuntimeError(f"{name}: only LINEAR samplers are supported")
            node, path = channel["target"]["node"], channel["target"]["path"]
            keys = gltf.read(sampler["input"])
            values = gltf.read(sampler["output"])
            self.tracks[(node, path)] = (keys, values)
            times.update(round(k, 6) for k in keys)
        self.times = sorted(times)

    def sample(self, node, path, t, default):
        track = self.tracks.get((node, path))
        if track is None:
            return default
        keys, values = track
        if t <= keys[0]:
            return convert(path, values[0])
        if t >= keys[-1]:
            return convert(path, values[-1])
        hi = 1
        while keys[hi] < t:
            hi += 1
        lo = hi - 1
        f = (t - keys[lo]) / (keys[hi] - keys[lo])
        a, b = convert(path, values[lo]), convert(path, values[hi])
        if path == "rotation":
            return a.slerp(b, f)
        return a.lerp(b, f)


def convert(path, value):
    if path == "rotation":
        return Quaternion((value[3], value[0], value[1], value[2]))
    return Vector(value)


def node_trs(gltf, index):
    node = gltf.nodes[index]
    t = node.get("translation", (0, 0, 0))
    r = node.get("rotation", (0, 0, 0, 1))
    s = node.get("scale", (1, 1, 1))
    return Vector(t), Quaternion((r[3], r[0], r[1], r[2])), Vector(s)


def world_at(gltf, clip, t):
    """World matrix of every node at time t (rest TRS where the clip has no track)."""
    cache = {}

    def world(index):
        if index in cache:
            return cache[index]
        t0, r0, s0 = node_trs(gltf, index)
        local = trs(
            clip.sample(index, "translation", t, t0),
            clip.sample(index, "rotation", t, r0),
            clip.sample(index, "scale", t, s0),
        )
        parent = gltf.parent.get(index)
        cache[index] = local if parent is None else world(parent) @ local
        return cache[index]

    return {gltf.nodes[i].get("name", ""): world(i) for i in range(len(gltf.nodes))}


def keep_sign(q, previous):
    if previous is not None and q.dot(previous) < 0:
        return Quaternion((-q.w, -q.x, -q.y, -q.z))
    return q


def retarget(source, target, frame_joints, rig):
    """{clip: (times, {pack joint: [(translation, rotation)]})} for the target rig."""
    s_bind = source.bind("pelvis")
    t_bind = target.bind("Head")
    for joint, (renamed, _, _) in JOINTS.items():
        have = t_bind[joint].to_translation()
        want = Vector(frame_joints[renamed])
        if (have - want).length > 2e-3:
            raise RuntimeError(f"{rig}: {joint} binds at {tuple(have)}, frame.json says {tuple(want)}")
    order = [j for j in t_bind if j in JOINTS]
    parent = {}
    for joint in order:
        p = target.parent.get(target.by_name[joint])
        while p is not None and target.nodes[p].get("name") not in JOINTS:
            p = target.parent.get(p)
        parent[joint] = None if p is None else target.nodes[p]["name"]
    t_rot = {j: rotation_of(t_bind[j]) for j in order}
    t_pos = {j: t_bind[j].to_translation() for j in order}
    s_rot = {j: rotation_of(m) for j, m in s_bind.items()}
    s_pos = {j: m.to_translation() for j, m in s_bind.items()}
    # Rest correction: the target bind bone direction turned onto the UAL one.
    correct = {}
    for joint in order:
        _, follow, pair = JOINTS[joint]
        if follow is None or pair is None:
            correct[joint] = Quaternion()
            continue
        t_dir = (t_pos[pair[0]] - t_pos[joint]).normalized()
        s_dir = (s_pos[pair[1]] - s_pos[follow]).normalized()
        correct[joint] = t_dir.rotation_difference(s_dir)
    hip_ratio = t_pos["Body"].y / s_pos["pelvis"].y
    out = {}
    for clip_name, source_name in CLIPS:
        clip = Clip(source, source_name)
        frames = {j: [] for j in order}
        for t in clip.times:
            world = world_at(source, clip, t)
            rot, pos = {}, {}
            for joint in order:
                _, follow, _ = JOINTS[joint]
                if follow is None:
                    rot[joint] = t_rot[joint]
                    continue
                delta = rotation_of(world[follow]) @ s_rot[follow].inverted()
                rot[joint] = (delta @ correct[joint] @ t_rot[joint]).normalized()
            for joint in order:
                p = parent[joint]
                if joint == "Root":
                    pos[joint] = t_pos[joint]
                elif joint == "Body":
                    moved = world["pelvis"].to_translation() - s_pos["pelvis"]
                    pos[joint] = t_pos["Body"] + moved * hip_ratio
                elif joint in FOOT_LEG:
                    leg = FOOT_LEG[joint]
                    offset = t_rot[leg].inverted() @ (t_pos[joint] - t_pos[leg])
                    pos[joint] = pos[leg] + rot[leg] @ offset
                else:
                    offset = t_rot[p].inverted() @ (t_pos[joint] - t_pos[p])
                    pos[joint] = pos[p] + rot[p] @ offset
            for joint in order:
                w = pose_matrix(pos[joint], rot[joint])
                p = parent[joint]
                local = w if p is None else pose_matrix(pos[p], rot[p]).inverted() @ w
                frames[joint].append((local.to_translation(), rotation_of(local)))
        out[clip_name] = (clip.times, frames)
    rest = {}
    for joint in order:
        p = parent[joint]
        w = pose_matrix(t_pos[joint], t_rot[joint])
        local = w if p is None else pose_matrix(t_pos[p], t_rot[p]).inverted() @ w
        rest[joint] = (local.to_translation(), rotation_of(local))
    return order, parent, rest, out, t_pos


def check(rig, order, parent, rest, clips, t_pos):
    """Sanity of the baked motion: the talk stays standing in place, the sit lowers the hips."""

    def body_heights(frames):
        return [frames["Body"][k][0].y for k in range(len(frames["Body"]))]

    talk = clips["talk"][1]
    sit = clips["sit"][1]
    standing = t_pos["Body"].y
    if min(body_heights(talk)) < standing - 0.08 or max(body_heights(talk)) > standing + 0.05:
        raise RuntimeError(f"{rig}: talk does not stay standing")
    if max(body_heights(sit)) > standing * 0.8:
        raise RuntimeError(f"{rig}: sit does not lower the hips")
    for name, (_times, frames) in clips.items():
        for joint in order:
            for translation, rotation in frames[joint]:
                if not all(math.isfinite(v) for v in (*translation, *rotation)):
                    raise RuntimeError(f"{rig}: {name} {joint} is not finite")


def glb(order, parent, rest, clips, moving):
    blob = bytearray()
    views, accessors = [], []

    def add(values, kind, minmax=False):
        while len(blob) % 4:
            blob.append(0)
        start = len(blob)
        flat = [v for value in values for v in (value if isinstance(value, tuple) else (value,))]
        blob.extend(struct.pack(f"<{len(flat)}f", *flat))
        views.append({"buffer": 0, "byteOffset": start, "byteLength": len(blob) - start})
        accessor = {"bufferView": len(views) - 1, "componentType": 5126, "count": len(values), "type": kind}
        if minmax:
            stored = [struct.unpack("<f", struct.pack("<f", v))[0] for v in flat]
            accessor["min"] = [min(stored)]
            accessor["max"] = [max(stored)]
        accessors.append(accessor)
        return len(accessors) - 1

    index = {joint: k for k, joint in enumerate(order)}
    nodes = []
    for joint in order:
        translation, rotation = rest[joint]
        node = {
            "name": JOINTS[joint][0],
            "rotation": [rotation.x, rotation.y, rotation.z, rotation.w],
            "translation": [translation.x, translation.y, translation.z],
        }
        children = [index[c] for c in order if parent[c] == joint]
        if children:
            node["children"] = children
        nodes.append(node)
    roots = [index[j] for j in order if parent[j] is None]
    animations = []
    for clip_name, _ in CLIPS:
        times, frames = clips[clip_name]
        time_accessor = add([float(t) for t in times], "SCALAR", minmax=True)
        samplers, channels = [], []
        for joint in order:
            previous, rotations = None, []
            for _, rotation in frames[joint]:
                previous = keep_sign(rotation, previous)
                rotations.append((previous.x, previous.y, previous.z, previous.w))
            tracks = [("rotation", rotations, "VEC4")]
            if joint in moving:
                tracks.insert(0, ("translation", [(t.x, t.y, t.z) for t, _ in frames[joint]], "VEC3"))
            for path, values, kind in tracks:
                samplers.append({"input": time_accessor, "interpolation": "LINEAR", "output": add(values, kind)})
                channels.append({"sampler": len(samplers) - 1, "target": {"node": index[joint], "path": path}})
        animations.append({"name": clip_name, "channels": channels, "samplers": samplers})
    while len(blob) % 4:
        blob.append(0)
    doc = {
        "asset": {"generator": "Clout City scripts/blender/avatar-anim/retarget.py", "version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": roots}],
        "nodes": nodes,
        "animations": animations,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(blob)}],
    }
    text = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    text += b" " * (-len(text) % 4)
    total = 12 + 8 + len(text) + 8 + len(blob)
    return (
        struct.pack("<III", 0x46546C67, 2, total)
        + struct.pack("<II", len(text), 0x4E4F534A)
        + text
        + struct.pack("<II", len(blob), 0x004E4942)
        + bytes(blob)
    )


def moving_joints(target, order, rest):
    """Joints that need a translation track: the body and the feet move; every other bone keeps
    its length, so its translation is its rest one, which must equal the pack node's (the clip is
    played on the pack rig, whose nodes rest in the pack's pose)."""
    moving = {"Body", "Foot.L", "Foot.R"}
    for joint in order:
        node_t, _, _ = node_trs(target, target.by_name[joint])
        if (node_t - rest[joint][0]).length > 1e-4:
            moving.add(joint)
    return moving


RESULT = {}


def build(bpy, ctx):
    args = dict(arg.split("=", 1) for arg in ctx["args"])
    pack_path, rig = FRAMES[args["frame"]]
    with open(ctx["deps"][FRAME_PATH], encoding="utf-8") as handle:
        frame_joints = json.load(handle)["models"][rig]["joints"]
    with zipfile.ZipFile(ctx["sources"][UAL_ZIP]) as archive:
        source = Gltf.from_glb(archive.read(UAL_ENTRY))
    target = Gltf.from_gltf(ctx["sources"][pack_path])
    order, parent, rest, clips, t_pos = retarget(source, target, frame_joints, rig)
    check(rig, order, parent, rest, clips, t_pos)
    RESULT["glb"] = glb(order, parent, rest, clips, moving_joints(target, order, rest))


def export(bpy, ctx, out):
    with open(out, "wb") as handle:
        handle.write(RESULT["glb"])
