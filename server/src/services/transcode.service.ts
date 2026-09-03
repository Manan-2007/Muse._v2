import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

/**
 * Turning a film into something that starts playing immediately.
 *
 * A plain MP4 is one enormous file with a single index at one end of it. The
 * browser cannot show a frame until it has read that index, and on a long film
 * the index alone runs to tens of megabytes — so "press play" means "download
 * 21MB first, then we'll talk". HLS inverts that: a playlist of a couple of
 * kilobytes names a few hundred short segments, and the player fetches the
 * first one and starts.
 *
 * The top rung is a remux, not a re-encode. The source is already H.264 and
 * AAC, which is exactly what HLS wants, so it is copied through untouched:
 * bit-for-bit what was uploaded, for nothing but I/O. Anyone whose connection
 * can carry the original still gets the original, exactly as before.
 *
 * Below it sit encoded fallbacks, and those are the point. A single rendition
 * means a player on a slow line has nothing to drop to — it stalls, refills,
 * and stalls again, because the only stream on offer is wider than the pipe.
 * No amount of buffering config fixes that; there has to be something lighter
 * to switch to. That costs real CPU once, at publish time, so that nobody pays
 * for it in stalls every time they watch.
 */

/** Six seconds is the HLS convention: quick to start, few enough requests. */
const SEGMENT_SECONDS = 6

/**
 * The fallback renditions, generated below whatever was uploaded.
 *
 * Widths rather than heights, because films are not 16:9 — the 1920×900 print
 * that prompted this is 2.13:1, and "720p" means nothing useful there. Width
 * is what actually tracks the bitrate a rung needs.
 *
 * The bitrates are deliberately well clear of each other. Rungs that sit close
 * together give the player a choice that changes nothing, and it will hunt
 * between them; roughly halving each time means every switch is a real one.
 */
const LADDER = [
  { width: 1280, bitrate: 1_200_000 },
  { width: 854, bitrate: 600_000 },
]

/**
 * The best H.264 encoder this machine actually has.
 *
 * VideoToolbox is Apple's hardware encoder and it is not a small difference —
 * it is the difference between publishing a feature film over a coffee and
 * leaving it running overnight. Its quality per bit is worse than x264's,
 * which would matter if these were the picture people watch; they are the
 * fallback for a line that cannot carry the picture at all, so speed wins.
 *
 * Probed once and cached, because `ffmpeg -encoders` is not free and the
 * answer cannot change while the process is running.
 */
let encoderProbe: Promise<string> | null = null

function h264Encoder(): Promise<string> {
  encoderProbe ??= run('ffmpeg', ['-hide_banner', '-encoders'])
    .then((out) => (out.includes('h264_videotoolbox') ? 'h264_videotoolbox' : 'libx264'))
    /* Falling back rather than failing: if the probe itself breaks, libx264 is
       present in every practical ffmpeg build and the encode can still run. */
    .catch(() => 'libx264')
  return encoderProbe
}

export type AudioTrack = { index: number; language: string; label: string }
export type SubtitleTrack = { index: number; language: string; label: string; codec: string }

export type ProbeResult = {
  durationSeconds: number
  width: number | null
  height: number | null
  videoCodec: string | null
  audio: AudioTrack[]
  subtitles: SubtitleTrack[]
}

/* ISO 639-2 for the languages that actually turn up on a film print. Anything
   unlisted keeps its raw tag, which is still more use than "Track 3". */
const LANGUAGE_NAMES: Record<string, string> = {
  eng: 'English',
  hin: 'Hindi',
  tam: 'Tamil',
  tel: 'Telugu',
  mal: 'Malayalam',
  kan: 'Kannada',
  ben: 'Bengali',
  mar: 'Marathi',
  pan: 'Punjabi',
  guj: 'Gujarati',
  urd: 'Urdu',
  jpn: 'Japanese',
  kor: 'Korean',
  spa: 'Spanish',
  fra: 'French',
  deu: 'German',
  ita: 'Italian',
  por: 'Portuguese',
  rus: 'Russian',
  zho: 'Chinese',
  ara: 'Arabic',
}

