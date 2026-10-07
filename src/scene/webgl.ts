/**
 * Whether this browser can create a WebGL2 context, checked before the 3D canvas mounts so a
 * device without WebGL goes straight to the fallback instead of failing inside the renderer.
 * The probe context is only dropped, not lost with WEBGL_lose_context: Chromium logs a console
 * warning for loseContext(), and the garbage collector releases the context anyway.
 */
export function webgl2Available(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null
  } catch {
    return false
  }
}
