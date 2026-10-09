import { describe, expect, it } from 'vitest'
import {
  crowdSize,
  hourShare,
  nightOf,
  placeOccupants,
  planCrowd,
  wantedSpots,
  type CrowdInput,
  type CrowdSpot,
} from './venueCrowd'

const DAY = 24 * 60

const spot = (id: string, over: Partial<CrowdSpot> = {}): CrowdSpot => ({
  id,
  activity: 'dance',
  pose: 'dance',
  x: 0,
  y: 0,
  z: 0,
  headingRad: 0,
  rank: 1,
  staff: false,
  ...over,
})

const SPOTS: CrowdSpot[] = [
  spot('dj', { activity: 'dj', pose: 'talk', rank: 0, staff: true }),
  spot('bartender', { activity: 'bar', pose: 'idle', rank: 0, staff: true }),
  ...Array.from({ length: 10 }, (_, i) => spot(`floor-${i}`, { rank: 1 + (i % 3) })),
  spot('booth-0', { activity: 'booth', pose: 'sit', y: 0.37, rank: 2 }),
  spot('booth-1', { activity: 'booth', pose: 'sit', y: 0.37, rank: 2 }),
  spot('chat-0', { activity: 'chat', pose: 'idle', rank: 4 }),
]

/** Game day `day` (0-based) at `hour`. */
const at = (day: number, hour: number) => day * DAY + hour * 60

function input(over: Partial<CrowdInput> = {}): CrowdInput {
  return {
    spots: SPOTS,
    hours: [
      [22, 0.5],
      [23, 0.8],
      [0, 1],
      [1, 1],
    ],
    busyDays: [6],
    quietShare: 0.5,
    max: 14,
    poses: new Set(['dance', 'talk', 'sit', 'idle']),
    bodies: 2,
    // Midnight after day 5's evening: night 5, the busy sixth day of the week.
    minute: at(6, 0),
    minutesPerDay: DAY,
    daysPerWeek: 7,
    open: true,
    seed: 'glowmatic',
    jitterM: 0.1,
    headingJitterRad: 0.3,
    heightM: { min: 1.6, max: 1.8 },
    palette: { skin: ['#111111'], tops: ['#222222'], bottoms: ['#333333'], accents: ['#444444'] },
    ...over,
  }
}

