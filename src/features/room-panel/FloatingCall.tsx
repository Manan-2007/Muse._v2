import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, MicOff, Minimize2, VideoOff, WifiOff, X } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * One face, lifted out of the panel and floated over everything.
 *
 * The panel's grid is for seeing that people are there. This is for actually
 * watching one of them — during a film, a game, or with the panel shut
 * entirely — so it lives above the whole screen rather than inside any one
 * activity, and it is the only piece of call UI that outlives the panel.
 *
 * Rendered into `document.body` rather than in place. The dashboard's root is
 * an animated element with `overflow: hidden`, and an ancestor carrying a
 * transform becomes the containing block for anything `fixed` inside it — so
 * left where it is declared, this window would be positioned against that
 * element and clipped by it rather than floating over the whole app. A portal
 * takes it out of that entirely, which is what makes "above everything, in
 * every section" a structural guarantee instead of a coincidence of z-index.
 *
 * Dragging is written straight to the element's transform rather than through
 * state. A pointermove fires far more often than React can usefully re-render,
 * and putting a component tree between the finger and the pixels is what makes
 * a dragged window feel like it is being towed. State is only touched when the
 * drag ends, which is also the only moment the position needs to be durable.
 */

/** Gap kept between the window and the edge of the screen, in px. */
const MARGIN = 16
/** How far a drag must travel before it counts as a drag and not a tap. */
const DRAG_SLOP = 4
/** Where it sits, as a corner. Free positions snap to the nearest of these. */
type Corner = 'tl' | 'tr' | 'bl' | 'br'

const STORE_KEY = 'syncroom.call.pip'

type Stored = { corner: Corner; large: boolean }

function readStored(): Stored {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) return JSON.parse(raw) as Stored
  } catch {
    /* Private mode, or a value from an older shape. Defaults are fine. */
  }
  return { corner: 'br', large: false }
}

/**
 * Corner → pixel position for the current viewport and window size.
 *
 * Recomputed rather than stored, so rotating a phone or resizing a window
 * cannot leave the thing parked off-screen where it can never be recovered.
 */
function cornerToPoint(corner: Corner, width: number, height: number) {
  const right = window.innerWidth - width - MARGIN
  const bottom = window.innerHeight - height - MARGIN
  return {
    x: corner === 'tl' || corner === 'bl' ? MARGIN : Math.max(MARGIN, right),
    y: corner === 'tl' || corner === 'tr' ? MARGIN : Math.max(MARGIN, bottom),
  }
}

/** Which corner a free position is closest to. */
function nearestCorner(x: number, y: number, width: number, height: number): Corner {
  const left = x + width / 2 < window.innerWidth / 2
  const top = y + height / 2 < window.innerHeight / 2
  return `${top ? 't' : 'b'}${left ? 'l' : 'r'}` as Corner
}

/**
 * The element currently being rendered, which is not always `document.body`.
 *
 * Going fullscreen does not resize an element, it renders that element's
 * subtree *and nothing else*. So a window portalled into the body is not
 * merely sitting behind the film — it is not drawn at all, which is exactly
 * why the face disappears the moment somebody expands the player and comes
 * back untouched when they leave. Following the fullscreen element keeps this
 * inside whichever subtree is actually on screen.
 *
 * Written against whatever stage happens to be fullscreen rather than against
 * Watch specifically: the next section to grow a fullscreen button gets this
 * for free instead of rediscovering the same disappearance.
 */
function fullscreenNode(): Element {
  const doc = document as Document & { webkitFullscreenElement?: Element | null }
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? document.body
}

function useFullscreenHost(): Element {
  const [host, setHost] = useState<Element>(fullscreenNode)

  useEffect(() => {
    const settle = () => setHost(fullscreenNode())
    /* Once on mount as well: this can be mounted while something is already
       fullscreen, in which case no change event is ever coming. */
    settle()
    document.addEventListener('fullscreenchange', settle)
    document.addEventListener('webkitfullscreenchange', settle)
    return () => {
      document.removeEventListener('fullscreenchange', settle)
      document.removeEventListener('webkitfullscreenchange', settle)
    }
  }, [])

  return host
}

