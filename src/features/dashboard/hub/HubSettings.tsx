import { Suspense, lazy, useState } from 'react'
import { Shuffle } from 'lucide-react'

import { ModelBoundary } from '@/components/background/ModelBoundary'
import { Button } from '@/components/ui/button'
import { PickerPanel, type PickerKind } from '@/features/dashboard/hub/PickerPanel'
import { groundFor, type HubPreferences } from '@/features/dashboard/hub/usePreferences'
import { ROSTER, type Character } from '@/lib/characters'
import { SCENES, type Scene } from '@/lib/scenes'

const CharacterPreviewCanvas = lazy(
  () => import('@/features/dashboard/hub/CharacterPreviewCanvas'),
)

function Empty({ what, folder, naming }: { what: string; folder: string; naming: string }) {
  return (
    <div className="rounded-card border border-dashed border-white/15 bg-white/[0.02] px-5 py-7">
      <p className="font-display text-[0.95rem] font-semibold text-chalk">No {what} yet</p>
      <p className="mt-2 text-[0.82rem] leading-relaxed text-mist">
        Drop files into <code className="font-mono text-[0.78rem] text-chalk">{folder}</code> and
        they show up here on the next reload — nothing to register.
      </p>
      <p className="mt-2 text-[0.78rem] leading-relaxed text-dusk">{naming}</p>
    </div>
  )
}

/** A stand-in with the right silhouette, shown while the model streams in. */
function Waiting() {
  return (
    <span className="grid size-full place-items-end justify-center pb-2">
      <span className="glass h-[72%] w-[26%] animate-pulse rounded-t-full ring-1 ring-inset ring-white/20" />
    </span>
  )
}

/**
 * What is currently chosen, and the way to change it.
 *
 * Just the one it is, not the whole set — browsing happens in the picker that
 * opens below. A panel this narrow can show a grid of thumbnails or it can
 * show them large enough to tell apart, and the second is more useful.
 */
function Current({
  label,
  name,
  detail,
  onChange,
  children,
}: {
  label: string
  name: string
  detail?: string
  onChange: () => void
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-card border border-white/[0.1]">
      <span className="relative block aspect-[16/10] w-full overflow-hidden bg-deep">
        {children}
      </span>

      <span className="flex items-center gap-3 px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[0.65rem] uppercase tracking-[0.16em] text-dusk">{label}</span>
          <span className="mt-0.5 block truncate font-display text-[0.95rem] font-semibold text-chalk">
            {name}
          </span>
          {detail && <span className="mt-0.5 block truncate text-[0.72rem] text-mist">{detail}</span>}
        </span>
        <Button variant="outline" size="sm" onClick={onChange}>
          Change
        </Button>
      </span>
    </div>
  )
}

