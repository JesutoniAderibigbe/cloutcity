'use client'

import { engineConfig } from '@/engine/config'
import { isAtPlace } from '@/engine/game'
import { jobIds, jobLock, shiftWage } from '@/engine/jobs'
import { placeActions } from '@/engine/placeActions'
import { copy } from '@/lib/copy'
import { cloutLevelName, jobName } from '@/lib/economyCopy'
import { formatCount, formatMiles, formatMoney } from '@/lib/format'
import { boroughName, straightDistanceM } from '@/lib/phone/placeInfo'
import { formatDuration, placeHoursLine } from '@/lib/world/placeActionCopy'
import {
  boroughAccessFor,
  boroughClosedReason,
  gateClout,
  placeName,
  venues,
} from '@/lib/world/places'
import { openPlace } from '@/state/placeSheet'
import { useGameStore } from '@/state/store'
import { PHONE_PRIMARY, PHONE_SECONDARY } from './phoneUi'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/phone'

const MINUTES_PER_HOUR = 60

/**
 * The Jobs app (S58): every job with what a shift pays, how long it runs and the energy it costs
 * (the place's own action, so the player's traits are already in), and every place that hires
 * for it: its borough, opening hours now, how far it is and any lock, with "Get there", which
 * opens that place's sheet and its travel options (DEC-22). Working the shift happens there, as
 * always.
 */
export function JobsApp() {
  const clock = useGameStore((state) => state.clock)
  const player = useGameStore((state) => state.player)
  const snapshot = { clock, player }
  const clout = gateClout(player, engineConfig)

  return (
    <div data-cc-feature="cc-feature:phone-jobs" className="flex flex-col gap-3">
      <p className="text-sm text-muted">{copy('phone.jobs.intro')}</p>
      <ul className="flex flex-col gap-3">
        {jobIds(engineConfig).map((jobId) => {
          const name = jobName(jobId)
          const lock = jobLock(player, jobId, engineConfig)
          const sites = venues.filter(
            (venue) => 'jobIds' in venue && venue.jobIds?.includes(jobId) === true,
          )
          const energy = sites
            .map((venue) => {
              const view = placeActions(venue, snapshot, engineConfig)
              if (view.kind !== 'actions') return undefined
              const shift = view.actions.find(
                (action) => action.kind === 'shift' && action.jobId === jobId,
              )
              return shift?.def.energyCost
            })
            .find((cost) => cost !== undefined)
          return (
            <li
              key={jobId}
              data-phone-job={jobId}
              className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <h4 className="text-base font-extrabold text-fg">{name}</h4>
                  <p className="text-xs text-muted">
                    {copy('phone.jobs.details', {
                      hours: formatDuration(engineConfig.jobs.shiftHours * MINUTES_PER_HOUR),
                      energy: formatCount(energy ?? engineConfig.jobs.energyCostPerShift[jobId]),
                    })}
                  </p>
                </div>
                <p className="shrink-0 text-right text-sm font-extrabold text-success">
                  {copy('phone.jobs.perShift', {
                    pay: formatMoney(shiftWage(jobId, engineConfig)),
                  })}
                </p>
              </div>
              {lock === null ? null : (
                <p className="text-sm font-semibold text-taxi-ink">
                  {copy('phone.jobs.locked', {
                    level: cloutLevelName(lock.requiredLevel),
                    current: cloutLevelName(lock.currentLevel),
                  })}
                </p>
              )}
              {sites.length === 0 ? (
                <p className="text-sm text-muted">{copy('phone.jobs.nowhere')}</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {sites.map((venue) => {
                    const place = placeName(venue)
                    const view = placeActions(venue, snapshot, engineConfig)
                    const here = isAtPlace(player, venue.id)
                    const distance = straightDistanceM(player, venue.id)
                    const locked = boroughClosedReason(
                      venue.borough,
                      boroughAccessFor(venue.borough, clout),
                    )
                    return (
                      <li
                        key={venue.id}
                        className="flex items-center justify-between gap-2 rounded-xl bg-canvas p-2"
                      >
                        <div className="flex min-w-0 flex-col">
                          <span className="text-sm font-semibold text-fg">
                            {copy('phone.jobs.where', {
                              place,
                              borough: boroughName(venue.borough),
                            })}
                          </span>
                          <span className="text-xs text-muted">
                            {[
                              view.kind === 'actions' ? placeHoursLine(view.hours) : null,
                              here
                                ? copy('phone.shop.here')
                                : distance === null
                                  ? null
                                  : copy('phone.shop.distance', {
                                      distance: formatMiles(distance),
                                    }),
                            ]
                              .filter((part) => part !== null)
                              .join(' · ')}
                          </span>
                          {locked === null ? null : (
                            <span className="text-xs font-semibold text-taxi-ink">{locked}</span>
                          )}
                        </div>
                        <button
                          type="button"
                          data-phone-get-there={venue.id}
                          onClick={() => openPlace(venue.id, { origin: 'panel' })}
                          aria-label={copy(
                            here ? 'phone.jobs.workHereLabel' : 'phone.jobs.getThereLabel',
                            { place, job: name },
                          )}
                          className={here ? PHONE_SECONDARY : PHONE_PRIMARY}
                        >
                          {copy(here ? 'phone.jobs.workHere' : 'phone.jobs.getThere')}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
