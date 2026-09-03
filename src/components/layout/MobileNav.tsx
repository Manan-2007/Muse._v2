import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Menu, X } from 'lucide-react'

import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'

/**
 * The section links, on a phone.
 *
 * The dock they live in on a wide screen is pointer-driven — items swell as
 * the cursor nears them — which is meaningless on a touch screen, so below
 * `md` it is hidden entirely. That left the landing page's own chapters
 * unreachable on the device most people would open it on: the links were not
 * collapsed into anything, they were simply gone.
 *
 * A sheet rather than a full-screen overlay. There are three links; taking
 * over the whole viewport to show three links reads as a much bigger
 * navigation than this actually is.
 */
export function MobileNav({ links }: { links: { label: string; href: string }[] }) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState({ top: 0, left: 0 })
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const reduced = usePrefersReducedMotion()

  /* Escape, and a tap anywhere off the sheet, both close it — the two things
     a person tries first when they want out of a menu. */
  useEffect(() => {
    if (!open) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false)
    }

    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  if (links.length === 0) return null

  return (
    <div className="relative md:hidden">
      <button
        ref={trigger}
        type="button"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => {
          const box = trigger.current?.getBoundingClientRect()
          if (box) setAnchor({ top: box.bottom + 10, left: box.left })
          setOpen((value) => !value)
        }}
        /* 44px square: the smallest a target can be before thumbs start
           missing it, and the size the rest of this bar now matches. */
        className="grid size-11 place-items-center rounded-full text-mist transition-colors duration-200 hover:text-chalk active:text-chalk"
      >
        <motion.span
          key={open ? 'close' : 'menu'}
          initial={reduced ? false : { rotate: -90, opacity: 0 }}
          animate={{ rotate: 0, opacity: 1 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="grid place-items-center"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </motion.span>
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
          <motion.div
            ref={panel}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            /* Anchored under the button and pinned to its left edge, so it
               opens where the thumb already is instead of from the far side
               of the bar. */
            style={{ top: anchor.top, left: anchor.left }}
            /*
             * Portalled to the body and positioned from the trigger's own
             * box. The header pill clips its children — it has to, so its
             * glass fill stays inside the rounded edge — and a sheet rendered
             * inside it was simply invisible.
             */
            className="fixed z-[140] min-w-[11rem] origin-top-left overflow-hidden rounded-2xl border border-white/12 bg-[rgb(14_14_18/0.94)] p-1.5 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.9)] backdrop-blur-2xl backdrop-saturate-150"
          >
            {links.map((link, index) => (
              <motion.a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                initial={reduced ? false : { opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: reduced ? 0 : 0.04 + index * 0.045, duration: 0.2 }}
                className="flex h-11 items-center rounded-xl px-3.5 text-[0.95rem] text-mist transition-colors duration-200 hover:bg-white/[0.07] hover:text-chalk active:bg-white/10"
              >
                {link.label}
              </motion.a>
            ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}
