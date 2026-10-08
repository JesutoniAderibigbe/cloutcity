/**
 * Where each landmark's model comes from (DEC-25). A landmark with a Blender model (S07c,
 * data/landmarks/blender.derived.json) draws its GLB levels once they load; the code-built kit
 * (buildLandmark) draws until then, and stays the fallback if a level fails to load.
 */
export type LandmarkSource = 'kit' | 'glb'
