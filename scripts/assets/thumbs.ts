/**
 * `npm run thumbs`: renders the shop's item thumbnails (S04k) offline, at build time, from the
 * hand-made CC0 models the apartment already uses (data/config/scene.json `models.decor`), so
 * the game never renders a preview at runtime and the playable path gains nothing.
 *
 *   npm run thumbs            render, write public/thumbs/<item>.<sha8>.webp and
 *                             data/items/thumbs.derived.json, delete stale thumbnails
 *   npm run thumbs -- --check render in memory and fail if the committed outputs differ in name
 *
 * Each model renders in headless Chromium with three (the pinned node_modules copy, the same
 * meshopt decoder as the game), recoloured to the item's first colour variant, from a fixed
 * three-quarter angle under a soft key and fill light, on a transparent ground, at
 * `thumbs.sizePx`. Items without a model keep their icon tile (data/items/looks.json).
 * WebP bytes depend on the browser's encoder, so `--check` compares the item list, never bytes.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { WEBGL_LAUNCH_ARGS } from '../../playwright.config.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const OUT_DIR = join(ROOT, 'public/thumbs')
const INDEX = join(ROOT, 'data/items/thumbs.derived.json')
const ORIGIN = 'http://thumbs.invalid'

interface ManifestModel {
  readonly id: string
  readonly slots: readonly string[]
  readonly tiers: Readonly<Record<'low' | 'mid' | 'high', { readonly file: string }>>
}

interface Job {
  readonly itemId: string
  readonly file: string
  readonly slots: readonly string[]
  readonly slot: string | null
  readonly color: string
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(join(ROOT, path), 'utf8')) as T
}

async function jobs(): Promise<Job[]> {
  const scene = await readJson<{
    models: { decor: Record<string, { model: string; slot: string | null }> }
  }>('data/config/scene.json')
  const manifest = await readJson<{ models: ManifestModel[] }>('data/assets/manifest.json')
  const items = await readJson<{
    items: { id: string; decor?: { variants: { token: string }[] } }[]
  }>('data/items/items.json')
  const theme = await readJson<{ colors: Record<string, string> }>('data/config/theme.json')
  return Object.entries(scene.models.decor)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([itemId, entry]) => {
      const model = manifest.models.find((candidate) => candidate.id === entry.model)
      const item = items.items.find((candidate) => candidate.id === itemId)
      const token = item?.decor?.variants[0]?.token
      const color = token === undefined ? undefined : theme.colors[token]
      if (model === undefined || color === undefined) {
        throw new Error(`thumbs: no model or colour for ${itemId}`)
      }
      return { itemId, file: model.tiers.high.file, slots: model.slots, slot: entry.slot, color }
    })
}

/** The page that renders one model per call of `window.renderThumb`. */
const PAGE = (size: number) => `<!doctype html>
<html><head><script type="importmap">
{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}
</script></head><body style="margin:0;background:transparent">
<canvas id="c" width="${size}" height="${size}"></canvas>
<script type="module">
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
const canvas = document.getElementById('c')
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
renderer.setClearColor(0x000000, 0)
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
window.renderThumb = async ({ file, slots, slot, color }) => {
  const gltf = await loader.loadAsync(file)
  const scene = new THREE.Scene()
  const target = new THREE.Color(color)
  const index = slots.indexOf(slot) + 1
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return
    const geometry = object.geometry
    const slotAttr = geometry.getAttribute('_slot')
    const colors = geometry.getAttribute('color')
    if (slotAttr && colors && index > 0) {
      for (let i = 0; i < slotAttr.count; i++) {
        if (slotAttr.getX(i) === index) colors.setXYZ(i, target.r, target.g, target.b)
      }
    }
    object.material = new THREE.MeshLambertMaterial({ vertexColors: colors !== undefined })
  })
  scene.add(gltf.scene)
  scene.add(new THREE.HemisphereLight(0xfff6ea, 0x8a7a6a, 1.6))
  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(3, 5, 4)
  scene.add(key)
  const box = new THREE.Box3().setFromObject(gltf.scene)
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100)
  const dir = new THREE.Vector3(1, 0.85, 1.25).normalize()
  const distance = (sphere.radius * 1.12) / Math.sin((30 * Math.PI) / 360)
  camera.position.copy(sphere.center).addScaledVector(dir, distance)
  camera.lookAt(sphere.center)
  renderer.render(scene, camera)
  return canvas.toDataURL('image/webp', 0.86)
}
window.thumbsReady = true
</script></body></html>`

async function render(list: readonly Job[], size: number): Promise<Map<string, Buffer>> {
  const browser = await chromium.launch({ args: WEBGL_LAUNCH_ARGS })
  try {
    const page = await browser.newPage()
    await page.route(`${ORIGIN}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/') {
        await route.fulfill({ contentType: 'text/html', body: PAGE(size) })
        return
      }
      const file = path.startsWith('/three/')
        ? join(ROOT, 'node_modules', path)
        : join(ROOT, 'public', path)
      const type = path.endsWith('.js') ? 'text/javascript' : 'model/gltf-binary'
      await route.fulfill({ contentType: type, body: await readFile(file) })
    })
    await page.goto(`${ORIGIN}/`)
    await page.waitForFunction(() => (window as { thumbsReady?: boolean }).thumbsReady === true)
    const out = new Map<string, Buffer>()
    for (const job of list) {
      const dataUrl = await page.evaluate(
        (input) =>
          (window as unknown as { renderThumb: (j: unknown) => Promise<string> }).renderThumb(
            input,
          ),
        { file: job.file, slots: job.slots, slot: job.slot, color: job.color },
      )
      const [, base64] = dataUrl.split(',')
      if (!dataUrl.startsWith('data:image/webp') || base64 === undefined) {
        throw new Error(`thumbs: ${job.itemId} did not render as WebP`)
      }
      out.set(job.itemId, Buffer.from(base64, 'base64'))
    }
    return out
  } finally {
    await browser.close()
  }
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check')
  const { thumbs } = await readJson<{ thumbs: { sizePx: number } }>('data/items/looks.json')
  const list = await jobs()
  const images = await render(list, thumbs.sizePx)
  const index: Record<string, string> = {}
  for (const [itemId, bytes] of images) {
    const sha8 = createHash('sha256').update(bytes).digest('hex').slice(0, 8)
    index[itemId] = `/thumbs/${itemId}.${sha8}.webp`
  }
  if (check) {
    const committed = await readJson<Record<string, string>>('data/items/thumbs.derived.json')
    const want = Object.keys(index).sort().join(',')
    const have = Object.keys(committed).sort().join(',')
    if (want !== have) throw new Error(`thumbs: committed items ${have}, expected ${want}`)
    return
  }
  await mkdir(OUT_DIR, { recursive: true })
  const keep = new Set(Object.values(index).map((url) => url.slice('/thumbs/'.length)))
  for (const name of await readdir(OUT_DIR)) {
    if (!keep.has(name)) await rm(join(OUT_DIR, name))
  }
  for (const [itemId, bytes] of images) {
    const url = index[itemId]
    if (url !== undefined) await writeFile(join(ROOT, 'public', url), bytes)
  }
  await writeFile(INDEX, `${JSON.stringify(index, null, 2)}\n`)
  process.stdout.write(`thumbs: wrote ${images.size} thumbnails\n`)
}

await main()
