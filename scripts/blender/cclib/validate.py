"""Checks on a written GLB: structure, names, materials, triangles and bounding box.

The Vitest suite (src/lib/landmarks/blender-glb.test.ts) runs the same structural checks on
the shipped files; this copy fails a build before anything is written to the lock.
"""

import json
import struct

ALLOWED_EXTENSIONS = {"EXT_meshopt_compression", "KHR_mesh_quantization"}
MATERIALS = {"cc-body", "cc-windows"}
FORBIDDEN_KEYS = ("images", "textures", "samplers", "animations", "cameras", "skins")


def read_glb_json(path):
    with open(path, "rb") as handle:
        blob = handle.read()
    magic, version, _length = struct.unpack_from("<III", blob, 0)
    if magic != 0x46546C67 or version != 2:
        raise ValueError("%s is not a glTF 2 binary" % path)
    chunk_length, chunk_type = struct.unpack_from("<II", blob, 12)
    if chunk_type != 0x4E4F534A:
        raise ValueError("%s: first chunk is not JSON" % path)
    return json.loads(blob[20:20 + chunk_length].decode("utf-8"))


def triangles(gltf):
    total = 0
    for mesh in gltf.get("meshes", []):
        for primitive in mesh["primitives"]:
            if primitive.get("mode", 4) != 4:
                raise ValueError("only triangle lists are allowed")
            if "indices" in primitive:
                total += gltf["accessors"][primitive["indices"]]["count"] // 3
            else:
                total += gltf["accessors"][primitive["attributes"]["POSITION"]]["count"] // 3
    return total


def bbox(gltf):
    """World-space bounds (glTF y up) from POSITION min/max under each node's scale/translation."""
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for node in gltf.get("nodes", []):
        if "mesh" not in node:
            continue
        if "rotation" in node and node["rotation"] != [0, 0, 0, 1]:
            raise ValueError("node %s is rotated" % node.get("name"))
        t = node.get("translation", [0, 0, 0])
        s = node.get("scale", [1, 1, 1])
        for primitive in gltf["meshes"][node["mesh"]]["primitives"]:
            accessor = gltf["accessors"][primitive["attributes"]["POSITION"]]
            mn, mx = accessor["min"], accessor["max"]
            if accessor.get("normalized"):
                raise ValueError("normalized positions are not supported")
            for axis in range(3):
                a = mn[axis] * s[axis] + t[axis]
                b = mx[axis] * s[axis] + t[axis]
                lo[axis] = min(lo[axis], a, b)
                hi[axis] = max(hi[axis], a, b)
    return lo, hi


def check(path, landmark_id, level):
    """Problems with one level's GLB (an empty list when it is fine)."""
    gltf = read_glb_json(path)
    problems = []
    for key in FORBIDDEN_KEYS:
        if gltf.get(key):
            problems.append("has %s" % key)
    used = set(gltf.get("extensionsUsed", []))
    if not used <= ALLOWED_EXTENSIONS:
        problems.append("unexpected extensions %s" % sorted(used - ALLOWED_EXTENSIONS))
    names = {m.get("name") for m in gltf.get("materials", [])}
    if not names <= MATERIALS or "cc-body" not in names:
        problems.append("materials %s" % sorted(names))
    prefix = "%s-lod%d-" % (landmark_id, level)
    for node in gltf.get("nodes", []):
        if not node.get("name", "").startswith(prefix):
            problems.append("node name %r" % node.get("name"))
    return problems
