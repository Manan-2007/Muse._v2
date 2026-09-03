import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Keeps one broken feature from taking the whole app with it.
 *
 * React unmounts the entire tree when a render throws and nothing catches it,
 * which turns any single mistake — or any third-party script misbehaving —
 * into a blank black page with no way back. That is the worst possible
 * failure: the room is still connected, the music may still be playing, and
 * the person watching it has no interface at all.
 *
 * Deliberately a class. This is the one thing hooks still cannot express.
 */
export class ErrorBoundary extends Component<
  {
    children: ReactNode
    /** Shown in place of the subtree. Given a reset so it can be retried. */
    fallback: (error: Error, reset: () => void) => ReactNode
    /** Changing this clears a caught error — usually the route or the room. */
    resetKey?: unknown
  },
  { error: Error | null; lastKey?: unknown }
> {
  state: { error: Error | null; lastKey?: unknown } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    /* Logged rather than swallowed — the fallback tells the person what to do,
       the console tells whoever is fixing it what happened. */
    console.error('Caught by boundary:', error, info.componentStack)
  }

  /*
   * Clearing on a changed key belongs here rather than in `componentDidUpdate`.
   *
   * The lint rule against setting state after an update is right in general —
   * it costs a second render — but the alternative here is worse: recovering
   * one render later means the fallback is shown for a frame after the thing
   * that broke has already been navigated away from. Derived state runs before
   * paint, so the new subtree is what actually gets drawn.
   */
  static getDerivedStateFromProps(
    props: { resetKey?: unknown },
    state: { error: Error | null; lastKey?: unknown },
  ) {
    if (state.lastKey !== props.resetKey) {
      return { error: null, lastKey: props.resetKey }
    }
    return null
  }

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error, () => this.setState({ error: null }))
    }
    return this.props.children
  }
}
