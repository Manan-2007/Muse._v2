import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'

import { useAuth } from '@/features/auth/AuthContext'
import { updateProfile } from '@/features/auth/api'
import { AvatarPicker } from '@/features/settings/AvatarPicker'
import { downscaleImage } from '@/features/settings/downscaleImage'

/**
 * Settings — the person's own knobs.
 *
 * The two things a profile is made of: a face and a name. Everything here is
 * theirs to change and saves on the spot; nothing touches the room or anyone
 * else.
 */
export function SettingsPanel() {
  const { user, setUser } = useAuth()

  const [name, setName] = useState(user?.name ?? '')
  const [savingName, setSavingName] = useState(false)
  const [nameSaved, setNameSaved] = useState(false)

  const [photoBusy, setPhotoBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const saveAvatar = async (avatar: string | null) => {
    setPhotoBusy(true)
    setError(null)
    try {
      const updated = await updateProfile({ avatar })
      setUser(updated)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update your avatar')
    } finally {
      setPhotoBusy(false)
    }
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

  const choosePhoto = async (file: File) => {
    setPhotoBusy(true)
    setError(null)
    try {
      const dataUrl = await downscaleImage(file, 256)
      await saveAvatar(dataUrl)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update your photo')
      setPhotoBusy(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Profile. */}
      <section>
        <h3 className="pb-3 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-dusk">
          Profile
        </h3>
        <div className="flex items-center gap-4 pb-5">
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
          <span className="min-w-0">
            <span className="block text-[0.95rem] font-semibold text-chalk">{user?.name}</span>
            <span className="block truncate text-[0.78rem] text-dusk">{user?.email}</span>
          </span>
        </div>

        <AvatarPicker
          value={user?.avatar ?? null}
          initial={user?.name.slice(0, 1) ?? 'M'}
          busy={photoBusy}
          onSelect={(avatar) => void saveAvatar(avatar)}
          onUpload={(file) => void choosePhoto(file)}
          onRemove={() => void saveAvatar(null)}
        />

        <label className="mt-6 block">
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

      {error && (
        <p role="alert" className="text-[0.82rem] text-signal-bright">
          {error}
        </p>
      )}
    </div>
  )
}
