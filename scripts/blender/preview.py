"""Render review images of a built landmark from its exported GLBs (not from the build scene,
so what is reviewed is what ships).

    blender -b --factory-startup -noaudio --python-exit-code 1 -P scripts/blender/preview.py -- \
        --id brooklyn-bridge --glb <dir with lod<n>.glb and report.json> --out <png dir>

Views (EEVEE, soft sun and sky):
- game camera: polar 48° at azimuth -40/0/+40, and polar 12°, framing the whole model;
- close views of the second tower at polar 48° (420 m and the minimum camera distance) and
  60° (the lowest the game allows), from the azimuth limit nearer the axis so the arches show;
- each in day and golden hour, at 390x390 and 1280x720;
- each tier's finest level at the minimum camera distance (day, 1280x720);
- a Workbench strip of the four levels with their triangle counts;
- a far check at 4500 m (the game's default camera distance) with each tier's level there.

The model stands in a plain context: water at y = 0 and land slabs at the land top beyond
its ends, turned to its real heading, so the base and the approaches can be judged.
"""

import argparse
import json
import math
import os
import sys

import bpy

# Blender's Python ignores PYTHONDONTWRITEBYTECODE unless --python-use-system-env is given.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from cclib import env, inputs, lod, shade  # noqa: E402

WATER = (0.2, 0.31, 0.37)
LAND = (0.46, 0.45, 0.41)
#: (sun elevation°, sun azimuth°, sun colour, sun strength, sky colour, sky strength)
LIGHTING = {
    "day": (46.0, 150.0, (1.0, 0.93, 0.82), 3.4, (0.6, 0.71, 0.86), 0.6),
    "golden": (12.0, 245.0, (1.0, 0.68, 0.42), 4.0, (0.74, 0.62, 0.6), 0.45),
}
SIZES = {"square": (390, 390), "wide": (1280, 720)}
EXPOSURE = -0.4


def parse_args():
    rest = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="preview.py")
    parser.add_argument("--id", required=True)
    parser.add_argument("--glb", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--label", default="")
    return parser.parse_args(rest)


def solid_material(name, rgb):
    material = bpy.data.materials.new(name)
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
    bsdf.inputs["Roughness"].default_value = 0.95
    return material


def box_object(name, x0, x1, y0, y1, z0, z1, material):
    mesh = bpy.data.meshes.new(name)
    verts = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def import_level(path, level, body, windows, heading_rad, offset=(0.0, 0.0, 0.0)):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path, import_shading="FLAT")
    objects = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    for obj in objects:
        obj.data.materials.clear()
        obj.data.materials.append(windows if obj.name.endswith("-windows") else body)
        obj.rotation_mode = "XYZ"
        obj.rotation_euler = (0.0, 0.0, heading_rad)
        obj.location = offset
        obj["cc_level"] = level
    return objects


def context(data, heading_rad):
    """Water, and land slabs at the land top beyond each end of a bridge (or under a building)."""
    water = solid_material("preview-water", WATER)
    land = solid_material("preview-land", LAND)
    box_object("water", -20000, 20000, -20000, 20000, -1.0, 0.0, water)
    top = inputs.land_top_y(data["scene"])
    frame = data["frame"]
    if frame["base"] != "water":
        box_object("land", -3000, 3000, -3000, 3000, 0.0, top, land)
        return
    half = frame["spanM"] / 2.0
    towers = data["model"]["params"]["towers"]["offsetsM"]
    # Shorelines just landward of each tower (the towers stand on piers in the river).
    shore = (towers[0] - 260.0, towers[1] + 70.0)
    for name, y0, y1 in (("land-a", -half - 2500, shore[0]), ("land-b", shore[1], half + 2500)):
        obj = box_object(name, -2500, 2500, y0, y1, 0.0, top, land)
        obj.rotation_euler = (0.0, 0.0, heading_rad)


