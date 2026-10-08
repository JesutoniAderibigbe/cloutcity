"""Materials. Colour lives in vertex colours and the night glow in `_EMISSIVE`, so a landmark is
one mesh with one material per level.

- `export_material`: the placeholder written into the GLB ("model", as the S04h pipeline
  writes); the runtime swaps in the shared model material, so no new shader program.
- `preview_material`: what preview.py renders with: the vertex colours, lit, glowing by
  `_EMISSIVE` times the night-glow strength the preview sets per keyframe.
"""

import bpy

EXPORT = "model"
PREVIEW = "cc-preview"
ROUGHNESS = 0.9


def _vertex_coloured(name, roughness):
    material = bpy.data.materials.new(name)
    # Single-sided like the runtime's shared model material, so previews show what culls.
    material.use_backface_culling = True
    tree = material.node_tree
    bsdf = tree.nodes.get("Principled BSDF")
    attribute = tree.nodes.new("ShaderNodeVertexColor")
    attribute.layer_name = "Color"
    tree.links.new(attribute.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    return material, tree, bsdf


def export_material():
    material, _tree, _bsdf = _vertex_coloured(EXPORT, 1.0)
    return material


def preview_material():
    material, tree, bsdf = _vertex_coloured(PREVIEW, ROUGHNESS)
    glow = tree.nodes.new("ShaderNodeAttribute")
    glow.attribute_name = "_EMISSIVE"
    tree.links.new(glow.outputs["Vector"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 0.0
    return material


def set_glow(material, strength):
    material.node_tree.nodes.get("Principled BSDF").inputs["Emission Strength"].default_value = strength
