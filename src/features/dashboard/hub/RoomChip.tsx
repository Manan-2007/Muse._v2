import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

import type { Room } from '@/features/rooms/api'
import { roomStyle } from '@/features/rooms/roomStyle'

/**
 * Which room you are standing in, at the bottom of the hub.
 *
 * The invite link is the room's whole social mechanic, so it is on screen
 * rather than behind a menu — copying it should never cost a click of hunting.
 */
export function RoomChip({ room }: { room: Room }) {
  const art = roomStyle(room.type)
  const [copied, setCopied] = useState(false)

  const invite = `${window.location.origin}/r/${room.slug}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(invite)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* Clipboard is permission-gated and blocked outright in some embeds.
         Leaving the code visible means it can still be read off the screen. */
    }
  }

  return (
    /*
     * Bounded to the viewport, and tighter on a phone.
     *
     * The room name and the slug are both arbitrary-length strings, so at a
     * natural width this chip simply grew past a narrow screen and took the
     * copy button off the edge with it — the one control that carries the
     * room's whole social mechanic. Capping the chip and letting both strings
     * truncate keeps the button on screen at any name length.
     */
    <div className="glass-pill-ink pointer-events-auto flex min-w-0 max-w-full items-center gap-2.5 rounded-full py-2 pl-3 pr-2 sm:gap-4 sm:pl-4">
      <span className="flex min-w-0 flex-1 items-center gap-2.5 sm:flex-none">
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundImage: `linear-gradient(150deg, ${art.glow}, ${art.from})` }}
        />
        <span className="min-w-0">
          <span className="block truncate font-display text-[0.9rem] font-semibold tracking-[-0.015em] text-chalk">
            {room.name}
          </span>
          <span className="block text-[0.68rem] uppercase tracking-[0.16em] text-dusk">
            {art.name}
          </span>
        </span>
      </span>

      <span aria-hidden className="hidden h-8 w-px shrink-0 bg-white/10 lg:block" />

      <button
        type="button"
        onClick={copy}
        className="hidden min-w-0 shrink items-center gap-2 rounded-full px-2 py-2 text-left outline-none transition-colors duration-300 hover:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal lg:flex lg:shrink-0 lg:px-3"
      >
        <span className="min-w-0">
          <span className="block text-[0.62rem] uppercase tracking-[0.18em] text-dusk">
            Room code
          </span>
          <span className="block truncate font-mono text-[0.8rem] text-chalk">{room.slug}</span>
        </span>
        {copied ? (
          <Check aria-hidden className="size-4 shrink-0 text-emerald-400" />
        ) : (
          <Copy aria-hidden className="size-4 shrink-0 text-mist" />
        )}
        <span className="sr-only">{copied ? 'Invite link copied' : 'Copy invite link'}</span>
      </button>
    </div>
  )
}