def lights(mode):
    elevation, azimuth, colour, strength, sky, sky_strength = LIGHTING[mode]
    for obj in [o for o in bpy.data.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(obj, do_unlink=True)
    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = strength
    sun_data.color = colour
    sun_data.angle = math.radians(4.0)
    sun = bpy.data.objects.new("sun", sun_data)
    sun.rotation_euler = (math.radians(90.0 - elevation), 0.0, math.radians(azimuth))
    bpy.context.scene.collection.objects.link(sun)
    world = bpy.context.scene.world or bpy.data.worlds.new("world")
    bpy.context.scene.world = world
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (sky[0], sky[1], sky[2], 1.0)
    background.inputs["Strength"].default_value = sky_strength


def camera(target, distance, polar_deg, azimuth_deg, fov_deg):
    cam = bpy.context.scene.camera
    if cam is None:
        cam = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
        bpy.context.scene.collection.objects.link(cam)
        bpy.context.scene.camera = cam
    cam.data.sensor_fit = "VERTICAL"
    cam.data.angle_y = math.radians(fov_deg)
    cam.data.clip_start = max(1.0, distance * 0.01)
    cam.data.clip_end = distance * 10 + 50000
    p, a = math.radians(polar_deg), math.radians(azimuth_deg)
    eye = (
        target[0] + distance * math.sin(p) * math.sin(a),
        target[1] - distance * math.sin(p) * math.cos(a),
        target[2] + distance * math.cos(p),
    )
    cam.location = eye
    dx, dy, dz = target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]
    cam.rotation_mode = "XYZ"
    cam.rotation_euler = (math.atan2(math.hypot(dx, dy), -dz), 0.0, math.atan2(dy, dx) - math.pi / 2)


def show_only(levels_objects, level):
    for lv, objects in levels_objects.items():
        for obj in objects:
            obj.hide_render = lv != level


def render(path, size):
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def eevee():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 48
    scene.eevee.use_shadows = True
    scene.eevee.use_raytracing = True
    scene.eevee.fast_gi_method = "GLOBAL_ILLUMINATION"
    # Khronos PBR Neutral keeps base colours true (three's NeutralToneMapping is the same curve).
    scene.view_settings.view_transform = "Khronos PBR Neutral"
    scene.view_settings.exposure = EXPOSURE
    scene.render.film_transparent = False


def fit_distance(length, size, fov_deg, fill=0.85):
    """Camera distance at which `length` spans `fill` of the frame's width."""
    aspect = size[0] / size[1]
    width_at_1 = 2.0 * math.tan(math.radians(fov_deg) / 2.0) * aspect
    return length / (fill * width_at_1)


