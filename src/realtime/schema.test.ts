import { describe, expect, it } from 'vitest'
import { parsePublicSnapshot, parseSnapshot, readLook } from './schema'

const row = {
  id: '00000000-0000-4000-8000-000000000001',
  handle: 'BodegaCat42',
  level: 'scene-regular',
  career: 'streamer',
  avatar: { look: { body: 'man', skin: 'tone-02' }, worn: ['tee-1'] },
  spot: 'place',
  place: 'late-lantern-deli',
  borough: 'queens',
}

describe('parseSnapshot', () => {
  it("reads players, their look ids, worn items and activity, and the viewer's ghost mode", () => {
    expect(
      parseSnapshot({ online: 4, ghost: true, players: [{ ...row, activity: 'dance' }] }),
    ).toEqual({
      online: 4,
      ghost: true,
      players: [
        {
          id: row.id,
          handle: 'BodegaCat42',
          level: 'scene-regular',
          career: 'streamer',
          look: { body: 'man', skin: 'tone-02' },
          worn: ['tee-1'],
          spot: 'place',
          place: 'late-lantern-deli',
          borough: 'queens',
          activity: 'dance',
        },
      ],
    })
  })

  it('an older server (no ghost, no activity) and unknown activities read as none', () => {
    const old = parseSnapshot({ online: 2, players: [row, { ...row, activity: 'karaoke' }] })
    expect(old?.ghost).toBe(false)
    expect(old?.players.map((p) => p.activity)).toEqual([null, null])
  })

  it('an activity only counts at a place; malformed worn items read as none', () => {
    const home = parseSnapshot({
      online: 1,
      players: [{ ...row, spot: 'home', activity: 'dance', avatar: { look: {}, worn: [5] } }],
    })
    expect(home?.players[0]).toMatchObject({ activity: null, worn: [] })
  })

  it('skips bad rows instead of dropping the snapshot', () => {
    const bad = [
      { ...row, id: 'not-a-uuid' },
      { ...row, level: 'mayor' },
      { ...row, borough: 'jersey' },
      { ...row, place: '<script>' },
      { ...row, handle: '' },
    ]
    expect(parseSnapshot({ online: 9, players: [...bad, row] })?.players).toHaveLength(1)
  })

  it('a place only counts when the spot is a place; a broken look reads as none', () => {
    const home = parseSnapshot({
      online: 1,
      players: [{ ...row, spot: 'home', avatar: { look: { body: 'Robot Man!' } } }],
    })
    expect(home?.players[0]).toMatchObject({ spot: 'home', place: null, look: null })
  })

  it('refuses a wrong shape', () => {
    expect(parseSnapshot(null)).toBeNull()
    expect(parseSnapshot({ online: -1, players: [] })).toBeNull()
    expect(parseSnapshot({ players: [] })).toBeNull()
  })
})

describe('parsePublicSnapshot', () => {
  it('reads the count and nothing else', () => {
    expect(parsePublicSnapshot({ online: 2 })).toEqual({ online: 2 })
    // Anything more the server might send is dropped, never drawn.
    expect(
      parsePublicSnapshot({ online: 2, figures: [{ place: 'late-lantern-deli', look: {} }] }),
    ).toEqual({ online: 2 })
    expect(parsePublicSnapshot({ online: -1 })).toBeNull()
    expect(parsePublicSnapshot({})).toBeNull()
  })
})

describe('readLook', () => {
  it('accepts option ids only', () => {
    expect(readLook({ body: 'woman', top: 'teal' })).toEqual({ body: 'woman', top: 'teal' })
    expect(readLook({})).toBeNull()
    expect(readLook({ body: 5 })).toBeNull()
    expect(readLook('woman')).toBeNull()
  })
})
