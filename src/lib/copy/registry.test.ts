/**
 * Namespace loading (S05c). Each test starts from a fresh module graph (vi.resetModules), so only
 * what the copy core itself registers (the boot namespaces) is loaded until a test imports more.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
})

async function freshCore() {
  const core = await import('./index')
  const registry = await import('./registry')
  return { ...core, ...registry }
}

describe('copy namespaces', () => {
  it('the core registers exactly the boot namespaces', async () => {
    const { BOOT_NAMESPACES, registeredNamespaces } = await freshCore()
    expect(registeredNamespaces().sort()).toEqual([...BOOT_NAMESPACES].sort())
  })

  it('renders boot keys with no other import', async () => {
    const { copy } = await freshCore()
    expect(copy('tabs.map')).toBe('Map')
    expect(copy('loading.retry')).toBe('Try again')
  })

  it('throws a typed error for a key whose namespace is not loaded, never the raw key', async () => {
    const { copy, copyParts, CopyNamespaceNotLoadedError } = await freshCore()
    let thrown: unknown
    try {
      copy('events.ui.continue')
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(CopyNamespaceNotLoadedError)
    expect(thrown).toMatchObject({ namespace: 'events', key: 'events.ui.continue' })
    expect(() => copyParts('welcome.consent.label')).toThrow(CopyNamespaceNotLoadedError)
  })

  it('isCopyKey knows loaded namespaces only', async () => {
    const { isCopyKey } = await freshCore()
    expect(isCopyKey('tabs.map')).toBe(true)
    expect(isCopyKey('events.ui.continue')).toBe(false)
    await import('./ns/events')
    expect(isCopyKey('events.ui.continue')).toBe(true)
    expect(isCopyKey('events.ui.nope')).toBe(false)
  })

  it('importing a namespace module loads it, with the active pack layered over base', async () => {
    const { copy } = await freshCore()
    await import('./ns/voice')
    const { slangPacks } = await import('./all')
    expect(copy('voice.bodega')).toBe(slangPacks.nyc?.strings['voice.bodega'])
  })

  it('an unknown key in a loaded namespace is a plain error, not a namespace error', async () => {
    const { copy, CopyNamespaceNotLoadedError } = await freshCore()
    const render = () => copy('tabs.nope' as Parameters<typeof copy>[0])
    expect(render).toThrow(/Unknown copy key "tabs\.nope"/)
    expect(render).not.toThrow(CopyNamespaceNotLoadedError)
  })

  it('registering a namespace again replaces it (hot reload)', async () => {
    const { copy, registerCopy } = await freshCore()
    registerCopy('tabs', { strings: { 'tabs.map': 'City' } }, {})
    expect(copy('tabs.map')).toBe('City')
  })
})