def main():
    env.require_pinned_version()
    args = parse_args()
    env.reset_scene()
    data = inputs.landmark_inputs(args.id)
    with open(os.path.join(args.glb, "report.json"), "r", encoding="utf-8") as handle:
        report = json.load(handle)
    scene_cfg = data["scene"]
    fov = scene_cfg["camera"]["fovDeg"]
    heading = data["frame"]["headingDeg"]
    heading_rad = -math.radians(heading)
    body, windows = shade.materials(data["palette"])
    os.makedirs(args.out, exist_ok=True)
    prefix = os.path.join(args.out, args.label + "-" if args.label else "")

    context(data, heading_rad)
    levels = {lv: import_level(os.path.join(args.glb, "lod%d.glb" % lv), lv, body, windows, heading_rad) for lv in lod.LEVELS}
    height = data["measurements"]["dimensions"]["towerHeightM"]["valueM"]
    length = data["frame"].get("spanM", 200.0)
    centre = (0.0, 0.0, height * 0.35)
    tower_s = data["model"]["params"]["towers"]["offsetsM"][1]
    tower = (-math.sin(heading_rad) * tower_s, math.cos(heading_rad) * tower_s, height * 0.55)

    eevee()
    show_only(levels, 0)
    polar = scene_cfg["camera"]["polarDeg"]
    arch_az = scene_cfg["camera"]["azimuthDeg"]["max"]
    for mode in LIGHTING:
        lights(mode)
        for size_name, size in SIZES.items():
            d = fit_distance(length, size, fov)
            for az in (polar_az for polar_az in (-40, 0, 40)):
                camera(centre, d, polar["default"], az, fov)
                render("%sgame-p48-az%+d-%s-%s.png" % (prefix, az, mode, size_name), size)
            camera(centre, d, polar["min"], 0, fov)
            render("%sgame-p12-%s-%s.png" % (prefix, mode, size_name), size)
            camera(tower, 420.0, polar["default"], arch_az, fov)
            render("%sclose-tower-p48-%s-%s.png" % (prefix, mode, size_name), size)
            camera(tower, scene_cfg["camera"]["minDistanceM"], polar["default"], arch_az, fov)
            render("%sclose-min-distance-%s-%s.png" % (prefix, mode, size_name), size)
            camera(tower, 360.0, polar["max"], arch_az, fov)
            render("%sclose-tower-p60-%s-%s.png" % (prefix, mode, size_name), size)

    # Each tier's finest level up close: what a mid or low device shows at the minimum distance.
    lights("day")
    for tier, tier_levels in lod.TIER_LEVELS.items():
        show_only(levels, tier_levels[0])
        camera(tower, scene_cfg["camera"]["minDistanceM"], polar["default"], arch_az, fov)
        render("%sclose-min-distance-%s-L%d.png" % (prefix, tier, tier_levels[0]), SIZES["wide"])

    # Far check at the default camera distance: the level each tier shows there.
    far = scene_cfg["camera"]["distanceM"]
    multiplier = scene_cfg["landmarks"]["bridgeDistanceMultiplier"] if data["frame"]["base"] == "water" else 1.0
    for tier, tier_levels in lod.TIER_LEVELS.items():
        switches = [d * multiplier for d in scene_cfg["landmarks"]["lod"][tier]["distancesM"]]
        level = tier_levels[max(i for i, d in enumerate(switches) if d <= far)]
        show_only(levels, level)
        camera(centre, far, polar["default"], 0, fov)
        render("%sfar-4500m-%s-L%d.png" % (prefix, tier, level), SIZES["square"])

    # Workbench LOD strip: the four levels side by side with their triangle counts.
    for lv, objects in levels.items():
        for obj in objects:
            obj.hide_render = False
            obj.rotation_euler = (0.0, 0.0, 0.0)
            obj.location = ((lv - 1.5) * 140.0, 0.0, 0.0)
    for obj in bpy.data.objects:
        if obj.name.startswith(("water", "land")):
            obj.hide_render = True
    scene = bpy.context.scene
    strip_s = data["model"]["params"]["towers"]["offsetsM"][1] if data["frame"]["base"] == "water" else 0.0
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "VERTEX"
    scene.display.shading.single_color = (0.05, 0.05, 0.05)
    scene.display.shading.show_cavity = True
    scene.display.shading.show_object_outline = True
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.86, 0.86, 0.84)
    label_material = solid_material("preview-label", (0.05, 0.05, 0.05))
    for entry in report["levels"]:
        curve = bpy.data.curves.new("label%d" % entry["level"], "FONT")
        curve.body = "L%d\n%d tris" % (entry["level"], entry["triangles"])
        curve.size = 16.0
        curve.align_x = "CENTER"
        curve.materials.append(label_material)
        label = bpy.data.objects.new("label%d" % entry["level"], curve)
        label.location = ((entry["level"] - 1.5) * 140.0, strip_s - 190.0, 95.0)
        label.rotation_euler = (math.radians(58.0), 0.0, math.radians(-20.0))
        scene.collection.objects.link(label)
    camera((0.0, strip_s - 60.0, 30.0), 620.0, 58.0, -20.0, fov)
    render("%slod-strip-workbench.png" % prefix, SIZES["wide"])


if __name__ == "__main__":
    main()
