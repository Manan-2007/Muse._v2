import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Check, Monitor, Moon, Sun } from 'lucide-react'

import { ACCENTS, type StudyPreferences, type ThemeChoice } from '@/features/study/useStudyPreferences'
import { cn } from '@/lib/utils'

const THEMES: [ThemeChoice, string, typeof Sun][] = [
  ['light', 'Light', Sun],
  ['dark', 'Dark', Moon],
  ['system', 'Auto', Monitor],
]

/** The swatch colours, matching the accent rules in the stylesheet. */
const SWATCH: Record<string, string> = {
  crimson: '#ff3b30',
  amber: '#f5a524',
  emerald: '#10b981',
  violet: '#a78bfa',
  blue: '#60a5fa',
}

/**
 * How the tab looks, and nothing else.
 *
 * Deliberately three controls. A settings panel that grows past what fits on
 * screen at once stops being a way to adjust the page and becomes a second
 * page to read, and none of the things people actually asked for here need
 * more than this.
 */
export function StudySettings({
  preferences,
  update,
  onClose,
}: {
  preferences: StudyPreferences
  update: (patch: Partial<StudyPreferences>) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  /* Closes on a click anywhere else and on Escape — a popover that can only
     be dismissed by finding its own button again is a trap. */
  useEffect(() => {
    const away = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    /* Deferred a tick so the click that opened this does not immediately
       close it again. */
    const timer = window.setTimeout(() => document.addEventListener('mousedown', away), 0)
    document.addEventListener('keydown', key)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [onClose])

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: 0.18 }}
      role="dialog"
      aria-label="Study appearance"
      className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-64 rounded-[1rem] border border-[var(--study-line)] bg-[var(--study-bg-soft)] p-3 shadow-xl"
    >
      <p className="px-1 text-[0.7rem] uppercase tracking-[0.08em] text-[var(--study-faint)]">
        Background
      </p>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {THEMES.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => update({ theme: id })}
            aria-pressed={preferences.theme === id}
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-[0.7rem] border py-2.5 text-[0.72rem] transition-colors',
              preferences.theme === id
                ? 'border-[var(--study-accent)] bg-[var(--study-accent-soft)]'
                : 'border-[var(--study-line)] hover:bg-[var(--study-card)]',
            )}
          >
            <Icon aria-hidden className="size-4" />
            {label}
          </button>
        ))}
      </div>

      <p className="mt-4 px-1 text-[0.7rem] uppercase tracking-[0.08em] text-[var(--study-faint)]">
        Accent
      </p>
      <div className="mt-2 flex gap-2 px-1">
        {ACCENTS.map((accent) => (
          <button
            key={accent}
            type="button"
            onClick={() => update({ accent })}
            aria-label={accent}
            aria-pressed={preferences.accent === accent}
            className="grid size-7 place-items-center rounded-full transition-transform hover:scale-110"
            style={{ background: SWATCH[accent] }}
          >
            {preferences.accent === accent && (
              <Check aria-hidden className="size-3.5 text-white" strokeWidth={3} />
            )}
          </button>
        ))}
      </div>

      <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-[0.7rem] px-1 py-1.5">
        <span className="text-[0.8rem]">Larger text</span>
        <input
          type="checkbox"
          checked={preferences.roomy}
          onChange={(event) => update({ roomy: event.target.checked })}
          className="sr-only"
        />
        <span
          aria-hidden
          className={cn(
            'relative h-5 w-9 shrink-0 rounded-full transition-colors',
            preferences.roomy ? 'bg-[var(--study-accent)]' : 'bg-[var(--study-card-strong)]',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 size-4 rounded-full bg-white transition-all',
              preferences.roomy ? 'left-[1.125rem]' : 'left-0.5',
            )}
          />
        </span>
      </label>
    </motion.div>
  )
}
