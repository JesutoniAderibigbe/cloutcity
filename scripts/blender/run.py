"""Headless Blender runner for Clout City: NYC (DEC-25).

Licence: project-original. Models built by these scripts are modelled for Clout City: NYC from
real measurements and carry no third-party licence.

Run by `npm run blender:build` (scripts/blender/build.ts) as:

    Blender --background --factory-startup --python-exit-code 1 --python run.py -- \
        --script <model.py> --out <file.glb>

with PYTHONHASHSEED=0. The model script defines `build(bpy)`, which adds objects to an empty
scene; colours are Principled BSDF base colours (the asset pipeline bakes them to vertex
colours). The export settings below are fixed so the same script and Blender version always
produce byte-identical GLBs.

A script may instead take `build(bpy, ctx)`, where ctx holds the lock's inputs for that model:
`deps` (repository path -> absolute path, e.g. data/avatar/frame.json), `sources` (pinned pack
file "<source>/<path>" -> absolute path of the sha-checked cache copy) and `args`. A script that
writes its own GLB (the S16b clip retarget) also defines `export(bpy, ctx, out)`, which replaces
the scene export below.
"""

import argparse
import inspect
import runpy
import sys

import bpy


def _pairs(values):
    out = {}
    for value in values:
        key, _, path = value.partition("=")
        out[key] = path
    return out


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="run.py")
    parser.add_argument("--script", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--dep", action="append", default=[])
    parser.add_argument("--source", action="append", default=[])
    parser.add_argument("--arg", action="append", default=[])
    return parser.parse_args(argv)


def main():
    args = parse_args()
    # Factory startup still holds the default cube, camera and light: start from nothing.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    namespace = runpy.run_path(args.script)
    build = namespace.get("build")
    if not callable(build):
        raise RuntimeError(f"{args.script} does not define build(bpy)")
    ctx = {"deps": _pairs(args.dep), "sources": _pairs(args.source), "args": list(args.arg)}
    if len(inspect.signature(build).parameters) >= 2:
        build(bpy, ctx)
    else:
        build(bpy)
    export = namespace.get("export")
    if callable(export):
        export(bpy, ctx, args.out)
        return
    bpy.ops.export_scene.gltf(
        filepath=args.out,
        check_existing=False,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
        export_image_format="NONE",
        export_texcoords=False,
        export_normals=True,
        export_tangents=False,
        export_vertex_color="NONE",
        export_attributes=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        use_selection=False,
    )


main()
