import { createContext, useContext } from 'react'

import type * as studyApi from '@/features/study/api'

/**
 * The handle every pane reaches for when it wants to hand something to the
 * tutor.
 *
 * Kept in its own tiny module, separate from the panel that implements it,
 * because the panel is lazy-loaded and a context has to exist before the
 * chunk holding it arrives — a pane rendering an "Explain this" button
 * cannot wait on a markdown renderer to finish downloading.
 */
export type TutorAsk = {
  mode: studyApi.AssistantMode
  focus: studyApi.Focus | null
  /** What to say. Defaults to something sensible for the mode when omitted. */
  message?: string
}

export type Tutor = {
  /** Open the panel on this thing and send the opening question. */
  ask: (request: TutorAsk) => void
  /** Open the panel with a subject in focus but nothing asked yet. */
  open: (focus?: studyApi.Focus | null) => void
  /** False when the server has no model key — buttons disable rather than fail. */
  available: boolean
  /**
   * Why not, when it is not.
   *
   * Carried on the handle rather than worked out at each button, because
   * "no key on this server" and "could not ask the server" look identical
   * from here and are not the same thing to the person reading the tooltip —
   * and half these buttons live in sub-components that were never handed the
   * capabilities to tell them apart.
   */
  reason: string | null
}

export const TutorContext = createContext<Tutor | null>(null)

/** Null outside the Study stage, so a pane can be rendered anywhere. */
export const useTutor = () => useContext(TutorContext)
