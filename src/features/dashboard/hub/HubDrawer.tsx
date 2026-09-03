import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'

const EASE = [0.16, 1, 0.3, 1] as const

/**
 * The hub's one scrolling surface.
 *
 * The hub itself is a fixed single screen — nothing about a control room should
 * imply there is more of it below the fold. Anything with real depth (a room
 * list, settings, chat history) lives in here instead, so scrolling happens in
 * a panel that is obviously a panel.
 */
export function HubDrawer({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /*
   * Portalled to the body, not rendered in place.
   *
   * The hub fades itself in with Framer, which leaves a `will-change` on its
   * root — enough to make it a stacking context and trap every descendant's
   * z-index below the fixed header. A panel that must cover the header cannot
   * live inside it, so it doesn't.
   */
  return createPortal(
    <div className="pointer-events-auto fixed inset-0 z-[140] flex justify-end">
      <motion.button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-void/55 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.35, ease: EASE }}
      />

      <motion.aside
        role="dialog"
        aria-label={title}
        className="glass-panel relative flex h-full w-full max-w-[27rem] flex-col rounded-l-panel"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <header className="flex items-start gap-4 border-b border-white/[0.08] px-6 py-5">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl font-semibold tracking-[-0.02em] text-chalk">
              {title}
            </h2>
            {subtitle && <p className="mt-1 text-[0.82rem] leading-relaxed text-mist">{subtitle}</p>}
          </div>
          <Button variant="outline" size="icon" onClick={onClose} aria-label="Close" plain>
            <X aria-hidden />
          </Button>
        </header>

        {/* Lenis owns the wheel for the whole document, so a nested scroller
            has to opt out explicitly or the panel simply never scrolls. */}
        <div data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {children}
        </div>
      </motion.aside>
    </div>,
    document.body,
  )
}
