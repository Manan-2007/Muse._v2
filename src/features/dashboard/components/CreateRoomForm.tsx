import { useState, type FormEvent } from 'react'
import { Globe, Lock } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { Room, RoomVisibility } from '@/features/rooms/api'
import { ROOM_TYPE_OPTIONS, roomStyle } from '@/features/rooms/roomStyle'
import { cn } from '@/lib/utils'

const VISIBILITY_OPTIONS = [
  {
    value: 'private' as const,
    label: 'Private',
    hint: 'Listed to nobody. The room code is the only way in.',
    icon: Lock,
  },
  {
    value: 'open' as const,
    label: 'Open',
    hint: 'Shows up in Discover. Anyone signed in can walk in.',
    icon: Globe,
  },
]

type CreateRoomFormProps = {
  onCreate: (input: { name: string; type: string; visibility: RoomVisibility }) => Promise<Room>
}

export function CreateRoomForm({ onCreate }: CreateRoomFormProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState<string>('friends')
  /* Closed unless it is chosen otherwise — the safe direction for a default. */
  const [visibility, setVisibility] = useState<RoomVisibility>('private')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return

    setBusy(true)
    setError(null)
    try {
      await onCreate({ name: name.trim(), type, visibility })
      setName('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the room')
    } finally {
      setBusy(false)
    }
  }

  return (
    /*
     * No heading and no panel of its own.
     *
     * This is only ever rendered inside the hub drawer, which already draws
     * the glass, the padding, and a header carrying this exact title — so
     * repeating them stacked the same sentence twice down the screen and put
     * a card inside a card. Obvious on a phone, where the two sat directly on
     * top of each other with nothing between them.
     */
    <form onSubmit={handleSubmit}>
      <p className="text-[0.9rem] leading-relaxed text-mist">
        Pick a type and Huddle sets the mood. You can change it later.
      </p>

      <fieldset className="mt-6">
        <legend className="sr-only">Room type</legend>
        <div className="flex flex-wrap gap-2">
          {ROOM_TYPE_OPTIONS.map((option) => {
            const art = roomStyle(option.value)
            const selected = type === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setType(option.value)}
                aria-pressed={selected}
                className={cn(
                  'flex items-center gap-2 rounded-full border px-3.5 py-2 text-[0.82rem] transition-all duration-300',
                  selected
                    ? 'border-signal/60 bg-white/[0.07] text-chalk'
                    : 'border-white/[0.08] bg-white/[0.02] text-mist hover:border-white/20 hover:text-chalk',
                )}
              >
                <span
                  className="size-3 rounded-full"
                  style={{ backgroundImage: `linear-gradient(150deg, ${art.glow}, ${art.from})` }}
                />
                {option.label}
              </button>
            )
          })}
        </div>
      </fieldset>

      {/*
        Two real options rather than a checkbox, because "Private" is not the
        absence of something — it is a working way in, by code. Each carries
        the consequence under it, so the choice can be made without having to
        already know what either word means here.
      */}
      <fieldset className="mt-6">
        <legend className="text-[0.78rem] uppercase tracking-[0.16em] text-dusk">
          Who can join
        </legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {VISIBILITY_OPTIONS.map((option) => {
            const selected = visibility === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setVisibility(option.value)}
                aria-pressed={selected}
                className={cn(
                  'flex items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-left transition-all duration-300',
                  selected
                    ? 'border-signal/60 bg-white/[0.07]'
                    : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20',
                )}
              >
                <option.icon
                  aria-hidden
                  className={cn('mt-0.5 size-4 shrink-0', selected ? 'text-chalk' : 'text-mist')}
                />
                <span className="min-w-0">
                  <span
                    className={cn(
                      'block text-[0.85rem] font-medium',
                      selected ? 'text-chalk' : 'text-mist',
                    )}
                  >
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-[0.74rem] leading-relaxed text-dusk">
                    {option.hint}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <label className="flex-1">
          <span className="sr-only">Room name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Movie night"
            maxLength={48}
            required
            className="w-full rounded-full border border-white/[0.1] bg-white/[0.04] px-5 py-3 text-[0.92rem] text-chalk outline-none transition-colors placeholder:text-dusk focus:border-signal/50"
          />
        </label>
        <Button type="submit" size="lg" disabled={busy || name.trim().length === 0}>
          {busy ? 'Creating…' : 'Create room'}
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-[0.85rem] text-signal-bright">
          {error}
        </p>
      )}
    </form>
  )
}
