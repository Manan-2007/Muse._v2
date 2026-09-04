import { useRef, useState } from 'react'
import { Check, Disc3, Loader2, Monitor, Moon, Sun, Upload } from 'lucide-react'

import { useAuth } from '@/features/auth/AuthContext'
import { updateProfile } from '@/features/auth/api'
import { scratchEnabled, setScratchEnabled } from '@/features/music/useScratchSound'
import { getStoredTheme, setTheme, type Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'

/**
 * Settings — the person's own knobs.
 *
 * Appearance, the turntable's scratch sound, and the two things a profile is
 * made of: a photo and a name. Everything here is theirs to change and saves on
 * the spot; nothing touches the room or anyone else.
 */
export function SettingsPanel() {
  const { user, setUser } = useAuth()

  const [theme, setThemeState] = useState<Theme>(getStoredTheme())
  const [scratch, setScratch] = useState(scratchEnabled())

  const [name, setName] = useState(user?.name ?? '')
  const [savingName, setSavingName] = useState(false)
  const [nameSaved, setNameSaved] = useState(false)

  const [photoBusy, setPhotoBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const filePicker = useRef<HTMLInputElement>(null)

  const chooseTheme = (next: Theme) => {
    setThemeState(next)
    setTheme(next)
  }

  const toggleScratch = () => {
    const next = !scratch
    setScratch(next)
    setScratchEnabled(next)
  }

  const saveName = async () => {
    const value = name.trim()
    if (!value || value === user?.name || savingName) return
    setSavingName(true)
    setError(null)
    try {
      const updated = await updateProfile({ name: value })
      setUser(updated)
      setNameSaved(true)
      setTimeout(() => setNameSaved(false), 1500)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your name')
    } finally {
      setSavingName(false)
    }
  }

  /* Downscale the chosen image to a small square thumbnail before it is stored
     — a full-size photo has no business as a 32px avatar, and the row it lands
     in is capped. */
  const choosePhoto = async (file: File | undefined) => {
    if (!file) return
    setPhotoBusy(true)
    setError(null)
    try {
      const dataUrl = await downscale(file, 256)
      const updated = await updateProfile({ avatar: dataUrl })
      setUser(updated)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update your photo')
    } finally {
      setPhotoBusy(false)
    }
  }

  const removePhoto = async () => {
    setPhotoBusy(true)
    setError(null)
    try {
      const updated = await updateProfile({ avatar: null })
      setUser(updated)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove your photo')
    } finally {
      setPhotoBusy(false)
    }
  }

  const themes: { id: Theme; label: string; icon: typeof Sun }[] = [
    { id: 'light', label: 'Light', icon: Sun },
    { id: 'dark', label: 'Dark', icon: Moon },
    { id: 'system', label: 'System', icon: Monitor },
  ]

  return (
    <div className="space-y-8">
      {/* Profile. */}
      <section>
        <h3 className="pb-3 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-dusk">
          Profile
        </h3>
        <div className="flex items-center gap-4">
          <span className="relative size-16 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-signal to-signal-deep ring-1 ring-inset ring-white/15">
            {user?.avatar ? (
              <img src={user.avatar} alt="" className="size-full object-cover" />
            ) : (
              <span className="grid size-full place-items-center text-[1.4rem] font-semibold text-white">
                {user?.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            {photoBusy && (
              <span className="absolute inset-0 grid place-items-center bg-black/50">
                <Loader2 aria-hidden className="size-5 animate-spin text-white" />
              </span>
            )}
          </span>
          <div className="flex flex-wrap gap-2">
            <input
              ref={filePicker}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                void choosePhoto(event.target.files?.[0])
                event.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => filePicker.current?.click()}
              disabled={photoBusy}
              className="flex items-center gap-2 rounded-full border border-white/12 px-3.5 py-2 text-[0.82rem] text-chalk outline-none transition-colors hover:border-white/25 hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-50"
            >
              <Upload aria-hidden className="size-4" />
              Change photo
            </button>
            {user?.avatar && (
              <button
                type="button"
                onClick={() => void removePhoto()}
                disabled={photoBusy}
                className="rounded-full px-3 py-2 text-[0.82rem] text-mist outline-none transition-colors hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
        </div>

        <label className="mt-5 block">
          <span className="text-[0.8rem] text-mist">Display name</span>
          <div className="mt-1.5 flex gap-2">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={40}
              className="h-11 min-w-0 flex-1 rounded-full border border-white/12 bg-white/[0.04] px-4 text-[0.9rem] text-chalk outline-none transition-colors placeholder:text-dusk focus:border-white/25"
            />
            <button
              type="button"
              onClick={() => void saveName()}
              disabled={savingName || !name.trim() || name.trim() === user?.name}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-chalk px-4 text-[0.82rem] font-medium text-void outline-none transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-40 disabled:hover:scale-100"
            >
              {savingName ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : nameSaved ? (
                <Check aria-hidden className="size-4" />
              ) : null}
              {nameSaved ? 'Saved' : 'Save'}
            </button>
          </div>
        </label>
      </section>

      {/* Appearance. */}
      <section>
        <h3 className="pb-3 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-dusk">
          Appearance
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {themes.map((entry) => {
            const Icon = entry.icon
            const active = theme === entry.id
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => chooseTheme(entry.id)}
                aria-pressed={active}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-xl border px-3 py-4 outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
                  active
                    ? 'border-signal/50 bg-signal/10 text-chalk'
                    : 'border-white/12 bg-white/[0.03] text-mist hover:border-white/25 hover:text-chalk',
                )}
              >
                <Icon aria-hidden className={cn('size-5', active && 'text-signal-bright')} />
                <span className="text-[0.82rem] font-medium">{entry.label}</span>
              </button>
            )
          })}
        </div>
      </section>

      {/* Sound. */}
      <section>
        <h3 className="pb-3 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-dusk">
          Sound
        </h3>
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-mist">
            <Disc3 aria-hidden className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[0.9rem] font-medium text-chalk">Turntable scratch</span>
            <span className="block text-[0.78rem] leading-relaxed text-dusk">
              The zig-zig rasp when you drag the record to scrub.
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={scratch}
            onClick={toggleScratch}
            className={cn(
              'relative h-6 w-11 shrink-0 rounded-full outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
              scratch ? 'bg-signal' : 'bg-white/15',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 size-5 rounded-full bg-white transition-transform',
                scratch ? 'translate-x-[1.35rem]' : 'translate-x-0.5',
              )}
            />
          </button>
        </div>
      </section>

      {error && (
        <p role="alert" className="text-[0.82rem] text-signal-bright">
          {error}
        </p>
      )}
    </div>
  )
}

/** Read an image file and return a square, downscaled JPEG data URL. */
function downscale(file: File, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('That file is not an image'))
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Could not process that image'))
          return
        }
        /* Cover-crop to a square so faces aren't squashed. */
        const scale = Math.max(size / img.width, size / img.height)
        const w = img.width * scale
        const h = img.height * scale
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}
