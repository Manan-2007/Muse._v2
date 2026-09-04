import { useRef } from 'react'
import { Check, Loader2, Upload } from 'lucide-react'

import { AVATAR_COLORS, ILLUSTRATIONS, initialAvatar } from '@/features/settings/avatars'
import { cn } from '@/lib/utils'

/**
 * Pick a face: one of twelve illustrations, your initial on one of six colours,
 * or a photo of your own.
 *
 * `value` is whatever is stored on the profile (a path or a data URL); the
 * picker highlights it and reports a new one through `onSelect`. It renders the
 * choices only — saving is the caller's, so the same picker serves both
 * onboarding and Settings.
 */
export function AvatarPicker({
  value,
  initial,
  busy = false,
  onSelect,
  onUpload,
  onRemove,
}: {
  value: string | null
  /** The letter drawn on the colour options — the person's first initial. */
  initial: string
  busy?: boolean
  onSelect: (avatar: string) => void
  onUpload?: (file: File) => void
  onRemove?: () => void
}) {
  const filePicker = useRef<HTMLInputElement>(null)

  return (
    <div className="space-y-5">
      <div>
        <p className="pb-2.5 text-[0.78rem] text-mist">Pick an avatar</p>
        <div className="grid grid-cols-6 gap-2.5">
          {ILLUSTRATIONS.map((art) => (
            <AvatarButton
              key={art.id}
              src={art.src}
              selected={value === art.src}
              onClick={() => onSelect(art.src)}
            />
          ))}
        </div>
      </div>

      <div>
        <p className="pb-2.5 text-[0.78rem] text-mist">Or your initial</p>
        <div className="grid grid-cols-6 gap-2.5">
          {AVATAR_COLORS.map((color) => {
            const src = initialAvatar(color.bg, color.fg, initial)
            return (
              <AvatarButton key={color.id} src={src} selected={value === src} onClick={() => onSelect(src)} />
            )
          })}
        </div>
      </div>

      {(onUpload || onRemove) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {onUpload && (
            <>
              <input
                ref={filePicker}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) onUpload(file)
                  event.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => filePicker.current?.click()}
                disabled={busy}
                className="flex items-center gap-2 rounded-full border border-white/12 px-3.5 py-2 text-[0.82rem] text-chalk outline-none transition-colors hover:border-white/25 hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-50"
              >
                {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Upload aria-hidden className="size-4" />}
                Upload a photo
              </button>
            </>
          )}
          {onRemove && value && (
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              className="rounded-full px-3 py-2 text-[0.82rem] text-mist outline-none transition-colors hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-50"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function AvatarButton({
  src,
  selected,
  onClick,
}: {
  src: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'relative aspect-square overflow-hidden rounded-full outline-none ring-2 transition-all duration-150 hover:scale-105 focus-visible:ring-signal',
        selected ? 'ring-signal' : 'ring-transparent hover:ring-white/20',
      )}
    >
      <img src={src} alt="" className="size-full bg-white/[0.06] object-cover" />
      {selected && (
        <span className="absolute inset-0 grid place-items-center bg-signal/40">
          <span className="grid size-5 place-items-center rounded-full bg-white text-signal">
            <Check aria-hidden className="size-3.5" />
          </span>
        </span>
      )}
    </button>
  )
}
