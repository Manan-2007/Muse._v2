import { createPortal } from 'react-dom'
import { RotateCcw, TriangleAlert, X } from 'lucide-react'

/**
 * What a broken screen looks like.
 *
 * Exists so that a failure is a thing you can leave rather than a black page
 * you have to reload out of. Offers the two responses that are ever useful:
 * try it again, or go back to the room — which is still connected, and whose
 * music may well still be playing.
 */
export function StageFailed({
  title,
  onRetry,
  onClose,
}: {
  title: string
  onRetry: () => void
  onClose: () => void
}) {
  return createPortal(
    <div className="fixed left-0 top-0 z-[135] grid h-[100dvh] w-screen place-items-center bg-void/95 p-6 backdrop-blur-xl">
      <div className="flex max-w-sm flex-col items-center text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-signal/15 text-signal-bright ring-1 ring-inset ring-signal/30">
          <TriangleAlert aria-hidden className="size-5" />
        </span>

        <h2 className="mt-5 font-display text-[1.3rem] font-semibold tracking-[-0.02em] text-chalk">
          {title}
        </h2>
        <p className="mt-2 text-[0.88rem] leading-relaxed text-mist">
          The room is still here, and so is everyone in it. Try again, or go back and carry on.
        </p>

        <div className="mt-6 flex items-center gap-2.5">
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-2 rounded-full bg-chalk px-4 py-2.5 text-[0.85rem] font-medium text-void outline-none transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-signal"
          >
            <RotateCcw aria-hidden className="size-4" />
            Try again
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-2 rounded-full border border-white/12 px-4 py-2.5 text-[0.85rem] text-chalk outline-none transition-colors hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            <X aria-hidden className="size-4" />
            Back to the room
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