function ScenePreview({ scene }: { scene: Scene }) {
  if (scene.layers.length === 0) {
    return (
      <span className="grid size-full place-items-center bg-[radial-gradient(120%_90%_at_50%_120%,var(--color-grade-blue),var(--color-void))]">
        <span className="text-[0.65rem] uppercase tracking-[0.16em] text-dusk">video</span>
      </span>
    )
  }

  /* Every plane stacked, so it previews the composite rather than just sky. */
  return (
    <>
      {scene.layers.map((layer) => (
        <span
          key={layer.name}
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${layer.url})` }}
        />
      ))}
    </>
  )
}

function CharacterPreview({ character }: { character: Character }) {
  if (character.glb) {
    return (
      <span className="absolute inset-0">
        <ModelBoundary fallback={<Waiting />}>
          <Suspense fallback={<Waiting />}>
            <CharacterPreviewCanvas url={character.glb} />
          </Suspense>
        </ModelBoundary>
      </span>
    )
  }

  if (character.png) {
    return (
      <span
        className="absolute inset-0 bg-contain bg-bottom bg-no-repeat"
        style={{ backgroundImage: `url(${character.png})` }}
      />
    )
  }

  return <Waiting />
}

/**
 * How this user dresses their hub.
 *
 * Backdrop and character are the only two settings here because they are the
 * only two that currently change anything real. Room-level settings belong to a
 * room, not to you, so they are not in this panel.
 */
export function HubSettings({
  preferences,
  onChange,
  activeCharacterId,
}: {
  preferences: HubPreferences
  onChange: (patch: Partial<HubPreferences>) => void
  /**
   * Who is *actually* standing in the hub. Not the same as the stored
   * preference — with nothing chosen yet the hub picks one from your user id,
   * and the picker has to agree with what you can see behind it.
   */
  activeCharacterId?: string
}) {
  const [picking, setPicking] = useState<PickerKind | null>(null)
  const activeSceneId = preferences.sceneId ?? SCENES[0]?.id
  const scene = SCENES.find((entry) => entry.id === activeSceneId)
  const character = ROSTER.find((entry) => entry.id === activeCharacterId) ?? ROSTER[0]

  return (
    <div className="flex flex-col gap-9">
      <section>
        <h3 className="font-display text-[1.05rem] font-semibold tracking-[-0.02em] text-chalk">
          Backdrop
        </h3>
        <p className="mt-1.5 text-[0.82rem] leading-relaxed text-mist">
          Where you stand. Scenes with separate depth planes get real parallax.
        </p>

        <div className="mt-4">
          {!scene ? (
            <Empty
              what="scenes"
              folder="src/assets/scenes/"
              naming="Numbered files like 1.png work. Name them lake-far.png, lake-mid.png, lake-near.png to get three depth planes instead of one."
            />
          ) : (
            <Current
              label="Backdrop"
              name={scene.label}
              detail={
                scene.video
                  ? 'Moving backdrop'
                  : scene.layers.length > 1
                    ? `${scene.layers.length} depth planes`
                    : 'Still backdrop'
              }
              onChange={() => setPicking((current) => (current === 'scene' ? null : 'scene'))}
            >
              <ScenePreview scene={scene} />
            </Current>
          )}

          {picking === 'scene' && (
            <div className="mt-3">
              <PickerPanel
                kind="scene"
                onPick={(id) => {
                  onChange({ sceneId: id })
                  setPicking(null)
                }}
              />
            </div>
          )}
        </div>

        {activeSceneId && (
          <label className="mt-5 block">
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-[0.85rem] font-medium text-chalk">Ground line</span>
              <span className="font-mono text-[0.75rem] text-dusk">
                {Math.round(groundFor(preferences, activeSceneId) * 100)}%
              </span>
            </span>
            <span className="mt-1 block text-[0.78rem] leading-relaxed text-mist">
              Where the floor is in this photo. Slide until your character's feet land on it.
            </span>
            <input
              type="range"
              min={50}
              max={95}
              step={1}
              value={Math.round(groundFor(preferences, activeSceneId) * 100)}
              onChange={(event) =>
                onChange({
                  ground: {
                    ...preferences.ground,
                    [activeSceneId]: Number(event.target.value) / 100,
                  },
                })
              }
              className="mt-3 w-full accent-signal"
            />
          </label>
        )}
      </section>

      <section>
        <h3 className="font-display text-[1.05rem] font-semibold tracking-[-0.02em] text-chalk">
          Your character
        </h3>
        <p className="mt-1.5 text-[0.82rem] leading-relaxed text-mist">
          Who stands in the middle. Rigged characters breathe and turn toward you.
        </p>

        <div className="mt-4">
          {!character ? (
            <Empty
              what="characters"
              folder="src/assets/characters/"
              naming="Numbered files like 1.glb work. A matching 1.png is optional — it covers the moment before the model loads."
            />
          ) : (
            <>
              <Current
                label="Character"
                name={character.label}
                detail={character.glb ? 'Rigged 3D' : 'Flat cutout'}
                onChange={() =>
                  setPicking((current) => (current === 'character' ? null : 'character'))
                }
              >
                <CharacterPreview character={character} />
              </Current>

              {picking === 'character' && (
                <div className="mt-3">
                  <PickerPanel
                    kind="character"
                    onPick={(id) => {
                      onChange({ characterId: id })
                      setPicking(null)
                    }}
                  />
                </div>
              )}

              {ROSTER.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const others = ROSTER.filter((entry) => entry.id !== character.id)
                    const pick = others[Math.floor(Math.random() * others.length)]
                    if (pick) onChange({ characterId: pick.id })
                  }}
                  className="mt-3 flex items-center gap-2 text-[0.8rem] text-mist outline-none transition-colors hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                >
                  <Shuffle aria-hidden className="size-3.5" />
                  Surprise me
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  )
}
