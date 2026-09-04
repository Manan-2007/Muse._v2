import type { Request, Response } from 'express'

import { curatedArtists, searchArtists } from '../services/artists.service.js'

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
