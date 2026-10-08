"""Render review images of a built landmark from its exported GLBs (not from the build scene,
so what is reviewed is what ships).

    blender -b --factory-startup -noaudio --python-exit-code 1 -P scripts/blender/preview.py -- \
        --id brooklyn-bridge --glb <dir with lod<n>.glb and report.json> --out <png dir> \
        [--compare <a true-scale build dir>] [--label <prefix>]

Lighting follows the S04f day/night keyframes (scene.json `dayNight`, theme.json `sky`): the
sun's direction (never below `minSunElevationDeg`), colour and intensity, the ambient and
hemisphere fill as the world colour, the harbour colour, and the lamps glowing by the
keyframe's `nightGlow` times `models.emissive.nightIntensity`. Blender's EEVEE only
approximates the game's three.js renderer; the numbers map one to one, the response does not.

Views:
- the game camera on a 390x844 phone (polar 48°, azimuth 0) at the default distance and at the
  landmark focus distance, with the level each quality tier shows there, at golden hour and at
  night (and day at the default distance);
- close views of the second tower (420 m, polar 48° and 60°) at golden hour and at night;
- with --compare: the true-scale build beside this one, from the same cameras;
- a Workbench strip of the four levels with their triangle counts.

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

#: Blender sun strength and world strength per unit of the game's light intensities, set so the
#: day keyframe matches the S04h showcase's exposure.
SUN_PER_INTENSITY = 2.2
WORLD_PER_INTENSITY = 0.35
EXPOSURE = -0.4
PHONE = (390, 844)
WIDE = (1280, 720)
#: Lateral gap between the compared models in the side-by-side views.
COMPARE_GAP_M = 420.0


def parse_args():
    rest = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="preview.py")
    parser.add_argument("--id", required=True)
    parser.add_argument("--glb", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--compare", default=None)
    parser.add_argument("--label", default="")
    return parser.parse_args(rest)


def hex_linear(hex_colour):
    srgb = [int(hex_colour[i:i + 2], 16) / 255.0 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)


def theme_colour(theme, token):
    for group in ("models", "world", "colors"):
        if token in theme.get(group, {}):
            return hex_linear(theme[group][token])
    raise KeyError(token)


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
    theme = inputs.read_json("data", "config", "theme.json")
    water = solid_material("preview-water", (1.0, 1.0, 1.0))
    land = solid_material("preview-land", theme_colour(theme, theme["scene"]["land"]["brooklyn"]))
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


def keyframe(scene_cfg, keyframe_id):
    return next(k for k in scene_cfg["dayNight"]["keyframes"] if k["id"] == keyframe_id)


def lights(data, keyframe_id, windows):
    """The S04f keyframe's light: sun, world fill, harbour colour and the lamps' night glow."""
    scene_cfg = data["scene"]
    theme = inputs.read_json("data", "config", "theme.json")
    k = keyframe(scene_cfg, keyframe_id)
    sky = theme["sky"][keyframe_id]
    for obj in [o for o in bpy.data.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(obj, do_unlink=True)
    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = k["sunIntensity"] * SUN_PER_INTENSITY
    sun_data.color = theme_colour(theme, sky["sun"])
    sun_data.angle = math.radians(4.0)
    sun = bpy.data.objects.new("sun", sun_data)
    elevation = max(k["sun"]["elevationDeg"], scene_cfg["dayNight"]["minSunElevationDeg"])
    # Blender's sun shines down its -Z; tilt it to the elevation, then turn it to the compass
    # azimuth (clockwise from north; at 180° the light comes from the south).
    sun.rotation_euler = (math.radians(90.0 - elevation), 0.0, math.radians(180.0 - k["sun"]["azimuthDeg"]))
    bpy.context.scene.collection.objects.link(sun)
    world = bpy.context.scene.world or bpy.data.worlds.new("world")
    bpy.context.scene.world = world
    ambient = theme_colour(theme, sky["ambient"])
    hemi = theme_colour(theme, sky["hemisphereSky"])
    a, h = k["ambientIntensity"], k["hemisphereIntensity"]
    fill = tuple((ambient[i] * a + hemi[i] * h) / max(a + h, 1e-6) for i in range(3))
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (fill[0], fill[1], fill[2], 1.0)
    background.inputs["Strength"].default_value = (a + h) * WORLD_PER_INTENSITY
    water = theme_colour(theme, sky["water"])
    bsdf = bpy.data.materials["preview-water"].node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (water[0], water[1], water[2], 1.0)
    glow = k["nightGlow"] * scene_cfg["models"]["emissive"]["nightIntensity"]
    windows.node_tree.nodes.get("Principled BSDF").inputs["Emission Strength"].default_value = glow


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


def tier_level(scene_cfg, tier, distance, bridge):
    """The level `tier` shows at `distance` (scene.json landmarks.lod)."""
    multiplier = scene_cfg["landmarks"]["bridgeDistanceMultiplier"] if bridge else 1.0
    switches = [d * multiplier for d in scene_cfg["landmarks"]["lod"][tier]["distancesM"]]
    levels = lod.TIER_LEVELS[tier]
    return levels[max(i for i, d in enumerate(switches) if d <= distance)]


def import_all(directory, body, windows, heading_rad, offset):
    return {
        lv: import_level(os.path.join(directory, "lod%d.glb" % lv), lv, body, windows, heading_rad, offset)
        for lv in lod.LEVELS
    }


def main():
    env.require_pinned_version()
    args = parse_args()
    env.reset_scene()
    data = inputs.landmark_inputs(args.id)
    with open(os.path.join(args.glb, "report.json"), "r", encoding="utf-8") as handle:
        report = json.load(handle)
    scene_cfg = data["scene"]
    fov = scene_cfg["camera"]["fovDeg"]
    heading_rad = -math.radians(data["frame"]["headingDeg"])
    bridge = data["frame"]["base"] == "water"
    body, windows = shade.materials(data["palette"])
    os.makedirs(args.out, exist_ok=True)
    prefix = os.path.join(args.out, args.label + "-" if args.label else "")

    context(data, heading_rad)
    levels = import_all(args.glb, body, windows, heading_rad, (0.0, 0.0, 0.0))
    top = max(e["bbox"]["max"][1] for e in report["levels"])
    centre = (0.0, 0.0, top * 0.35)
    tower_s = data["model"]["params"]["towers"]["offsetsM"][1] if bridge else 0.0
    tower = (-math.sin(heading_rad) * tower_s, math.cos(heading_rad) * tower_s, top * 0.55)
    polar = scene_cfg["camera"]["polarDeg"]
    # The azimuth limit whose camera looks most nearly along a bridge, so its arches show.
    arch_az = scene_cfg["camera"]["azimuthDeg"]["max"]
    views = (("default", scene_cfg["camera"]["distanceM"]), ("focus", scene_cfg["focus"]["maxDistanceM"]))

    eevee()
    for keyframe_id in ("golden", "night", "day"):
        lights(data, keyframe_id, windows)
        for view, distance in views:
            if keyframe_id == "day" and view == "focus":
                continue
            for tier in ("high", "mid", "low"):
                level = tier_level(scene_cfg, tier, distance, bridge)
                show_only(levels, level)
                camera(centre, distance, polar["default"], 0, fov)
                render("%sgame-%s-%dm-%s-L%d-%s.png" % (prefix, view, distance, tier, level, keyframe_id), PHONE)
        if keyframe_id == "day":
            continue
        show_only(levels, 0)
        camera(tower, 420.0, polar["default"], arch_az, fov)
        render("%sclose-tower-p48-%s.png" % (prefix, keyframe_id), WIDE)
        camera(tower, 420.0, polar["max"], arch_az, fov)
        render("%sclose-tower-p60-%s.png" % (prefix, keyframe_id), WIDE)

    if args.compare:
        # The true-scale build beside this one, shifted across the bridge axis.
        side = (math.cos(heading_rad) * COMPARE_GAP_M, math.sin(heading_rad) * COMPARE_GAP_M, 0.0)
        other = import_all(args.compare, body, windows, heading_rad, side)
        middle = (side[0] / 2, side[1] / 2, centre[2])
        lights(data, "golden", windows)
        for view, distance in views + (("near", 1500.0),):
            level = tier_level(scene_cfg, "high", distance, bridge)
            show_only(levels, level)
            show_only(other, level)
            camera(middle, distance, polar["default"], 0, fov)
            render("%scompare-%s-%dm-high-L%d-golden.png" % (prefix, view, distance, level), WIDE)
        for objects in other.values():
            for obj in objects:
                obj.hide_render = True

    # Workbench LOD strip: the four levels side by side with their triangle counts.
    spacing = 3.5 * max(abs(v) for e in report["levels"] for v in (e["bbox"]["min"][0], e["bbox"]["max"][0]))
    for lv, objects in levels.items():
        for obj in objects:
            obj.hide_render = False
            obj.rotation_euler = (0.0, 0.0, 0.0)
            obj.location = ((lv - 1.5) * spacing, 0.0, 0.0)
    for obj in bpy.data.objects:
        if obj.name.startswith(("water", "land")):
            obj.hide_render = True
    scene = bpy.context.scene
    strip_s = tower_s
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "VERTEX"
    scene.display.shading.show_cavity = True
    scene.display.shading.show_object_outline = True
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.86, 0.86, 0.84)
    label_material = solid_material("preview-label", (0.05, 0.05, 0.05))
    for entry in report["levels"]:
        curve = bpy.data.curves.new("label%d" % entry["level"], "FONT")
        curve.body = "L%d\n%d tris" % (entry["level"], entry["triangles"])
        curve.size = spacing * 0.11
        curve.align_x = "CENTER"
        curve.materials.append(label_material)
        label = bpy.data.objects.new("label%d" % entry["level"], curve)
        label.location = ((entry["level"] - 1.5) * spacing, strip_s - spacing * 1.35, top * 1.1)
        label.rotation_euler = (math.radians(58.0), 0.0, math.radians(-20.0))
        scene.collection.objects.link(label)
    camera((0.0, strip_s - spacing * 0.45, top * 0.35), spacing * 4.4, 58.0, -20.0, fov)
    render("%slod-strip-workbench.png" % prefix, WIDE)


if __name__ == "__main__":
    main()
