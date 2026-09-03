import { Route, Routes, useLocation } from 'react-router-dom'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Header } from '@/components/layout/Header'
import { LiquidGlassFilter } from '@/components/layout/LiquidGlassFilter'
import { SignInPage, SignUpPage } from '@/pages/AuthPages'
import { DashboardPage } from '@/pages/DashboardPage'
import { LandingPage } from '@/pages/LandingPage'
import { RequireAuth } from '@/pages/RequireAuth'
import { useLiquidPointer } from '@/hooks/useLiquidPointer'
import { useSmoothScroll } from '@/hooks/useSmoothScroll'

export default function App() {
  useSmoothScroll()
  /* One listener for every liquid-glass control on the page. */
  useLiquidPointer()
  const { pathname } = useLocation()

  /*
   * The hub paints its own full-screen world, so anything behind it would be
   * an animating surface nobody can see — and it would have to share frames
   * with the hub's own canvas and particle field.
   */
  const onHub = pathname === '/dashboard'

  /*
   * Everything that is not the hub is dark now.
   *
   * This used to be two skins: cinematic dark for the marketing page, an
   * off-white neon canvas for auth. That split stopped making sense once the
   * landing page became the lit room and the black silk behind it — signing up
   * threw the visitor from that into a bright page belonging to a different
   * product. Auth is the step immediately after the landing's call to action,
   * so it now inherits the same material.
   *
   * Keyed off "not the hub" rather than off `/` specifically, because the
   * catch-all route renders the landing page at unknown paths too — testing
   * for the exact path left those rendering the dark page over the light
   * backdrop.
   */
  const dark = !onHub

  return (
    <div className={dark ? 'relative min-h-svh bg-void' : 'relative min-h-svh'}>
      <LiquidGlassFilter />
      <Header />

      {/*
        The last line of defence.
        Any render error that gets past a feature's own boundary would
        otherwise unmount the entire application to a black page with no way
        back. Keyed on the path so navigating away clears it.
      */}
      <ErrorBoundary
        resetKey={pathname}
        fallback={(error, reset) => (
          <div className="grid min-h-svh place-items-center p-6">
            <div className="max-w-sm text-center">
              <h1 className="font-display text-[1.4rem] font-semibold text-chalk">
                Something broke on this screen
              </h1>
              <p className="mt-2 text-[0.9rem] leading-relaxed text-mist">
                {error.message || 'An unexpected error stopped the page from rendering.'}
              </p>
              <button
                type="button"
                onClick={reset}
                className="mt-5 rounded-full bg-chalk px-4 py-2.5 text-[0.85rem] font-medium text-void"
              >
                Try again
              </button>
            </div>
          </div>
        )}
      >
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/signin" element={<SignInPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <DashboardPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<LandingPage />} />
      </Routes>
      </ErrorBoundary>
    </div>
  )
}
