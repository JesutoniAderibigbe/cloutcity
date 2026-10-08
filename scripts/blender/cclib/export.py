"""Turn a level's Builder into Blender objects and write it as GLB.

One uncompressed GLB per level (the master, kept in the gitignored .cache/blender); run.ts then
merges and compresses it into the S04h runtime format (scripts/blender/ship.ts). Export settings
are fixed so the bytes depend only on the geometry: no extras, no images, no animation, cameras
or lights. Flat normals are written: the runtime draws every model with the one shared model
material (src/scene/models/materials.ts), which reads them.
"""

import hashlib
import os

import bpy


def objects_for(builder, landmark_id, level, material):
    """One mesh object named <id>-lod<n>: colours as COLOR_0, night glow as `_EMISSIVE`."""
    name = "%s-lod%d" % (landmark_id, level)
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(builder.verts, [], builder.faces)
    mesh.validate(clean_customdata=False)
    attribute = mesh.color_attributes.new(name="Color", type="BYTE_COLOR", domain="CORNER")
    values = []
    for polygon in mesh.polygons:
        rgb = builder.colors[polygon.index]
        for _ in range(polygon.loop_total):
            values.extend((rgb[0], rgb[1], rgb[2], 1.0))
    attribute.data.foreach_set("color_srgb", values)
    mesh.color_attributes.active_color = attribute
    # Vertices are never shared between polygons (prim.Builder), so a per-vertex glow is a
    # per-face glow. Blender exports an attribute starting with "_" as that glTF attribute.
    glow = mesh.attributes.new(name="_EMISSIVE", type="FLOAT_VECTOR", domain="POINT")
    glow.data.foreach_set("vector", [c for g in builder.glows for c in g])
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return [obj]


def export_glb(objects, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for obj in bpy.context.scene.objects:
        obj.select_set(obj in objects)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_extras=False,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_materials="EXPORT",
        export_image_format="NONE",
        export_texcoords=False,
        export_normals=True,
        export_tangents=False,
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=False,
        export_attributes=True,
        export_meshopt_compression_enable=False,
        export_draco_mesh_compression_enable=False,
    )
    return file_facts(path)


def file_facts(path):
    with open(path, "rb") as handle:
        blob = handle.read()
    return {"bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest()}


def remove(objects):
    for obj in objects:
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.meshes.remove(mesh)

