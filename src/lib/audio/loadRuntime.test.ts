import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ fail: true, attached: [] as unknown[] }))

vi.mock('./runtime', () => {
  if (state.fail) throw new Error('ChunkLoadError')
  return { attach: (context: unknown) => state.attached.push(context) }
})

describe('loading the audio runtime', () => {
  beforeEach(() => {
    vi.resetModules()
    state.fail = true
    state.attached = []
  })

  it('reports a runtime that did not load, and a retry loads it again', async () => {
    const { markMapPlayable } = await import('@/state/mapPlayable')
    const { audioStatusStore } = await import('@/state/audioStatus')
    const { startRuntimeWhenPlayable, retryAudio } = await import('./loadRuntime')
    markMapPlayable()
    const context = {} as AudioContext
    startRuntimeWhenPlayable(context)
    await vi.waitFor(() => expect(audioStatusStore.getState().runtimeFailed).toBe(true))

    state.fail = false
    vi.doUnmock('./runtime')
    vi.doMock('./runtime', () => ({
      attach: (attached: unknown) => state.attached.push(attached),
    }))
    retryAudio()
    expect(audioStatusStore.getState().runtimeFailed).toBe(false)
    await vi.waitFor(() => expect(state.attached).toEqual([context]))
  })

  it('a retry with a running runtime asks it to reload music', async () => {
    const { attachMusicRetry, retryAudio } = await import('./loadRuntime')
    const retry = vi.fn()
    const detach = attachMusicRetry(retry)
    retryAudio()
    expect(retry).toHaveBeenCalledTimes(1)
    detach()
    retryAudio()
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
