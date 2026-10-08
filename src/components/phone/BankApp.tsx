'use client'

import { calendar } from '@/engine/clock'
import { engineConfig } from '@/engine/config'
import { nextRentDueDay, rentFor } from '@/engine/rent'
import { copy } from '@/lib/copy'
import { homeName, rentNotice } from '@/lib/economyCopy'
import { formatCount, formatGameTime, formatMoney } from '@/lib/format'
import { goalName } from '@/lib/goalsCopy'
import { useGameStore } from '@/state/store'
import { LaterCard, PhoneCard } from './phoneUi'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/phone'

/** "Day 3, 8:00 PM" for a personal-clock minute. */
function whenLine(minute: number): string {
  const { day, minuteOfDay } = calendar(minute, engineConfig)
  return copy('phone.bank.history.when', {
    day: formatCount(day),
    time: formatGameTime(minuteOfDay),
  })
}

/**
 * The Bank app (S58, S43 lite), read-only: the cash balance, the weekly bill (rent for the
 * current home, its due day and anything overdue) and the money history the save keeps, which
 * today is the goal rewards in the grant log. Paychecks and purchases are not recorded yet, so
 * a card says the full statement comes later instead of guessing one (UX-3). No loans, no
 * savings: those come later too.
 */
export function BankApp() {
  const cash = useGameStore((state) => state.player.cash)
  const home = useGameStore((state) => state.player.home)
  const owed = useGameStore((state) => state.player.rent.owed)
  const minute = useGameStore((state) => state.clock.minute)
  const log = useGameStore((state) => state.grants.log)
  const lastRentEvent = useGameStore((state) => state.lastRentEvent)

  const rent = rentFor(home, engineConfig)
  const dueDay = nextRentDueDay(minute, engineConfig)
  const daysLeft = dueDay - calendar(minute, engineConfig).day
  const rewards = log.filter((record) => record.applied.cash > 0).sort((a, b) => b.seq - a.seq)

  return (
    <div data-cc-feature="cc-feature:phone-bank" className="flex flex-col gap-3">
      <PhoneCard title={copy('phone.bank.balance')} tone="accent">
        <p data-bank-balance="" className="text-4xl leading-none font-extrabold">
          {formatMoney(cash)}
        </p>
        <p className="text-sm font-semibold">{copy('phone.bank.cashNote')}</p>
      </PhoneCard>

      <PhoneCard title={copy('phone.bank.bills.heading')}>
        <div data-bank-bill="rent" className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <span className="font-bold">
              {copy('phone.bank.bills.rent', { home: homeName(home) })}
            </span>
            <span className="text-sm text-muted">
              {daysLeft === 1
                ? copy('phone.bank.bills.dueOne', { day: formatCount(dueDay) })
                : copy('phone.bank.bills.dueMany', {
                    day: formatCount(dueDay),
                    days: formatCount(daysLeft),
                  })}
            </span>
          </div>
          <span className="shrink-0 text-right font-extrabold">
            {copy('phone.bank.bills.perWeek', { amount: formatMoney(rent) })}
          </span>
        </div>
        <p
          data-bank-owed=""
          className={`text-sm font-semibold ${owed > 0 ? 'text-danger' : 'text-success'}`}
        >
          {owed > 0
            ? copy('phone.bank.bills.owed', { owed: formatMoney(owed) })
            : copy('phone.bank.bills.square')}
        </p>
        {cash < rent ? (
          <p className="text-sm text-taxi-ink">
            {copy('phone.bank.bills.short', { short: formatMoney(rent - cash) })}
          </p>
        ) : null}
        {lastRentEvent === null ? null : (
          <p className="rounded-xl bg-canvas p-2 text-sm">
            <span className="block text-xs font-bold text-muted uppercase">
              {copy('phone.bank.lastNotice')}
            </span>
            {rentNotice(lastRentEvent)}
          </p>
        )}
      </PhoneCard>

      <PhoneCard title={copy('phone.bank.history.heading')}>
        {rewards.length === 0 ? (
          <p className="text-sm text-muted">{copy('phone.bank.history.none')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {rewards.map((record) => (
              <li
                key={record.seq}
                data-bank-entry={record.key}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold">
                    {copy('phone.bank.history.grant', {
                      goal: goalName(record.eligibility.goalId),
                    })}
                  </span>
                  <span className="text-xs text-muted">{whenLine(record.at)}</span>
                </span>
                <span className="shrink-0 font-extrabold text-success">
                  {copy('phone.bank.history.amount', { amount: formatMoney(record.applied.cash) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PhoneCard>

      <LaterCard
        title={copy('phone.bank.history.laterTitle')}
        body={copy('phone.bank.history.laterBody')}
      />
      <LaterCard title={copy('phone.bank.savings.title')} body={copy('phone.bank.savings.body')} />
    </div>
  )
}
