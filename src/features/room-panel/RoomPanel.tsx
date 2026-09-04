import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { PanelRightClose } from 'lucide-react'

import { CallSection } from '@/features/room-panel/CallSection'
import { ChatSection } from '@/features/room-panel/ChatSection'
import type { useChat } from '@/features/room-panel/useChat'
import type { useMeshCall } from '@/features/room-panel/useMeshCall'

/** Kept in one place — the hub and the watch stage both inset by exactly this. */
export const PANEL_WIDTH_REM = 21

const EASE = [0.16, 1, 0.3, 1] as const

/**
 * Call and chat, in one column down the right edge.
 *
 * One panel rather than two, because they are the same activity: you talk while
 * you watch. Call on top because faces are glanceable and chat below because it
 * is the part you actually read — and the whole thing insets the rest of the
 * app rather than floating over it, so nothing important ends up underneath.
 */
export function RoomPanel({
  chat,
  call,
  roomName,
  here,
  poppedOut,
  onPopOut,
  selfId,
  selfName,
  onClose,
}: {
  chat: ReturnType<typeof useChat>
  call: ReturnType<typeof useMeshCall>
  roomName: string
  /** How many people are in the room right now, for the header's live count. */
  here: number
  poppedOut: string | null
  onPopOut: (who: string | null) => void
  selfId: string | undefined
  selfName: string
  onClose: () => void
}) {
  const { setWatching } = chat

  /* Open means read. Anything arriving now is on screen, so it should never
     land in the unread count. */
  useEffect(() => {
    setWatching(true)
    return () => setWatching(false)
  }, [setWatching])

  return createPortal(
    <motion.aside
      /* Above the watch stage (135) so it stays usable while watching, below
         the hub's modal drawers (140), which are meant to take over. */
      className="fixed inset-y-0 right-0 z-[138] flex w-full flex-col border-l border-white/[0.08] bg-abyss sm:w-[21rem]"
      /* Full width on a phone — a sliver of the screen behind is worse than a
         clean takeover — and its own 21rem column once there is room to sit
         beside the app. `PANEL_WIDTH_REM` keeps that in step with the inset the
         hub reserves for it. */
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ duration: 0.45, ease: EASE }}
    >
      <header className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className="size-1.5 shrink-0 animate-signal-pulse rounded-full bg-signal" />
          <div className="min-w-0">
            <h2 className="truncate font-display text-[0.95rem] font-semibold tracking-[-0.015em] text-chalk">
              {roomName}
            </h2>
            <p className="text-[0.66rem] uppercase tracking-[0.16em] text-dusk">
              {here <= 1 ? 'Just you' : `${here} here`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="grid size-8 shrink-0 place-items-center rounded-full text-mist outline-none transition-colors hover:bg-white/10 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <PanelRightClose aria-hidden className="size-4" />
        </button>
      </header>

      <CallSection
        call={call}
        selfName={selfName}
        poppedOut={poppedOut}
        onPopOut={onPopOut}
      />

      <ChatSection
        messages={chat.messages}
        typing={chat.typing}
        selfId={selfId}
        onSend={chat.send}
        onType={chat.noteTyping}
      />
    </motion.aside>,
    document.body,
  )
}
