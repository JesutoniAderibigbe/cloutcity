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
        chamfer_ratio=CHAMFER_RATIO if module.ARCHETYPE.LEVELS[level]["chamfer"] else 0.0,
    )
    return module.ARCHETYPE.build(spec, level, view, density, builder)


#: Chamfer offset as a fraction of a part's smallest dimension.
CHAMFER_RATIO = 0.02


def expected_size(module, data, true_scale):
    """(length along the axis, height) the model must measure."""
    return data["frame"]["spanM"], module.expected_height(data, true_scale)


def run(landmark_id, out_dir, caps_override=None, true_scale=False):
    """Build, export and check every level; returns the report dict."""
    env.reset_scene()
    data = inputs.landmark_inputs(landmark_id)
    module = landmark_module(landmark_id)
    spec = module.spec(data, true_scale)
    caps = inputs.caps_for(module.CATEGORY, data["perf"], caps_override)
    ratio = data["perf"]["landmarkLodRatioMax"]
    body, windows = shade.materials(data["palette"])
    length, height = expected_size(module, data, true_scale)

    levels = []
    problems = []
    above = None
    for level in lod.LEVELS:
        target = lod.budget(level, caps, ratio, above)
        builder, density = lod.fit(lambda d, lv=level: build_level(module, spec, data, lv, d), target)
        objects = export.objects_for(builder, landmark_id, level, body, windows)
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
        if abs(size_len - length) > BBOX_TOLERANCE * length:
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
