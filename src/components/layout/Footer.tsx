import { Logo } from '@/components/layout/Logo'
import { hasRealPosters } from '@/lib/posters'

const FOOTER_LINKS = [
  { label: 'Product', href: '#whats-new' },
  { label: 'Room Types', href: '#rooms' },
  { label: 'Sign In', href: '#top' },
  { label: 'Create Room', href: '#top' },
]

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-white/[0.06] bg-abyss px-6 py-12 md:px-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 md:flex-row md:justify-between md:gap-6">
        <a href="#top" className="flex min-h-11 items-center gap-2.5 transition-opacity hover:opacity-80 sm:min-h-0">
          <Logo />
          <span className="font-display text-[0.95rem] font-semibold tracking-[-0.02em] text-chalk">
            Huddle
          </span>
        </a>

        <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-7 gap-y-1 sm:gap-y-3">
          {FOOTER_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              /* Padded to a thumb-sized row on a phone and back to plain
                 text once there is a cursor — the link was a 20px-tall strip,
                 which is a miss as often as a hit. */
              className="flex min-h-11 items-center rounded-sm text-sm text-mist transition-colors hover:text-chalk sm:min-h-0"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <p className="text-xs text-dusk">© {new Date().getFullYear()} Huddle</p>
      </div>

      {hasRealPosters && (
        <p className="mx-auto mt-8 max-w-6xl border-t border-white/[0.05] pt-6 text-center text-[0.7rem] leading-relaxed text-dusk/80 md:text-left">
          Background artwork from{' '}
          <a
            href="https://www.themoviedb.org/"
            target="_blank"
            rel="noreferrer noopener"
            className="text-dusk underline-offset-2 transition-colors hover:text-mist hover:underline"
          >
            The Movie Database
          </a>
          . This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
      )}
    </footer>
  )
}
