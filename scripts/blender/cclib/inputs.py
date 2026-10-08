"""Command-line arguments and the repository data a landmark build reads.

Every number a model uses comes from a committed file: the landmark's measurements
(data/landmarks/measurements/<id>.json), its frame (data/landmarks/frames.derived.json), the
scene config (land top, camera, LOD distances), the theme palette and the perf.json caps.
scripts/blender/run.ts hashes the same files into the lock's inputsSha.
"""

import argparse
import json
import sys

from . import env

TIERS = ("low", "mid", "high")


def parse_args(argv=None):
    """Arguments after Blender's `--` separator."""
    args = sys.argv if argv is None else argv
    rest = args[args.index("--") + 1:] if "--" in args else []
    parser = argparse.ArgumentParser(prog="build.py")
    parser.add_argument("--id", required=True, help="landmark id, e.g. brooklyn-bridge")
    parser.add_argument("--out", required=True, help="output directory for lod<n>.glb files")
    parser.add_argument(
        "--caps",
        default=None,
        help="triangle caps low/mid/high (e.g. 1500/5000/10000); default perf.json",
    )
    parser.add_argument(
        "--true-scale",
        action="store_true",
        help="build the real proportions instead of the measurements' gameScale (for comparison)",
    )
    return parser.parse_args(rest)


def read_json(*parts):
    with open(env.repo_path(*parts), "r", encoding="utf-8") as handle:
        return json.load(handle)


def landmark_inputs(landmark_id):
    """Everything a landmark build needs, as plain dicts."""
    measurements = read_json("data", "landmarks", "measurements", landmark_id + ".json")
    frames = read_json("data", "landmarks", "frames.derived.json")["landmarks"]
    frame = next((f for f in frames if f["id"] == landmark_id), None)
    if frame is None:
        raise ValueError("no frame for %s in frames.derived.json" % landmark_id)
    models = read_json("data", "landmarks", "models.json")["models"]
    model = next((m for m in models if m["id"] == landmark_id), None)
    if model is None:
        raise ValueError("no model for %s in models.json" % landmark_id)
    scene = read_json("data", "config", "scene.json")
    theme = read_json("data", "config", "theme.json")
    perf = read_json("data", "config", "perf.json")
    return {
        "id": landmark_id,
        "measurements": measurements,
        "frame": frame,
        "model": model,
        "scene": scene,
        "palette": palette(theme),
        "perf": perf,
    }


def palette(theme):
    """Role -> linear-ready sRGB (r, g, b) floats in 0..1, from theme.json scene.landmarks."""
    colours = {}
    # A scene role names a models or world token (DEC-26); colors holds the DOM palette.
    for group in ("colors", "world", "models"):
        colours.update(theme.get(group, {}))
    out = {}
    for role, token in theme["scene"]["landmarks"].items():
        hex_colour = colours[token]
        out[role] = tuple(int(hex_colour[i:i + 2], 16) / 255.0 for i in (1, 3, 5))
    return out


def land_top_y(scene):
    """Scene y of the land top (src/scene/geo/buildLand.ts landTopY)."""
    return scene["land"]["heightM"] - scene["land"]["baseM"]


def caps_for(category, perf, override=None):
    """Triangle caps per tier: an explicit low/mid/high override or perf.json for the category."""
    if override:
        values = [int(v) for v in override.split("/")]
        if len(values) != 3:
            raise ValueError("--caps takes low/mid/high")
        return dict(zip(TIERS, values))
    return dict(perf["landmarkTrianglesMax"][category])
