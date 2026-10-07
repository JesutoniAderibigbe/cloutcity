import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APARTMENT_MARKER,
  checkBudget,
  containsMarker,
  extractScripts,
  gzipBytes,
  lazyChunkFiles,
  readApartmentChunkLimit,
  readSceneChunkLimit,
  readShellLimit,
  staticFilePath,
} from './budget'

describe('extractScripts', () => {
  it('collects external chunks once and inline bodies, skipping data blocks and nomodule', () => {
    const html = [
      '<script src="/_next/static/chunks/a.js" async=""></script>',
      '<script src="/_next/static/chunks/a.js"></script>',
      '<script>self.__next_f.push([1,"x"])</script>',
      '<script type="application/ld+json">{"@type":"Game"}</script>',
      '<script type="module" src="/_next/static/chunks/b.js"></script>',
      '<script>  </script>',
      '<script src="/_next/static/chunks/polyfill.js" noModule=""></script>',
    ].join('')

    expect(extractScripts(html)).toEqual({
      external: ['/_next/static/chunks/a.js', '/_next/static/chunks/b.js'],
      inline: ['self.__next_f.push([1,"x"])'],
    })
  })
})

describe('staticFilePath', () => {
  it('maps a static URL into the build directory and drops the query', () => {
    expect(staticFilePath('/_next/static/chunks/a.js?v=1', '/dist')).toBe(
      join('/dist', 'static', 'chunks/a.js'),
    )
  })

  it('rejects scripts from elsewhere and path traversal', () => {
    expect(() => staticFilePath('https://cdn.example/x.js', '/dist')).toThrow(/outside/)
    expect(() => staticFilePath('/_next/static/../../etc/passwd', '/dist')).toThrow(/traversal/)
  })
})

describe('checkBudget', () => {
  it('passes at the limit and fails one byte over', () => {
    expect(checkBudget('shell', 180_000, 180).ok).toBe(true)
    expect(checkBudget('shell', 180_001, 180).ok).toBe(false)
    expect(checkBudget('shell', 123_456, 180).actualKB).toBe(123.5)
  })
})

describe('readShellLimit', () => {
  it('reads a positive limit and rejects anything else', () => {
    expect(readShellLimit({ shellJsGzKB: 180 })).toBe(180)
    expect(() => readShellLimit({})).toThrow()
    expect(() => readShellLimit({ shellJsGzKB: -1 })).toThrow()
    expect(() => readShellLimit({ shellJsGzKB: '180' })).toThrow()
    expect(() => readShellLimit(null)).toThrow()
  })
})

describe('gzipBytes', () => {
  it('compresses repetitive input below its raw size', () => {
    const raw = 'a'.repeat(10_000)
    expect(gzipBytes(raw)).toBeLessThan(raw.length)
  })
})

describe('readSceneChunkLimit', () => {
  it('reads a positive limit and rejects anything else', () => {
    expect(readSceneChunkLimit({ sceneChunkJsGzKB: 350 })).toBe(350)
    expect(() => readSceneChunkLimit({})).toThrow(/sceneChunkJsGzKB/)
    expect(() => readSceneChunkLimit({ sceneChunkJsGzKB: 0 })).toThrow()
  })
})

describe('readApartmentChunkLimit', () => {
  it('reads a positive limit and rejects anything else', () => {
    expect(readApartmentChunkLimit({ apartmentChunkJsGzKB: 40 })).toBe(40)
    expect(() => readApartmentChunkLimit({})).toThrow(/apartmentChunkJsGzKB/)
    expect(() => readApartmentChunkLimit({ apartmentChunkJsGzKB: 0 })).toThrow()
  })
})

describe('containsMarker', () => {
  it('finds the whole marker only, never as the start of a longer id', () => {
    expect(containsMarker(`x="${APARTMENT_MARKER}"`, APARTMENT_MARKER)).toBe(true)
    expect(containsMarker(`x="${APARTMENT_MARKER}-extra"`, APARTMENT_MARKER)).toBe(false)
    expect(containsMarker(`"${APARTMENT_MARKER}x" "${APARTMENT_MARKER}"`, APARTMENT_MARKER)).toBe(
      true,
    )
    expect(containsMarker('cc-feature:city-scene', APARTMENT_MARKER)).toBe(false)
  })
})

describe('lazyChunkFiles', () => {
  const isApartment = (file: string) => file === 'static/chunks/room.js'

  it('splits the city 3D chunk from what only the apartment import adds', () => {
    const manifest = {
      '1': { id: 1, files: ['static/chunks/scene.js', 'static/chunks/three.js'] },
      '2': { id: 2, files: ['static/chunks/three.js', 'static/chunks/room.js'] },
      '3': { id: 3, files: ['static/chunks/scene.js', 'static/css/scene.css'] },
    }
    expect(lazyChunkFiles(manifest, [], isApartment)).toEqual({
      scene: ['static/chunks/scene.js', 'static/chunks/three.js'],
      apartment: ['static/chunks/room.js'],
    })
  })

  it('leaves out shell scripts, CSS and duplicates', () => {
    const manifest = {
      '1': { id: 1, files: ['static/chunks/scene.js', 'static/chunks/shared.js'] },
      '2': { id: 2, files: ['static/chunks/room.js', 'static/chunks/shared.js'] },
    }
    expect(lazyChunkFiles(manifest, ['/_next/static/chunks/shared.js?v=1'], isApartment)).toEqual({
      scene: ['static/chunks/scene.js'],
      apartment: ['static/chunks/room.js'],
    })
  })

  it('fails fast without exactly one apartment import, or without a city chunk', () => {
    const city = { '1': { id: 1, files: ['static/chunks/scene.js'] } }
    expect(() => lazyChunkFiles(city, [], isApartment)).toThrow(/found 0/)
    const twice = {
      ...city,
      '2': { id: 2, files: ['static/chunks/room.js'] },
      '3': { id: 3, files: ['static/chunks/room.js', 'static/chunks/x.js'] },
    }
    expect(() => lazyChunkFiles(twice, [], isApartment)).toThrow(/found 2/)
    const roomOnly = { '2': { id: 2, files: ['static/chunks/room.js'] } }
    expect(() => lazyChunkFiles(roomOnly, [], isApartment)).toThrow(/no lazy JS/)
  })

  it('fails fast on an unknown format, an empty manifest or path traversal', () => {
    expect(() => lazyChunkFiles([], [], isApartment)).toThrow(/format/)
    expect(() => lazyChunkFiles({ '1': { files: 'x.js' } }, [], isApartment)).toThrow(/format/)
    expect(() => lazyChunkFiles({}, [], isApartment)).toThrow(/no lazy JS/)
    expect(() =>
      lazyChunkFiles({ '1': { files: ['static/../../x.js'] } }, [], isApartment),
    ).toThrow(/traversal/)
  })
})