describe('venue crowd (S43)', () => {
  it('reads the hour share, nothing in hours it does not list', () => {
    const hours = input().hours
    expect(hourShare(hours, at(3, 22) + 30, DAY)).toBe(0.5)
    expect(hourShare(hours, at(3, 0), DAY)).toBe(1)
    expect(hourShare(hours, at(3, 13), DAY)).toBe(0)
  })

  it('keeps one night across midnight', () => {
    expect(nightOf(at(5, 23), DAY)).toBe(nightOf(at(6, 1), DAY))
    expect(nightOf(at(5, 23), DAY)).not.toBe(nightOf(at(6, 23), DAY))
  })

  it('is empty while closed', () => {
    expect(planCrowd(input({ open: false }))).toEqual([])
    expect(crowdSize(input({ open: false }), 2)).toBe(0)
  })

  it('is full on a busy night at its peak and thinner on a quiet one', () => {
    expect(planCrowd(input())).toHaveLength(14)
    expect(planCrowd(input({ busyDays: [] }))).toHaveLength(2 + Math.round(12 * 0.5))
    // Earlier in the evening fewer are in.
    expect(planCrowd(input({ minute: at(5, 22) }))).toHaveLength(2 + Math.round(12 * 0.5))
    expect(planCrowd(input({ minute: at(5, 13) }))).toHaveLength(2)
  })

  it('always has its staff while open, first', () => {
    const crowd = planCrowd(input({ minute: at(5, 22), max: 3, busyDays: [] }))
    expect(
      crowd
        .slice(0, 2)
        .map((member) => member.spot)
        .sort(),
    ).toEqual(['bartender', 'dj'])
  })

  it('is the same crowd for the same venue and night, and grows by keeping who is in', () => {
    const early = planCrowd(input({ minute: at(5, 22) }))
    expect(planCrowd(input({ minute: at(5, 22) }))).toEqual(early)
    const late = planCrowd(input({ minute: at(6, 0) }))
    for (const member of early) expect(late.map((entry) => entry.spot)).toContain(member.spot)
    expect(planCrowd(input({ seed: 'brickwave' })).map((m) => m.colors)).toHaveLength(14)
  })

  it('leaves out spots real players take and poses the tier does not draw', () => {
    const crowd = planCrowd(
      input({ poses: new Set(['dance', 'talk']), taken: new Set(['floor-0']) }),
    )
    const spots = crowd.map((member) => member.spot)
    expect(spots).not.toContain('floor-0')
    expect(spots).not.toContain('booth-0')
    // A standing idle local talks instead on a tier without the idle loop.
    expect(crowd.find((member) => member.spot === 'bartender')?.pose).toBe('talk')
  })

  it('lets a standing local at work stand instead when the tier draws neither work nor talk', () => {
    const spots = [
      spot('desk', { activity: 'front-desk', pose: 'work', rank: 0, staff: true }),
      spot('bench', { activity: 'rest', pose: 'sit', y: 0.45, rank: 1 }),
      spot('floor', { activity: 'dance', pose: 'dance', rank: 1 }),
    ]
    const crowd = planCrowd(input({ spots, poses: new Set(['idle', 'sit']) }))
    expect(crowd.find((member) => member.spot === 'desk')?.pose).toBe('idle')
    expect(crowd.find((member) => member.spot === 'bench')?.pose).toBe('sit')
    // A dancer has no stand-in.
    expect(crowd.map((member) => member.spot)).not.toContain('floor')
  })

  it('draws only the man on a one-body tier, at heights in range', () => {
    for (const member of planCrowd(input({ bodies: 1 }))) {
      expect(member.body).toBe(1)
      expect(member.heightM).toBeGreaterThanOrEqual(1.6)
      expect(member.heightM).toBeLessThanOrEqual(1.8)
    }
  })

  it('keeps seated locals and staff exactly on their spots', () => {
    const crowd = planCrowd(input())
    for (const member of crowd.filter((m) => m.y > 0 || m.spot === 'dj')) {
      const source = SPOTS.find((entry) => entry.id === member.spot)
      expect(member.x).toBe(source?.x)
      expect(member.z).toBe(source?.z)
    }
  })

  it('puts real players at a spot for their activity, else any standing spot', () => {
    const placed = placeOccupants(SPOTS, ['booth', 'booth', 'booth', 'chat'])
    expect(placed[0]?.activity).toBe('booth')
    expect(placed[1]?.activity).toBe('booth')
    expect(placed[2]?.y).toBe(0)
    expect(placed[3]?.id).toBe('chat-0')
    expect(new Set(placed.map((entry) => entry?.id)).size).toBe(4)
    expect(placed.some((entry) => entry?.staff === true)).toBe(false)
  })

  it('sends an activity to the spots the interior names for it, staff spots only when named', () => {
    const gym = [
      spot('desk', { activity: 'front-desk', pose: 'work', rank: 0, staff: true }),
      spot('tread-0', { activity: 'treadmill', pose: 'run', rank: 1 }),
      spot('rack-0', { activity: 'rack', pose: 'workout', rank: 1 }),
      spot('stretch', { activity: 'stretch', pose: 'idle', rank: 5 }),
    ]
    const players = { workout: ['treadmill', 'rack'], work: ['front-desk'] }
    expect(wantedSpots('workout', players)).toEqual(['treadmill', 'rack'])
    expect(wantedSpots('chat', players)).toEqual(['chat'])
    const placed = placeOccupants(gym, ['workout', 'workout', 'work', 'workout'], players)
    expect(placed.map((entry) => entry?.id)).toEqual(['tread-0', 'rack-0', 'desk', 'stretch'])
    // Unnamed, a staff spot stays the staff's even when its activity matches.
    expect(placeOccupants(gym, ['front-desk'])[0]?.id).toBe('tread-0')
  })
})
