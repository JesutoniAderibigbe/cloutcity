"""Environment guards for every Blender run: the pinned version, a clean scene, a seeded RNG.

Builds must be reproducible byte for byte, so nothing here reads the clock, the network or an
unseeded random source. The RNG is seeded from sha256(landmark id): the same id always paints
the same jitter.
"""

import hashlib
import os
import random
import sys

import bpy

#: Exit code for a Blender that does not match scripts/blender/PIN.
EXIT_WRONG_VERSION = 3

BLENDER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = os.path.dirname(os.path.dirname(BLENDER_DIR))
PIN_PATH = os.path.join(BLENDER_DIR, "PIN")


def read_pin(path=PIN_PATH):
    """The pinned (version, build hash) pair, e.g. ("5.2.2", "d13f752e3b9c")."""
    with open(path, "r", encoding="utf-8") as handle:
        parts = handle.read().split()
    if len(parts) != 2:
        raise ValueError("PIN must hold '<version> <build hash>'")
    return parts[0], parts[1]


def running_version():
    """The running Blender as (version, build hash)."""
    version = ".".join(str(part) for part in bpy.app.version)
    build_hash = bpy.app.build_hash.decode("ascii") if isinstance(bpy.app.build_hash, bytes) else str(bpy.app.build_hash)
    return version, build_hash


def require_pinned_version(pin=None):
    """Exit with EXIT_WRONG_VERSION unless the running Blender is the pinned one."""
    want = pin if pin is not None else read_pin()
    have = running_version()
    if have != want:
        sys.stderr.write(
            "cclib: Blender %s (%s) is not the pinned %s (%s); see scripts/blender/README.md\n"
            % (have[0], have[1], want[0], want[1])
        )
        sys.exit(EXIT_WRONG_VERSION)


def reset_scene():
    """Delete every object, mesh, material and collection so a second build starts clean."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.curves, bpy.data.cameras, bpy.data.lights, bpy.data.images):
        for block in list(datablocks):
            datablocks.remove(block)
    for collection in list(bpy.data.collections):
        bpy.data.collections.remove(collection)
    for world in list(bpy.data.worlds):
        bpy.data.worlds.remove(world)


def seeded_rng(landmark_id, salt=""):
    """A random.Random seeded from sha256(landmark id + salt): deterministic per landmark."""
    digest = hashlib.sha256((landmark_id + salt).encode("utf-8")).digest()
    return random.Random(int.from_bytes(digest[:8], "big"))


def repo_path(*parts):
    return os.path.join(REPO_ROOT, *parts)
