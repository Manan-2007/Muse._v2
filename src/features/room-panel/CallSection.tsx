import { Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react'

import { CallTile } from '@/features/room-panel/CallTile'
import type { useMeshCall } from '@/features/room-panel/useMeshCall'
import { cn } from '@/lib/utils'

type Call = ReturnType<typeof useMeshCall>

function ControlButton({
  on,
  danger,
  label,
  onClick,
  children,
}: {
  on: boolean
  danger?: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={danger ? undefined : on}
      className={cn(
        'grid size-9 place-items-center rounded-full outline-none transition-colors duration-300',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
        danger
          ? 'bg-signal text-white hover:bg-signal-bright'
          : on
            ? 'bg-white/[0.08] text-chalk ring-1 ring-inset ring-white/15 hover:bg-white/[0.14]'
            : /* "Off" states are the loud ones — a muted mic has to be obvious
                 at a glance, not a subtly different shade of grey. */
              'bg-signal/20 text-signal-bright ring-1 ring-inset ring-signal/40 hover:bg-signal/30',
      )}
    >
      {children}
    </button>
  )
}

/**
 * The call, at the top of the panel.
 *
 * Deliberately compact: this sits above the chat in a narrow column, so tiles
 * are small and two-up. The point is seeing that people are there, not filling
 * the screen with faces — anyone who wants that has the watch stage.
 */
export function CallSection({
  call,
  selfName,
  poppedOut,
  onPopOut,
}: {
  call: Call
  selfName: string
  /** Socket id of the face in the floating window, or 'self'. */
  poppedOut: string | null
  onPopOut: (who: string | null) => void
}) {
  const joining = call.status === 'requesting'
  const live = call.status === 'live'

  if (!live) {
    return (
      <div className="border-b border-white/[0.07] p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-[0.95rem] font-semibold tracking-[-0.015em] text-chalk">
              Call
            </h3>
            <p className="mt-0.5 truncate text-[0.72rem] text-mist">
              {call.othersOnCall > 0
                ? `${call.othersOnCall} on the call`
                : 'Nobody on the call yet'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void call.join()}
            disabled={joining}
            className="shrink-0 rounded-full bg-chalk px-4 py-2 text-[0.8rem] font-medium text-void outline-none transition-transform duration-300 hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal active:scale-95 disabled:opacity-50"
          >
            {joining ? 'Starting…' : call.othersOnCall > 0 ? 'Join' : 'Start'}
          </button>
        </div>

        {call.error && (
          <p role="alert" className="mt-2.5 text-[0.72rem] leading-relaxed text-signal-bright">
            {call.error}
          </p>
        )}

        {/* Said before the call, not after it fails. Without a relay this works
            on one shared network and nowhere else, and that is worth knowing
            up front rather than discovering mid-call. */}
        {!call.relayAvailable && (
          <p className="mt-2.5 text-[0.7rem] leading-relaxed text-dusk">
            No TURN relay configured — calls will only connect between people on the same
            network.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="border-b border-white/[0.07] p-3">
      <div className="grid grid-cols-2 gap-2">
        <CallTile
          stream={call.localStream}
          name={selfName}
          muted={call.muted}
          cameraOff={call.cameraOff || !call.hasCamera}
          isSelf
          poppedOut={poppedOut === 'self'}
          onPopOut={() => onPopOut('self')}
        />
        {call.peers.map((peer) => (
          <CallTile
            key={peer.socketId}
            stream={peer.stream}
            name={peer.name}
            muted={peer.muted}
            cameraOff={peer.cameraOff}
            failed={peer.failed}
            poppedOut={poppedOut === peer.socketId}
            onPopOut={() => onPopOut(peer.socketId)}
          />
        ))}
      </div>

      {call.peers.length === 0 && (
        <p className="px-1 pt-2.5 text-[0.72rem] leading-relaxed text-mist">
          Waiting for someone else to join.
        </p>
      )}

      {call.peers.some((peer) => peer.failed) && (
        <p className="px-1 pt-2.5 text-[0.7rem] leading-relaxed text-dusk">
          {call.relayAvailable
            ? "A connection failed. The relay couldn't get through — that network may be blocking it."
            : 'A connection failed. Different networks need a TURN relay, and none is configured.'}
        </p>
      )}

      <div className="mt-3 flex items-center justify-center gap-2">
        <ControlButton
          on={!call.muted}
          label={call.muted ? 'Unmute' : 'Mute'}
          onClick={call.toggleMute}
        >
          {call.muted ? <MicOff aria-hidden className="size-4" /> : <Mic aria-hidden className="size-4" />}
        </ControlButton>

        <ControlButton
          on={!call.cameraOff}
          label={call.cameraOff ? 'Turn camera on' : 'Turn camera off'}
          onClick={call.toggleCamera}
        >
          {call.cameraOff ? (
            <VideoOff aria-hidden className="size-4" />
          ) : (
            <Video aria-hidden className="size-4" />
          )}
        </ControlButton>

        <ControlButton on danger label="Leave the call" onClick={call.leave}>
          <PhoneOff aria-hidden className="size-4" />
        </ControlButton>
      </div>
    </div>
  )
}
