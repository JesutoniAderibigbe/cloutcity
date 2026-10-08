'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import swatchesJson from '@data/avatar/swatches.derived.json'
import { useActionGuard } from '@/components/overlay/useActionGuard'
import { publicAvatar, type Look, type LookField } from '@/engine/appearance'
import { creatorConfig } from '@/engine/creatorConfig'
import { copy } from '@/lib/copy'
import { optionName } from '@/lib/creatorCopy'
import {
  FIELD_LEGEND,
  LOOK_CATEGORIES,
  hairHiddenBy,
  lookChoices,
  withChoice,
  type LookChoice,
} from '@/lib/creatorLook'
import { creatorActions } from '@/state/creatorActions'
import { useActiveTier } from '@/state/quality'
import { useGameStore } from '@/state/store'
import { CREATOR_BUTTON, MOVE_ON, type StepProps } from '../stepTypes'

// Its own lazy chunk (marker `preview-avatar`, PERF-7): the look runtime and a second canvas.
const AvatarPreviewCanvas = dynamic(() => import('@/scene/avatar/AvatarPreviewCanvas'), {
  ssr: false,
})

const options = creatorConfig.options
const swatchHex: Readonly<Record<string, string>> = swatchesJson.colors

const sameLook = (a: Look, b: Look) =>
  (Object.keys(a) as LookField[]).every((field) => a[field] === b[field])

const nameOf = (field: LookField, look: Look) => {
  const choice = lookChoices(field, look, options).find((option) => option.id === look[field])
  return choice === undefined ? '' : optionName(choice.nameKey)
}

/** The look in words, every colour named: the preview's text fallback (A11Y-3). */
function lookSummary(look: Look): string {
  return copy('creator.look.summary', {
    hairStyle: nameOf('hairStyle', look),
    hairColor: nameOf('hairColor', look),
    skin: nameOf('skin', look),
    outfit: nameOf('outfit', look),
    top: nameOf('top', look),
    bottom: nameOf('bottom', look),
    shoes: nameOf('shoes', look),
  })
}

function Choice({
  field,
  choice,
  checked,
  onPick,
}: {
  readonly field: LookField
  readonly choice: LookChoice
  readonly checked: boolean
  readonly onPick: () => void
}) {
  const name = optionName(choice.nameKey)
  const input = {
    type: 'radio' as const,
    name: `creator-look-${field}`,
    value: choice.id,
    checked,
    onChange: onPick,
    'data-look-choice': `${field}:${choice.id}`,
  }
  if (choice.token !== undefined) {
    // A swatch: the native radio itself, painted in its colour and named in words (A11Y-1).
    return (
      <input
        {...input}
        aria-label={name}
        style={{ backgroundColor: swatchHex[choice.token] }}
        className="h-11 w-11 cursor-pointer appearance-none rounded-full border-2 border-line checked:border-fg checked:ring-2 checked:ring-taxi checked:ring-offset-2 checked:ring-offset-canvas focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
      />
    )
  }
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-raised px-3 py-2 text-sm text-fg has-[:checked]:ring-2 has-[:checked]:ring-taxi has-[:checked]:ring-inset has-[:checked]:font-semibold">
      <input {...input} className="h-5 w-5 shrink-0 accent-taxi-ink" />
      {name}
    </label>
  )
}

/**
 * The Look step (S16a, D2–D8, GR-12): a live preview over the categories Hair, Facial hair,
 * Accessories (head coverings, eyewear, ears), Skin and Outfit (with top, bottom and shoe colours
 * and height), each field a group of native radios built from the options data, every swatch
 * named. "Surprise me" draws a whole new look to try. Nothing is saved until Next.
 */
