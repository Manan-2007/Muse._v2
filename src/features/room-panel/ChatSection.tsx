import { useEffect, useRef, useState, type FormEvent } from 'react'
import { SendHorizonal } from 'lucide-react'

import type { ChatMessage } from '@/features/room-panel/useChat'
import { cn } from '@/lib/utils'

function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** Consecutive messages from one person read as one turn, not five cards. */
function startsGroup(message: ChatMessage, previous: ChatMessage | undefined) {
  if (!previous || previous.author.id !== message.author.id) return true
  const gap = new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime()
  return gap > 4 * 60 * 1000
}

export function ChatSection({
  messages,
  typing,
  selfId,
  onSend,
  onType,
}: {
  messages: ChatMessage[]
  typing: string[]
  selfId: string | undefined
  onSend: (body: string) => void
  onType: () => void
}) {
  const [draft, setDraft] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  /*
   * Follow new messages only when already at the bottom. Yanking someone back
   * down while they are reading history is the classic chat annoyance.
   */
  useEffect(() => {
    if (pinned.current && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight
    }
  }, [messages, typing])

  function submit(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    onSend(text)
    setDraft('')
    pinned.current = true
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        data-lenis-prevent
        onScroll={(event) => {
          const el = event.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
      >
        {messages.length === 0 ? (
          <p className="px-1 py-8 text-center text-[0.8rem] leading-relaxed text-mist">
            No messages yet. Say something — everyone in the room sees it.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {messages.map((message, index) => {
              const mine = message.author.id === selfId
              const fresh = startsGroup(message, messages[index - 1])

              return (
                <li
                  key={message.id}
                  className={cn('flex flex-col', mine ? 'items-end' : 'items-start', fresh && 'mt-2.5')}
                >
                  {fresh && (
                    <span className="mb-1 flex items-baseline gap-2 px-1">
                      <span className="text-[0.72rem] font-semibold text-chalk">
                        {mine ? 'You' : message.author.name}
                      </span>
                      <span className="text-[0.62rem] text-dusk">{clockTime(message.createdAt)}</span>
                    </span>
                  )}
                  <span
                    className={cn(
                      'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[0.82rem] leading-relaxed',
                      mine
                        ? 'bg-signal/20 text-chalk ring-1 ring-inset ring-signal/25'
                        : 'bg-white/[0.06] text-chalk ring-1 ring-inset ring-white/[0.07]',
                    )}
                  >
                    {message.body}
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        {typing.length > 0 && (
          <p className="mt-2 px-1 text-[0.72rem] italic text-dusk">
            {typing.length === 1 ? `${typing[0]} is typing…` : `${typing.length} people are typing…`}
          </p>
        )}
      </div>

      <form onSubmit={submit} className="flex gap-2 border-t border-white/[0.07] p-3">
        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            onType()
          }}
          placeholder="Message the room"
          maxLength={2000}
          className="min-w-0 flex-1 rounded-full border border-white/[0.1] bg-white/[0.04] px-4 py-2.5 text-[0.82rem] text-chalk outline-none transition-colors placeholder:text-dusk focus:border-signal/50"
        />
        <button
          type="submit"
          disabled={draft.trim().length === 0}
          aria-label="Send"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-chalk text-void outline-none transition-transform duration-300 hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal active:scale-95 disabled:opacity-35"
        >
          <SendHorizonal aria-hidden className="size-4" />
        </button>
      </form>
    </div>
  )
}
