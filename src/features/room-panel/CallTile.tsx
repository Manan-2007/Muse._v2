import { useEffect, useRef } from 'react'
import { MicOff, PictureInPicture2, VideoOff, WifiOff } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * One face in the call.
 *
 * The stream is attached through a ref rather than a `src` — `srcObject` takes
 * a MediaStream object, which has no URL to put in an attribute.
 */
export function CallTile({
  stream,
  name,
  muted,
  cameraOff,
  failed = false,
  isSelf = false,
  poppedOut = false,
  onPopOut,
}: {
  stream: MediaStream | null
  name: string
  muted: boolean
  cameraOff: boolean
  failed?: boolean
  isSelf?: boolean
  /** This face is currently in the floating window, so the slot stands empty. */
  poppedOut?: boolean
  onPopOut?: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (video.current && video.current.srcObject !== stream) {
      video.current.srcObject = stream
    }
  }, [stream])

  const live = stream && !cameraOff && !failed && !poppedOut

  return (
    <div className="group/tile relative aspect-[4/3] overflow-hidden rounded-card bg-deep ring-1 ring-inset ring-white/[0.08]">
      <video
        ref={video}
        autoPlay
        playsInline
        /* Never play your own audio back — that is what causes the howl. */
        muted={isSelf}
        className={cn(
          'size-full object-cover',
          /* Mirrored, because a self-view that moves the wrong way is
             disorienting. Remote faces are left as they are. */
          isSelf && '-scale-x-100',
          !live && 'invisible',
        )}
      />

      {poppedOut && (
        <div className="absolute inset-0 grid place-items-center bg-white/[0.03]">
          <span className="flex flex-col items-center gap-1.5 px-2 text-center">
            <PictureInPicture2 aria-hidden className="size-4 text-dusk" />
            <span className="text-[0.6rem] leading-tight text-dusk">Floating</span>
          </span>
        </div>
      )}

      {!live && !poppedOut && (
        <div className="absolute inset-0 grid place-items-center">
          {failed ? (
            <span className="flex flex-col items-center gap-1.5 px-2 text-center">
              <WifiOff aria-hidden className="size-4 text-signal-bright" />
              <span className="text-[0.62rem] leading-tight text-signal-bright">
                Couldn't connect
              </span>
            </span>
          ) : (
            <span className="grid size-10 place-items-center rounded-full bg-white/[0.08] font-display text-[0.85rem] font-semibold text-chalk ring-1 ring-inset ring-white/15">
              {name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
      )}

      {onPopOut && !poppedOut && (
        <button
          type="button"
          onClick={onPopOut}
          aria-label={`Float ${isSelf ? 'your' : name + "'s"} video`}
          className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/60 text-chalk opacity-0 backdrop-blur-sm transition-all duration-200 hover:bg-black/85 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal group-hover/tile:opacity-100"
        >
          <PictureInPicture2 aria-hidden className="size-3" />
        </button>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-4">
        <span className="min-w-0 flex-1 truncate text-[0.68rem] font-medium text-chalk">
          {isSelf ? 'You' : name}
        </span>
        {muted && <MicOff aria-label="Muted" className="size-3 shrink-0 text-signal-bright" />}
        {cameraOff && !failed && (
          <VideoOff aria-label="Camera off" className="size-3 shrink-0 text-mist" />
        )}
      </div>
    </div>
  )
}
