import { Route, Routes, useLocation } from 'react-router-dom'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { SignInPage, SignUpPage } from '@/pages/AuthPages'
import { DashboardPage } from '@/pages/DashboardPage'
import { LandingPage } from '@/pages/LandingPage'
import { OnboardingPage } from '@/pages/OnboardingPage'
import { RequireAuth } from '@/pages/RequireAuth'

/**
 * The app shell.
 *
 * Deliberately thin: no global cursor, no glass-filter overlay, no floating
 * marketing header. Every screen paints its own chrome now — the aesthetic is
 * a streaming app (Apple Music), a record player (MD Vinyl) and rooms
 * (Discord), and none of those wear a bespoke pointer.
 */
export default function App() {
  const { pathname } = useLocation()

  return (
    <div className="relative min-h-svh bg-void">
      {/*
        The last line of defence. Any render error that gets past a feature's
        own boundary would otherwise unmount the whole app to a black page with
        no way back. Keyed on the path so navigating away clears it.
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
            path="/welcome"
            element={
              <RequireAuth allowUnonboarded>
                <OnboardingPage />
              </RequireAuth>
            }
          />
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