function run(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args)
    let out = ''
    let err = ''

    child.stdout.on('data', (chunk) => (out += chunk))
    child.stderr.on('data', (chunk) => (err += chunk))
    child.on('error', (cause) =>
      reject(
        new Error(
          `${command} could not be started — is it installed and on PATH? (${cause.message})`,
        ),
      ),
    )
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${command} exited ${code}: ${err.slice(-800)}`)),
    )
  })
}

/** What the file actually contains, so the HLS layout can match it. */
export async function probe(input: string): Promise<ProbeResult> {
  const raw = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=index,codec_type,codec_name,width,height:stream_tags=language',
    '-of',
    'json',
    input,
  ])

  const parsed = JSON.parse(raw) as {
    format?: { duration?: string }
    streams?: {
      index: number
      codec_type: string
      codec_name?: string
      width?: number
      height?: number
      tags?: { language?: string }
    }[]
  }

  const streams = parsed.streams ?? []
  const video = streams.find((stream) => stream.codec_type === 'video')

  /*
   * Audio is numbered by its position among audio streams, not by its index in
   * the file. ffmpeg's `-map 0:a:N` counts the former, and the two only agree
   * when the video happens to come first with nothing interleaved.
   */
  const audio = streams
    .filter((stream) => stream.codec_type === 'audio')
    .map((stream, position) => {
      const language = stream.tags?.language ?? 'und'
      return {
        index: position,
        language,
        label: LANGUAGE_NAMES[language] ?? (language === 'und' ? `Track ${position + 1}` : language),
      } satisfies AudioTrack
    })

  /* Numbered among subtitle streams for the same reason as audio above. */
  const subtitles = streams
    .filter((stream) => stream.codec_type === 'subtitle')
    .map((stream, position) => {
      const language = stream.tags?.language ?? 'und'
      return {
        index: position,
        language,
        label: LANGUAGE_NAMES[language] ?? (language === 'und' ? `Track ${position + 1}` : language),
        codec: stream.codec_name ?? 'unknown',
      } satisfies SubtitleTrack
    })

  return {
    durationSeconds: Number(parsed.format?.duration ?? 0),
    width: video?.width ?? null,
    height: video?.height ?? null,
    videoCodec: video?.codec_name ?? null,
    audio,
    subtitles,
  }
}

/**
 * How often the source carries a keyframe, in seconds.
 *
 * This decides where the copied rung's segments can possibly fall. A stream
 * can only be cut at a keyframe, so ffmpeg does not honour `-hls_time` exactly
 * on a copy — it runs on to the next keyframe at or after each boundary. A
 * film with keyframes every 2.04s therefore yields 6.125s segments from a
 * nominal 6, which is precisely what the published print shows.
 *
 * Knowing the number lets the encoded rungs be forced onto that same grid, so
 * every rendition splits at the same instants and switching between them is
 * seamless. Read from the opening two minutes rather than the whole file: this
 * is a property of how the thing was encoded, and walking every packet of a
 * feature to confirm it costs far more than it could ever tell us.
 *
 * Null when it can't be established — an irregular source (scene-change
 * keyframes) has no grid to snap to, and the caller falls back to the nominal
 * segment length.
 */
async function keyframeInterval(input: string): Promise<number | null> {
  try {
    const raw = await run('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-read_intervals',
      '%+120',
      '-show_entries',
      'packet=pts_time,flags',
      '-of',
      'csv=p=0',
      input,
    ])

    /* Rows look like `1.234,K__` — the K flag marks a keyframe. */
    const times = raw
      .split('\n')
      .filter((line) => line.includes('K'))
      .map((line) => Number(line.split(',')[0]))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)

    if (times.length < 4) return null

    const gaps = times.slice(1).map((time, index) => time - times[index]!)
    gaps.sort((a, b) => a - b)
    const median = gaps[Math.floor(gaps.length / 2)]!

    /*
     * Only trust a genuinely regular source. If the middle gap does not
     * describe most of the others, keyframes are being placed by content
     * rather than by a clock, and there is no grid to snap anything to.
     */
    const regular = gaps.filter((gap) => Math.abs(gap - median) < 0.02).length
    if (regular < gaps.length * 0.8) return null

    return median > 0.1 ? median : null
  } catch {
    return null
  }
}

/**
 * Subtitle formats that convert cleanly to WebVTT.
 *
 * These are text; `subrip`, `ass` and friends are timed strings that ffmpeg can
 * rewrite into VTT in a moment. Bitmap formats — `dvd_subtitle`, `hdmv_pgs`,
 * which are what most Blu-ray rips carry — are images of text, and turning
 * those into VTT means running OCR. Out of scope, so they are skipped rather
 * than failing the publish over something optional.
 */
const TEXT_SUBTITLE_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text'])

export const isTextSubtitle = (track: SubtitleTrack) => TEXT_SUBTITLE_CODECS.has(track.codec)

/**
 * Pull every text subtitle out as a WebVTT file.
 *
 * Written as standalone `.vtt` rather than segmented into the HLS ladder. A
 * subtitle file for a whole film is tens of kilobytes — smaller than a single
 * video segment — so the machinery to chop it into a playlist would cost more
 * than it saves, and a plain `<track>` element handles it in every browser.
 */
export async function extractSubtitles(input: string, outDir: string, tracks: SubtitleTrack[]) {
  const usable = tracks.filter(isTextSubtitle)
  if (usable.length === 0) return []

  const written: { language: string; label: string; file: string }[] = []

  for (const track of usable) {
    const file = `sub_${track.index}_${track.language}.vtt`
    try {
      await run('ffmpeg', [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-i',
        input,
        '-map',
        `0:s:${track.index}`,
        '-c:s',
        'webvtt',
        path.join(outDir, file),
      ])
      written.push({ language: track.language, label: track.label, file })
    } catch {
      /* One malformed subtitle stream — which is common in the wild — should
         not take the whole film down with it. */
    }
  }

  return written
}

/**
 * Codecs a browser can play once they are inside an HLS segment.
 *
 * The remux only works because the source already holds these. Anything else
 * — HEVC, AC-3, DTS, which ordinary film rips are full of — has to be encoded,
 * and the caller is told rather than left with segments no one can play.
 */
const COPYABLE_VIDEO = new Set(['h264'])

export function canRemux(probed: ProbeResult) {
  return probed.videoCodec !== null && COPYABLE_VIDEO.has(probed.videoCodec)
}

/**
 * Write an HLS ladder for `input` into `outDir`.
 *
 * Produces the source rendition plus every fallback below it, and every audio
 * track the source carries, as a master playlist over a directory of
 * fragmented-MP4 segments. Audio is a separate group rather than being muxed
 * into each video rendition — which is both what lets a viewer switch from
 * English to Hindi without re-fetching the picture, and what stops the audio
 * from being duplicated once per rung.
 *
 * One ffmpeg pass builds all of it. The source is decoded once and fanned out
 * to the encoders, so adding a rung costs an encode rather than another full
 * read of the file.
 */
export async function toHls(
  input: string,
  outDir: string,
  onProgress?: (fraction: number) => void,
) {
  const probed = await probe(input)

  if (!canRemux(probed)) {
    throw new Error(
      `This file is ${probed.videoCodec ?? 'an unknown codec'}, which can't be repackaged without re-encoding. Convert it to H.264 first.`,
    )
  }
  if (probed.audio.length === 0) throw new Error('That file has no audio track')

  /*
   * Each variant's directory name.
   *
   * `name:` is what ffmpeg substitutes for `%v`, so it becomes a path segment
   * and ends up in the master playlist as a URL. It must therefore be free of
   * spaces — `var_stream_map` is a space-delimited string, so a track labelled
   * "Track 1" silently splits the map into nonsense — and free of anything
   * that would need escaping in a URL. The position is enough to be unique;
   * the human-readable name is carried by `language`, which is the attribute
   * players actually build their audio menu from.
   */
  const audioDir = (position: number) => `a${position}`

  /*
   * Which rungs are worth making.
   *
   * Anything at or above the source's own width is dropped: re-encoding a
   * 720p upload *up* to 1280 would spend real CPU to produce a stream that is
   * larger than the original and looks worse than it. When the width can't be
   * probed the rung is kept, and the `min(…,iw)` in the scaler below is what
   * guarantees it still cannot upscale.
   */
  const fallbacks = LADDER.filter((rung) => probed.width === null || rung.width < probed.width)
  /* Rung 0 is the untouched source; the rest follow in descending quality. */
  const videoRungs = [null, ...fallbacks]
  const encoder = await h264Encoder()

  /*
   * The grid every rendition is cut on.
   *
   * The copied rung can only break at the source's own keyframes, so it will
   * overrun a nominal six seconds to the next one. Rounding up to that same
   * multiple — 6.125s for a source with keyframes every 2.04s — and forcing
   * the encoders onto it means all the rungs agree about where segments
   * start, instead of drifting steadily apart over the length of a film.
   */
  const gop = await keyframeInterval(input)
  const segmentSeconds = gop
    ? Number((Math.ceil(SEGMENT_SECONDS / gop) * gop).toFixed(3))
    : SEGMENT_SECONDS

  /*
   * ffmpeg writes into these directories but will not create them, and the
   * failure when they are missing is a bare "No such file or directory" from
   * deep inside the muxer.
   */
  /* The segment template is `v%v`, so the directory is a literal "v" followed
     by the variant name — `v0`, `v1`… for the picture, `va0`, `va1`… for the
     audio, which takes a name so it cannot collide with a video index. */
  await Promise.all([
    ...videoRungs.map((_, index) => mkdir(path.join(outDir, `v${index}`), { recursive: true })),
    ...probed.audio.map((_, position) =>
      mkdir(path.join(outDir, `v${audioDir(position)}`), { recursive: true }),
    ),
  ])

  /* Every video rung, then every audio track, all pointing at one group so the
     player treats the audio as alternatives and the video as qualities. */
  const streamMap = [
    ...videoRungs.map((_, index) => `v:${index},agroup:aud`),
    ...probed.audio.map(
      (track, position) =>
        `a:${track.index},agroup:aud,language:${track.language},name:${audioDir(position)}` +
        (position === 0 ? ',default:yes' : ''),
    ),
  ].join(' ')

  /*
   * Per-rung encoder settings.
   *
   * Keyframes are forced onto a fixed grid so that every encoded rung splits
   * at the same timestamps. Without that the renditions disagree about where
   * segments begin and switching between them is a visible stutter — the
   * player has to throw away and refetch whatever it had buffered.
   *
   * The copy rung keeps the source's own keyframes and so lands a fraction
   * either side of the grid. It cannot be made to do otherwise without
   * re-encoding it, which is the one thing this is built to avoid.
   */
  const videoArgs = videoRungs.flatMap((rung, index) => {
    if (rung === null) return [`-c:v:${index}`, 'copy']

    return [
      `-c:v:${index}`,
      encoder,
      `-filter:v:${index}`,
      `scale='min(${rung.width},iw)':-2`,
      `-b:v:${index}`,
      String(rung.bitrate),
      /* A ceiling and a drain rate, so a busy scene cannot spike past what the
         rung promises in the playlist and strand the very players who chose it
         because that promise fit their connection. */
      `-maxrate:v:${index}`,
      String(Math.round(rung.bitrate * 1.15)),
      `-bufsize:v:${index}`,
      String(rung.bitrate * 2),
      `-force_key_frames:v:${index}`,
      `expr:gte(t,n_forced*${segmentSeconds})`,
      `-pix_fmt:v:${index}`,
      'yuv420p',
      /* x264 only. VideoToolbox has no preset ladder — it is already as fast
         as it is going to be. */
      ...(encoder === 'libx264' ? [`-preset:v:${index}`, 'veryfast'] : []),
    ]
  })

  const args = [
    '-hide_banner',
    '-nostdin',
    '-i',
    input,
    /* The same source video, once per rung — ffmpeg decodes it a single time
       and feeds every encoder from that. */
    ...videoRungs.flatMap(() => ['-map', '0:v:0']),
    ...probed.audio.flatMap((track) => ['-map', `0:a:${track.index}`]),
    ...videoArgs,
    /* Audio is already AAC and is shared by every rung, so it is copied once
       and never re-encoded. */
    '-c:a',
    'copy',
    '-f',
    'hls',
    '-hls_time',
    String(segmentSeconds),
    '-hls_playlist_type',
    'vod',
    '-hls_segment_type',
    'fmp4',
    /* Every segment decodable on its own, so a player joining mid-film — or
       seeking — never has to walk back to the start. */
    '-hls_flags',
    'independent_segments',
    '-hls_fmp4_init_filename',
    'init.mp4',
    '-master_pl_name',
    'master.m3u8',
    '-var_stream_map',
    streamMap,
    '-hls_segment_filename',
    path.join(outDir, 'v%v', 'seg_%05d.m4s'),
    '-progress',
    'pipe:1',
    path.join(outDir, 'v%v', 'index.m3u8'),
  ]

  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args)
    let tail = ''

    /* `-progress` reports microseconds against a duration we already know. */
    child.stdout.on('data', (chunk: Buffer) => {
      const match = /out_time_ms=(\d+)/.exec(chunk.toString())
      if (match && probed.durationSeconds > 0 && onProgress) {
        const seconds = Number(match[1]) / 1_000_000
        onProgress(Math.min(1, seconds / probed.durationSeconds))
      }
    })

    child.stderr.on('data', (chunk: Buffer) => {
      tail = `${tail}${chunk}`.slice(-2000)
    })

    child.on('error', (cause) =>
      reject(new Error(`ffmpeg could not be started — is it installed? (${cause.message})`)),
    )
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${tail.slice(-800)}`)),
    )
  })

  return { masterPlaylist: path.join(outDir, 'master.m3u8'), probed }
}

/**
 * A poster frame, pulled from the film itself.
 *
 * Grabbed at 10% into the runtime rather than at 0: the first frame of a
 * feature is routinely a distributor logo or a few seconds of black, and
 * either makes a library of otherwise-recognisable posters look broken. 10%
 * in is reliably past that without landing in end-credits territory on
 * anything short. Clamped to a floor of 5s so a very short clip still skips
 * its opening beat, and floored below the last second so a probe that slightly
 * overstates duration can't seek past end-of-file.
 *
 * A failure here — a source ffmpeg can decode but can't seek cleanly, most
 * often — costs the library a poster, not the publish. Callers treat a
 * thrown error as "no thumbnail" rather than letting it take the film down.
 */
export async function extractPoster(
  input: string,
  outPath: string,
  durationSeconds: number,
): Promise<void> {
  const at = Math.min(Math.max(durationSeconds * 0.1, 5), Math.max(durationSeconds - 1, 0))

  await run('ffmpeg', [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-ss',
    String(at),
    '-i',
    input,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    outPath,
  ])
}
