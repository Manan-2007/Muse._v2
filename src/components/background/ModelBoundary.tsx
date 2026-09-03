import { Component, type ReactNode } from 'react'

type Props = { fallback: ReactNode; children: ReactNode }
type State = { failed: boolean }

/**
 * A corrupt or unreadable `.glb` throws during render. Without this, one bad
 * file would take the whole page down; instead that object quietly returns to
 * its CSS version.
 */
export class ModelBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.warn('[Huddle] Model failed to load, using the CSS object instead.', error)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
