import { useRef } from 'react'
import { motion, useScroll, useSpring, useTransform } from 'framer-motion'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { DockNav } from '@/components/layout/DockNav'
import { Logo } from '@/components/layout/Logo'
import { MobileNav } from '@/components/layout/MobileNav'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/AuthContext'
import { useEntrance } from '@/features/transition/EntranceContext'
import { cn } from '@/lib/utils'

/* One per chapter on the landing page's timeline, and named the same, so the
   nav and the spine are two views of the same set of stops. */
const MARKETING_LINKS = [
  { label: 'Watch', href: '/#watch' },
  { label: 'Listen', href: '/#listen' },
  { label: 'Together', href: '/#together' },
]

const EASE = [0.22, 1, 0.36, 1] as const

/**
 * Floating glass capsule, shared by every page.
 *
 * Sits above the shared liquidGL canvas on purpose. That canvas carries every
 * lens on the page and is placed just below the highest one (the cursor), so
 * anything below it — including this bar's own contents — would be painted
 * over by its own glass.
 *
 * Wide and near-invisible over the hero, then it contracts into a tighter,
 * denser pill once you start scrolling — so it reads as chrome only when you
 * actually need it. What sits inside depends on the route and on whether
 * anyone is signed in.
 */
export function Header() {
  const { scrollY } = useScroll()
  const { user, signOut } = useAuth()
  const { phase } = useEntrance()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const glassRef = useRef<HTMLDivElement>(null)

  const onLanding = pathname === '/'

  /*
   * Glass by `backdrop-filter`, not by a WebGL lens.
   *
   * This bar used to run liquidGL, which photographs the page behind it with
   * html2canvas and refracts the picture. It is a lovely effect on a static
   * page and a liability on this one: the photograph is taken once and goes
   * stale the moment anything under the bar moves, it cannot see a `<video>`
   * or a WebGL canvas at all, and while the snapshot is missing the bar reads
   * as a flat dark rectangle with a hard edge — which is exactly what it was
   * doing over the new hero.
   *
   * A real `backdrop-filter` blurs whatever is genuinely underneath, every
   * frame, including the parallaxing hero image. It is also what the rest of
   * the app already uses, so the bar now matches the surfaces it floats over.
   */

  /*
   * Tied to scroll position rather than flipped at a threshold, so the bar
   * tightens continuously as you move. Spring-damped so a flick of the wheel
   * doesn't snap it.
   */
  const progress = useSpring(useTransform(scrollY, [0, 260], [0, 1], { clamp: true }), {
    stiffness: 220,
    damping: 38,
    mass: 0.35,
  })

  const width = useTransform(progress, [0, 1], ['min(74rem, 100%)', 'min(54rem, 100%)'])
  const padX = useTransform(progress, [0, 1], ['1.35rem', '0.9rem'])
  const padY = useTransform(progress, [0, 1], ['0.8rem', '0.45rem'])
  /* Glass gets denser as it tightens — thin and near-invisible over the hero,
     thick enough to read against page content once you're into the page. */
  const glassAlpha = useTransform(progress, [0, 1], [0, 1])
  /* Anchor links only mean anything on the landing page. */
  const links = onLanding ? MARKETING_LINKS : []

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-[130] flex justify-center px-4 pt-4 md:pt-5">
      <motion.div
        className={cn(
          'pointer-events-auto relative flex items-center gap-2 overflow-hidden rounded-full border border-white/10 min-[380px]:gap-3 sm:gap-6',
          /* Off the landing page the bar is always solid; on it the fill fades
             in with scroll, so it is barely there over the hero and fully
             readable once page content is running underneath. */
          onLanding ? 'backdrop-blur-2xl backdrop-saturate-150' : 'glass-pill-ink',
        )}
        initial={false}
        animate={{
          /* Bubbles out of nothing when the corridor lands, then behaves
             normally for the rest of the session. */
          scale: phase === 'tunnel' ? 0.6 : 1,
          opacity: phase === 'tunnel' ? 0 : 1,
        }}
        style={
          onLanding
            ? {
                width,
                paddingLeft: padX,
                paddingRight: padX,
                paddingTop: padY,
                paddingBottom: padY,
              }
            : undefined
        }
        transition={{ duration: phase === 'reveal' ? 0.85 : 0.55, ease: EASE }}
      >
        {/* The tint itself, opacity-driven by scroll. Separate from the bar so
            the blur above stays constant while only the fill comes up. */}
        {onLanding && (
          <motion.div
            ref={glassRef}
            aria-hidden
            className="absolute inset-0 -z-10 rounded-full bg-gradient-to-b from-[rgb(24_24_29/0.92)] to-[rgb(11_11_15/0.92)] shadow-[inset_0_1px_0_0_rgb(255_255_255/0.12)]"
            style={{ opacity: glassAlpha }}
          />
        )}

        <Link
          to={user ? '/dashboard' : '/'}
          className="flex min-h-11 shrink-0 items-center gap-2.5 rounded-full transition-opacity hover:opacity-80 sm:min-h-0"
        >
          <Logo />
          {/* The mark alone on the narrowest phones. With the menu trigger and
              both auth buttons in the same row, the wordmark is what pushes
              "Sign up" off the edge — and the mark still identifies the site. */}
          <span className="hidden font-display text-[1.02rem] font-semibold tracking-[-0.02em] text-chalk min-[380px]:inline">
            Huddle
          </span>
        </Link>

        {/* Same links, the other half of the breakpoint — the dock is
            pointer-driven and hides below `md`, so without this the landing
            page's own sections had no route on a phone. */}
        <MobileNav links={links} />

        {links.length > 0 && (
          <DockNav
            items={links.map((link) => ({
              key: link.href,
              node: (
                <a
                  href={link.href}
                  className="block rounded-full text-[0.85rem] text-mist transition-colors duration-300 hover:text-chalk"
                >
                  {link.label}
                </a>
              ),
            }))}
          />
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          {user ? (
            <>
              {pathname !== '/dashboard' && (
                <Button asChild variant="ghost" size="sm" flat className="hidden sm:inline-flex">
                  <Link to="/dashboard">Dashboard</Link>
                </Button>
              )}
              <span
                aria-hidden
                title={user.name}
                className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-signal to-signal-deep text-[0.75rem] font-semibold text-white"
              >
                {user.name.slice(0, 1).toUpperCase()}
              </span>
              <Button
                variant="outline"
                size="sm"
                flat
                onClick={async () => {
                  await signOut()
                  navigate('/')
                }}
              >
                Sign out
              </Button>
            </>
          ) : (
            <>
              {/* Never hidden. Signing in is the one thing a returning visitor
                  came here to do, and on a phone this was the only route to
                  it — the marketing links are already gone below `md`, so the
                  width it needs is there. */}
              {/* On the landing page these open a panel over the page instead
                  of navigating away from the argument it is making — the query
                  parameter is how this bar, which every route shares, reaches
                  that page without either of them knowing about the other. */}
              <Button asChild variant="ghost" size="sm" flat>
                <Link to={onLanding ? '/?signin' : '/signin'}>Sign in</Link>
              </Button>
              <Button asChild variant="outline" size="sm" flat>
                {/* "Create room" is the pitch, but it costs a phone's whole
                    remaining header width to say it. */}
                <Link to={onLanding ? '/?signup' : '/signup'}>
                  <span className="sm:hidden">Sign up</span>
                  <span className="hidden sm:inline">Create room</span>
                </Link>
              </Button>
            </>
          )}
        </div>
      </motion.div>
    </header>
  )
}