export function FloatingCall({
  stream,
  name,
  muted,
  cameraOff,
  failed = false,
  isSelf = false,
  onClose,
}: {
  stream: MediaStream | null
  name: string
  muted: boolean
  cameraOff: boolean
  failed?: boolean
  isSelf?: boolean
  onClose: () => void
}) {
  const shell = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)

  /* Where this is allowed to be drawn right now. Changing it re-parents the
     window, which is a remount — see the two effects that depend on it. */
  const host = useFullscreenHost()

  const [stored, setStored] = useState<Stored>(readStored)
  const large = stored.large

  /* Kept in a ref as well, because the pointer handlers below run outside the
     render cycle and must not close over a stale position. */
  const point = useRef({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)

  const size = large
    ? { width: 320, height: 208 }
    : { width: 172, height: 116 }

  const place = useCallback(
    (x: number, y: number) => {
      point.current = { x, y }
      const node = shell.current
      if (node) node.style.transform = `translate3d(${x}px, ${y}px, 0)`
    },
    [],
  )

  /* Position on mount and whenever the size or the viewport changes. Layout
     effect so it is never painted at the origin first. */
  useLayoutEffect(() => {
    const settle = () => {
      const { x, y } = cornerToPoint(stored.corner, size.width, size.height)
      place(x, y)
    }
    settle()
    window.addEventListener('resize', settle)
    window.addEventListener('orientationchange', settle)
    return () => {
      window.removeEventListener('resize', settle)
      window.removeEventListener('orientationchange', settle)
    }
    /* `host` for the same reason as the stream below: the replacement node
       carries no transform, so it would otherwise paint at the origin. */
  }, [stored.corner, size.width, size.height, place, host])

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(stored))
    } catch {
      /* Nothing to recover — it just will not be remembered next time. */
    }
  }, [stored])

  /* `host` is in here because re-parenting the portal throws the old <video>
     away and mounts a fresh one. The stream has not changed, so without it
     this never re-runs and the new element plays nothing — a black rectangle
     with the camera plainly on. */
  useEffect(() => {
    if (video.current && video.current.srcObject !== stream) {
      video.current.srcObject = stream
    }
  }, [stream, host])

  /* Escape closes, matching every other dismissible layer in the app. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    /* Left button or touch only — a right-click drag is not a gesture anyone
       means, and it would swallow the context menu. */
    if (event.button !== 0) return
    const node = shell.current
    if (!node) return

    const startX = event.clientX
    const startY = event.clientY
    const origin = { ...point.current }
    let moved = false

    node.setPointerCapture(event.pointerId)

    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - startX
      const dy = move.clientY - startY
      if (!moved && Math.hypot(dx, dy) < DRAG_SLOP) return
      if (!moved) {
        moved = true
        setDragging(true)
      }
      /* Clamped every frame rather than on release, so it can never be towed
         off the edge and left there. */
      const x = Math.min(
        Math.max(MARGIN, origin.x + dx),
        Math.max(MARGIN, window.innerWidth - size.width - MARGIN),
      )
      const y = Math.min(
        Math.max(MARGIN, origin.y + dy),
        Math.max(MARGIN, window.innerHeight - size.height - MARGIN),
      )
      place(x, y)
    }

    const onUp = () => {
      node.releasePointerCapture(event.pointerId)
      node.removeEventListener('pointermove', onMove)
      node.removeEventListener('pointerup', onUp)
      node.removeEventListener('pointercancel', onUp)
      if (!moved) return
      setDragging(false)
      /* Snap. A window left at an arbitrary offset reads as dropped rather
         than placed, and drifts further from an edge with every move. */
      const corner = nearestCorner(point.current.x, point.current.y, size.width, size.height)
      setStored((current) => ({ ...current, corner }))
    }

    node.addEventListener('pointermove', onMove)
    node.addEventListener('pointerup', onUp)
    node.addEventListener('pointercancel', onUp)
  }

  /* Arrow keys move it corner to corner for anyone not using a pointer. */
  const onKeyDown = (event: React.KeyboardEvent) => {
    const map: Record<string, Corner> = {
      ArrowLeft: stored.corner.startsWith('t') ? 'tl' : 'bl',
      ArrowRight: stored.corner.startsWith('t') ? 'tr' : 'br',
      ArrowUp: stored.corner.endsWith('l') ? 'tl' : 'tr',
      ArrowDown: stored.corner.endsWith('l') ? 'bl' : 'br',
    }
    const next = map[event.key]
    if (!next) return
    event.preventDefault()
    setStored((current) => ({ ...current, corner: next }))
  }

  const live = stream && !cameraOff && !failed

  return createPortal(
    <div
      ref={shell}
      role="dialog"
      aria-label={`${isSelf ? 'You' : name}, floating video`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      style={{ width: size.width, height: size.height }}
      className={cn(
        'fixed left-0 top-0 z-[140] overflow-hidden rounded-2xl bg-deep outline-none',
        'shadow-[0_18px_50px_-12px_rgb(0_0_0/0.75),0_2px_10px_-2px_rgb(0_0_0/0.6)]',
        'ring-1 ring-inset ring-white/[0.12] focus-visible:ring-2 focus-visible:ring-signal',
        /* No transition while dragging — the finger is the animation. It is
           only wanted for the snap afterwards, and for resizing. */
        dragging
          ? 'cursor-grabbing touch-none select-none'
          : 'cursor-grab touch-none select-none transition-[width,height,transform] duration-300 ease-glass',
      )}
    >
      <video
        ref={video}
        autoPlay
        playsInline
        muted={isSelf}
        className={cn(
          'pointer-events-none size-full object-cover',
          isSelf && '-scale-x-100',
          !live && 'invisible',
        )}
      />

      {!live && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          {failed ? (
            <span className="flex flex-col items-center gap-1.5 px-2 text-center">
              <WifiOff aria-hidden className="size-4 text-signal-bright" />
              <span className="text-[0.62rem] leading-tight text-signal-bright">
                Couldn't connect
              </span>
            </span>
          ) : (
            <span className="grid size-11 place-items-center rounded-full bg-white/[0.08] font-display text-[0.9rem] font-semibold text-chalk ring-1 ring-inset ring-white/15">
              {name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
      )}

      {/* Controls ride above the video and stop drags of their own, so a tap
          on the close button is never read as the start of a move. */}
      <div className="absolute inset-x-0 top-0 flex justify-end gap-1 p-1.5 opacity-0 transition-opacity duration-200 focus-within:opacity-100 hover:opacity-100">
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setStored((current) => ({ ...current, large: !current.large }))}
          aria-label={large ? 'Shrink' : 'Enlarge'}
          className="grid size-6 place-items-center rounded-full bg-black/60 text-chalk backdrop-blur-sm transition-colors hover:bg-black/80"
        >
          {large ? <Minimize2 aria-hidden className="size-3" /> : <Maximize2 aria-hidden className="size-3" />}
        </button>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
          aria-label="Close floating video"
          className="grid size-6 place-items-center rounded-full bg-black/60 text-chalk backdrop-blur-sm transition-colors hover:bg-signal"
        >
          <X aria-hidden className="size-3" />
        </button>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/85 to-transparent px-2 pb-1.5 pt-5">
        <span className="min-w-0 flex-1 truncate text-[0.68rem] font-medium text-chalk">
          {isSelf ? 'You' : name}
        </span>
        {muted && <MicOff aria-label="Muted" className="size-3 shrink-0 text-signal-bright" />}
        {cameraOff && !failed && (
          <VideoOff aria-label="Camera off" className="size-3 shrink-0 text-mist" />
        )}
      </div>
    </div>,
    host,
  )
}
