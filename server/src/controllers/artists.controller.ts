import type { Request, Response } from 'express'

import { curatedArtists, searchArtists } from '../services/artists.service.js'
import { topCovers } from '../services/charts.service.js'

/**
 * Artists to pick from, with faces.
 *
 * No query returns the curated starter grid; a query searches. Both are used
 * only by onboarding's artist picker, so this stays a plain read.
 */
export async function artists(req: Request, res: Response) {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  res.json({ artists: query ? await searchArtists(query) : await curatedArtists() })
}

/** The chart covers behind the landing page. Public — no room, no account. */
export async function charts(_req: Request, res: Response) {
  res.json({ covers: await topCovers() })
}
