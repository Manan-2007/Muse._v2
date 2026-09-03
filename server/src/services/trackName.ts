/**
 * Turning a YouTube upload's name into a song's name.
 *
 * Uploads are titled for a search engine, not for a record sleeve: the same
 * song arrives as "Artist - Song (Official Video) [4K]" or "Song (Official
 * Music Video) | Artist". Shown unedited, a queue reads as a list of upload
 * filenames rather than music.
 *
 * The rules here are deliberately narrow. Stripping every bracket would be
 * simpler and wrong — "(feat. …)", "(Remix)", "(Live at …)", "(Acoustic)" are
 * part of what the song *is*, and a library that quietly merges a remix with
 * its original is worse than one that shows a bit of noise.
 */

/**
 * Bracketed asides that describe the upload rather than the song.
 *
 * Matched whole, so "(Official Video)" goes and "(Official Video Remix)" —
 * were such a thing to exist — stays, along with anything else carrying words
 * this list does not account for.
 */
const NOISE = [
  'official video',
  'official music video',
  'official audio',
  'official visualizer',
  'official visualiser',
  'official lyric video',
  'official lyrics video',
  'official version',
  'official',
  'music video',
  'lyric video',
  'lyrics video',
  'lyrics',
  'lyric',
  'audio',
  'visualizer',
  'visualiser',
  'full video',
  'full song',
  'video song',
  'full audio',
  'hd',
  'hq',
  '4k',
  '4k remaster',
  '4k remastered',
  'remaster',
  'remastered',
  'hd remaster',
  'with lyrics',
  'closed captioned',
]

/* `(…)`, `[…]` and `{…}` all get used for the same job by different uploaders. */
const BRACKETED = /[([{]\s*([^)\]}]*)\s*[)\]}]/g

/** A year on its own — "(2019)" — which is metadata, not part of a name. */
const BARE_YEAR = /^(19|20)\d{2}$/

function stripNoise(title: string) {
  return title
    .replace(BRACKETED, (whole, inner: string) => {
      const normalised = inner.trim().toLowerCase().replace(/\s+/g, ' ')
      if (!normalised) return ''
      if (BARE_YEAR.test(normalised)) return ''
      return NOISE.includes(normalised) ? '' : whole
    })
    /* Trailing "| Artist", "｜ Artist", and the pipe-separated tails that
       uploads collect. Only after a real title, never the whole thing. */
    .replace(/\s*[|｜]\s*[^|｜]*$/, '')
    .replace(/\s{2,}/g, ' ')
    /* Punctuation left dangling once its contents were removed. */
    .replace(/\s*[-–—:,]\s*$/, '')
    .trim()
}

/**
 * A channel name, as an artist.
 *
 * YouTube's auto-generated artist channels are suffixed " - Topic", and label
 * channels are suffixed "VEVO". Neither is how anyone refers to the artist.
 */
export function cleanArtist(channel: string | null | undefined): string | null {
  if (!channel) return null
  const cleaned = channel
    .replace(/\s*-\s*topic\s*$/i, '')
    .replace(/vevo\s*$/i, '')
    .trim()
  return cleaned || null
}

export type CleanedName = { title: string; artist: string | null }

/**
 * Split an upload title into a song and, where it is stated, an artist.
 *
 * The leading "Artist - " convention is close to universal on music uploads
 * and is worth reading, because it is usually more accurate than the channel:
 * a song uploaded to a label's channel names its actual performer in the
 * title. When the title says nothing, the channel is the fallback.
 */
export function cleanTrackName(rawTitle: string, channel?: string | null): CleanedName {
  const channelArtist = cleanArtist(channel)
  const stripped = stripNoise(rawTitle) || rawTitle.trim()

  /* Split on the first dash that has space around it — "Artist - Song".
     Hyphenated words ("Jay-Z", "twenty-one") have no spaces and survive. */
  const match = /^(.{1,60}?)\s+[-–—]\s+(.+)$/.exec(stripped)
  if (match) {
    const [, left, right] = match
    const artist = left!.trim()
    const title = stripNoise(right!.trim()) || right!.trim()
    if (artist && title) return { title, artist }
  }

  return { title: stripped, artist: channelArtist }
}
