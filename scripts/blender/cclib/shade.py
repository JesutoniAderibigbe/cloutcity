"""The two materials every landmark uses: cc-body (lit, vertex colours) and cc-windows (lamps).

Colour lives in vertex colours, so one material serves every part and a landmark costs at most
two draw calls per level. cc-body is double-sided so ribbon members (suspenders, stays) read
from both sides. cc-windows glows with the lamp colour; the game decides when lamps are on.
"""

import bpy

BODY = "cc-body"
WINDOWS = "cc-windows"
ROUGHNESS = 0.9


def _material(name, emission=None):
    material = bpy.data.materials.new(name)
    material.use_backface_culling = False
    tree = material.node_tree
    nodes = tree.nodes
    bsdf = nodes.get("Principled BSDF")
    attribute = nodes.new("ShaderNodeVertexColor")
    attribute.layer_name = "Color"
    tree.links.new(attribute.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bsdf.inputs["Roughness"].default_value = ROUGHNESS
    bsdf.inputs["Metallic"].default_value = 0.0
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (emission[0], emission[1], emission[2], 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    return material


def materials(palette):
    """(body, windows) materials; the windows glow with the `lamp` role's colour."""
    lamp = palette["lamp"]
    linear = tuple(_srgb_to_linear(c) for c in lamp)
    return _material(BODY), _material(WINDOWS, emission=linear)


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