export default function LookStep({ bind }: StepProps) {
  const player = useGameStore((state) => state.player)
  const tier = useActiveTier() ?? 'low'
  const [draft, setDraft] = useState<Look>(player.look)
  // What Next saves, kept current by the change handlers (see DreamStep).
  const chosen = useRef<Look>(player.look)
  const [note, setNote] = useState<string | null>(null)
  const { guard, onKeyDown, onPointerDown } = useActionGuard()
  const worn = useMemo(() => publicAvatar(player).worn, [player])
  const hiddenBy = hairHiddenBy(draft, options)

  useEffect(() => {
    bind({
      ready: true,
      commit: () => {
        const draft = chosen.current
        if (sameLook(draft, player.look)) return MOVE_ON
        const result = creatorActions().chooseLook(draft)
        return result.ok
          ? { ok: true, saved: copy('creator.look.saved') }
          : { ok: false, error: copy('creator.error.failed') }
      },
    })
  }, [bind, player.look])

  const update = (look: Look) => {
    chosen.current = look
    setDraft(look)
  }

  const pick = (field: LookField, value: string) => {
    setNote(null)
    update(withChoice(chosen.current, field, value, options))
  }

  const surprise = () => {
    update(creatorActions().surpriseLook())
    setNote(copy('creator.look.surprised'))
  }

  return (
    <section
      data-creator-look=""
      className="flex flex-col gap-3 lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-5"
    >
      {/* S04p: the preview is the hero, as in Lagos Life's creator: the full card width on a
          phone, and the full height of a left column on a wide screen, the choices scrolling
          beside it. */}
      <div className="flex flex-col gap-2 lg:min-h-0">
        <div
          data-creator-preview=""
          className="relative h-[min(34svh,20rem)] w-full shrink-0 overflow-hidden rounded-2xl bg-canvas lg:h-auto lg:min-h-0 lg:flex-1"
        >
          <AvatarPreviewCanvas
            avatar={{ look: draft, worn }}
            tier={tier}
            label={copy('creator.look.preview')}
            fallback={<p className="p-2 text-sm text-fg">{lookSummary(draft)}</p>}
          />
          <button
            type="button"
            data-creator-surprise=""
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onClick={(event) => guard(event, 'surprise', surprise)}
            className={`${CREATOR_BUTTON} absolute right-3 bottom-3 glass text-fg shadow-md`}
          >
            {copy('creator.look.surprise')}
          </button>
          <p
            aria-live="polite"
            className="pointer-events-none absolute top-3 left-3 max-w-[calc(100%-1.5rem)] text-sm font-semibold text-taxi-ink"
          >
            {note}
          </p>
        </div>
        <p className="sr-only">{lookSummary(draft)}</p>
      </div>

      <div className="flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
        <p className="text-sm text-muted">{copy('creator.look.intro')}</p>
        {LOOK_CATEGORIES.map((category) => (
          <section
            key={category.id}
            data-look-category={category.id}
            aria-labelledby={`creator-look-${category.id}`}
            className="flex flex-col gap-2"
          >
            <h3
              id={`creator-look-${category.id}`}
              className="text-xs font-bold text-muted uppercase"
            >
              {copy(category.titleKey)}
            </h3>
            {category.fields.map((field) => {
              const choices = lookChoices(field, draft, options)
              const swatch = choices.some((choice) => choice.token !== undefined)
              return (
                <fieldset key={field} className="flex flex-col gap-1.5">
                  <legend className="text-sm font-semibold text-fg">
                    {copy(FIELD_LEGEND[field])}
                    {swatch ? (
                      <span className="font-normal text-muted">: {nameOf(field, draft)}</span>
                    ) : null}
                  </legend>
                  {field === 'hairStyle' && hiddenBy !== undefined ? (
                    <p className="text-xs text-muted">
                      {copy('creator.look.hairHidden', { headwear: optionName(hiddenBy.nameKey) })}
                    </p>
                  ) : null}
                  <div className={`flex flex-wrap ${swatch ? 'gap-2.5 p-1' : 'gap-1.5'}`}>
                    {choices.map((choice) => (
                      <Choice
                        key={choice.id}
                        field={field}
                        choice={choice}
                        checked={draft[field] === choice.id}
                        onPick={() => pick(field, choice.id)}
                      />
                    ))}
                  </div>
                </fieldset>
              )
            })}
          </section>
        ))}
      </div>
    </section>
  )
}
