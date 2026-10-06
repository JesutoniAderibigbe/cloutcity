import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkBudget, extractScripts, gzipBytes, readShellLimit, staticFilePath } from './budget'

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
