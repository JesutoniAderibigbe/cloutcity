"""Build one landmark's four LOD GLBs headless.

    PYTHONHASHSEED=0 PYTHONDONTWRITEBYTECODE=1 blender -b --factory-startup -noaudio \
        --python-exit-code 1 -P scripts/blender/build.py -- --id brooklyn-bridge --out <dir> \
        [--caps low/mid/high] [--true-scale]

Normally run through `npm run landmarks:blender` (scripts/blender/run.ts), which then compresses
each level into the S04h runtime format (scripts/blender/ship.ts). Writes <out>/lod<n>.glb
(uncompressed) and <out>/report.json (triangles, bytes, sha256, bounds per level). Exits 3 on a
Blender that is not the pinned one and 1 on any failed check.
"""

import importlib
import json
import os
import sys

# Blender's Python ignores PYTHONDONTWRITEBYTECODE unless --python-use-system-env is given.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from cclib import camera_aware, env, export, inputs, lod, prim, shade, validate  # noqa: E402

#: The bounding box must match the measured length and height within this fraction.
BBOX_TOLERANCE = 0.02


def landmark_module(landmark_id):
    return importlib.import_module("landmarks." + landmark_id.replace("-", "_"))


def build_level(module, spec, data, level, density):
    view = camera_aware.View(level, data["scene"], bridge=module.CATEGORY == "bridge")
    builder = prim.Builder(
        data["palette"],
        env.seeded_rng(data["id"], "L%d" % level),
        chamfer_ratio=CHAMFER_RATIO if module.ARCHETYPE.LEVELS[level].get("chamfer", False) else 0.0,
    )
    return module.ARCHETYPE.build(spec, level, view, density, builder)


#: Chamfer offset as a fraction of a part's smallest dimension.
CHAMFER_RATIO = 0.02


def expected_size(module, data, true_scale):
    """(length along a bridge's axis or None, top above the water) the model must measure."""
    base = inputs.land_top_y(data["scene"]) if data["frame"]["base"] == "land" else 0.0
    return data["frame"].get("spanM"), base + module.expected_height(data, true_scale)


def placement(module, spec, data, bbox):
    """What the geo build needs to place the model (scripts/geo/landmarks.ts): its top above its
    base (the pin's lift) and the ground it covers, as rectangles in the model's own frame (x
    east, y north at heading 0; angle counter-clockwise from east), which district buildings
    and fill keep clear of. A landmark script may give its own (`exclusions(spec)`: the High
    Line's corridor, none for a park the map already draws); otherwise the finest level's
    bounds."""
    base = inputs.land_top_y(data["scene"]) if data["frame"]["base"] == "land" else 0.0
    if hasattr(module, "exclusions"):
        rects = module.exclusions(spec)
    else:
        # glTF bounds: x east, z = -north (Blender's +y), y up.
        (x0, _y0, z0), (x1, _y1, z1) = bbox["min"], bbox["max"]
        rects = [{"x": (x0 + x1) / 2, "y": -(z0 + z1) / 2, "halfLengthM": (x1 - x0) / 2,
                  "halfWidthM": (z1 - z0) / 2, "angleDeg": 0.0}]
    return {
        "topM": round(bbox["max"][1] - base, 1),
        "exclusions": [{key: round(value, 1) for key, value in rect.items()} for rect in rects],
    }


def run(landmark_id, out_dir, caps_override=None, true_scale=False):
    """Build, export and check every level; returns the report dict."""
    env.reset_scene()
    data = inputs.landmark_inputs(landmark_id)
    module = landmark_module(landmark_id)
    spec = module.spec(data, true_scale)
    caps = inputs.caps_for(module.CATEGORY, data["perf"], caps_override)
    ratio = data["perf"]["landmarkLodRatioMax"]
    material = shade.export_material()
    length, height = expected_size(module, data, true_scale)

    levels = []
    problems = []
    above = None
    for level in lod.LEVELS:
        target = lod.budget(level, caps, ratio, above)
        builder, density = lod.fit(lambda d, lv=level: build_level(module, spec, data, lv, d), target)
        if getattr(module, "MUTED", False) and any(g != (0.0, 0.0, 0.0) for g in builder.glows):
            # A memorial is muted and still (CLAUDE.md): nothing on it may glow.
            problems.append("L%d: a muted landmark has glowing faces" % level)
        objects = export.objects_for(builder, landmark_id, level, material)
        entry = {"level": level, "triangles": builder.triangles(), "budget": target, "density": density}
        path = os.path.join(out_dir, "lod%d.glb" % level)
        entry["glb"] = export.export_glb(objects, path)
        problems += ["L%d: %s" % (level, p) for p in validate.check(path, landmark_id, level)]
        gltf = validate.read_glb_json(path)
        if validate.triangles(gltf) != entry["triangles"]:
            problems.append("L%d: exported %d triangles, built %d" % (level, validate.triangles(gltf), entry["triangles"]))
        lo, hi = validate.bbox(gltf)
        entry["bbox"] = {"min": [round(v, 3) for v in lo], "max": [round(v, 3) for v in hi]}
        size_len, size_h = hi[2] - lo[2], hi[1]
        if length is not None and abs(size_len - length) > BBOX_TOLERANCE * length:
            problems.append("L%d: length %.1f m, expected %.1f" % (level, size_len, length))
        if abs(size_h - height) > BBOX_TOLERANCE * height:
            problems.append("L%d: height %.1f m, expected %.1f" % (level, size_h, height))
        export.remove(objects)
        levels.append(entry)
        above = entry["triangles"]

    problems += lod.check([e["triangles"] for e in levels], caps, ratio)
    version, build_hash = env.running_version()
    report = {
        "id": landmark_id,
        "blender": {"version": version, "buildHash": build_hash},
        "caps": caps,
        "trueScale": true_scale,
        "ratio": ratio,
        "levels": levels,
        # Where preview.py puts land along the axis and which tower it looks at closely.
        "context": module.context(spec) if hasattr(module, "context") else {"land": [], "focus": 0.0},
        "placement": placement(module, spec, data, levels[0]["bbox"]),
        "problems": problems,
    }
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "report.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, sort_keys=True)
        handle.write("\n")
    return report


def main():
    env.require_pinned_version()
    args = inputs.parse_args()
    report = run(args.id, os.path.abspath(args.out), args.caps, args.true_scale)
    for entry in report["levels"]:
        sys.stdout.write("L%d %6d tris (budget %d, density %.3f) %7d B\n" % (
            entry["level"], entry["triangles"], entry["budget"], entry["density"], entry["glb"]["bytes"]))
    if report["problems"]:
        for problem in report["problems"]:
            sys.stderr.write("build: %s\n" % problem)
        sys.exit(1)


if __name__ == "__main__":
    main()
