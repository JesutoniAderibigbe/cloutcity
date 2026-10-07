"""Turn a level's Builder into Blender objects and write it as GLB.

Two files per level: an uncompressed GLB (the master, kept in the gitignored .cache/blender)
and, when asked, a meshopt-compressed one through Blender's own exporter (the interim shipped
file until the S04h asset script owns compression). Export settings are fixed so the bytes
depend only on the geometry: no extras, no images, no animation, cameras or lights.

No normals are written: every face is flat, and three's GLTFLoader shades a primitive without
normals with `flatShading` (per-pixel face normals), which saves 12 bytes per vertex.
"""

import hashlib
import os

import bpy


def objects_for(builder, landmark_id, level, body_material, windows_material):
    """One mesh object per non-empty group, named <id>-lod<n>-<group>."""
    objects = []
    for group, material in (("body", body_material), ("windows", windows_material)):
        data = builder.data[group]
        if not data["faces"]:
            continue
        name = "%s-lod%d-%s" % (landmark_id, level, group)
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(data["verts"], [], data["faces"])
        mesh.validate(clean_customdata=False)
        attribute = mesh.color_attributes.new(name="Color", type="BYTE_COLOR", domain="CORNER")
        values = []
        for polygon in mesh.polygons:
            rgb = data["colors"][polygon.index]
            for _ in range(polygon.loop_total):
                values.extend((rgb[0], rgb[1], rgb[2], 1.0))
        attribute.data.foreach_set("color_srgb", values)
        mesh.color_attributes.active_color = attribute
        mesh.materials.append(material)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        objects.append(obj)
    return objects


def export_glb(objects, path, compress):
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
        export_normals=False,
        export_tangents=False,
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=False,
        export_attributes=False,
        export_meshopt_compression_enable=compress,
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

