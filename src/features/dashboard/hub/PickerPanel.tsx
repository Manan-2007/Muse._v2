import {Suspense, useEffect, useState} from 'react'
import { Loader2 } from 'lucide-react'

import { ROSTER } from '@/lib/characters'
import { SCENES } from '@/lib/scenes'
import type { InfiniteMenuItem } from '@/vendor/InfiniteMenu'
import { lazyChunk } from '@/lib/lazyChunk'

const InfiniteMenu = lazyChunk(() => import('@/vendor/InfiniteMenu'))

export type PickerKind = 'character' | 'scene'

/** A labelled gradient tile, for anything with no picture of its own. */
function fallbackTile(label: string) {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const wash = ctx.createLinearGradient(0, 0, size, size)
  wash.addColorStop(0, '#241a3a')
  wash.addColorStop(1, '#3a1220')
  ctx.fillStyle = wash
  ctx.fillRect(0, 0, size, size)

  ctx.fillStyle = 'rgba(250,250,250,0.82)'
  ctx.font = '600 44px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label.slice(0, 14), size / 2, size / 2)

  return canvas.toDataURL('image/png')
}

/**
 * Builds the tiles for one kind of picker.
 *
 * Scenes already are pictures. Characters are `.glb` files with no artwork at
 * all, so their tiles are rendered from the models themselves — which is what
 * lets the roster grow by dropping a file into a folder, with nothing else to
 * supply and nothing to keep in step.
 */
function usePickerItems(kind: PickerKind) {
  const [items, setItems] = useState<InfiniteMenuItem[] | null>(null)

  useEffect(() => {
    let cancelled = false

    async function build() {
      if (kind === 'scene') {
        const tiles = SCENES.map<InfiniteMenuItem>((scene) => ({
          id: scene.id,
          title: scene.label,
          description: scene.video
            ? 'Moving backdrop'
            : scene.layers.length > 1
              ? `${scene.layers.length} depth planes`
              : 'Still backdrop',
          image: scene.layers[0]?.url ?? fallbackTile(scene.label),
        }))
        if (!cancelled) setItems(tiles)
        return
      }

      const { characterThumbnail } = await import('@/features/dashboard/hub/thumbnail')

      const tiles = await Promise.all(
        ROSTER.map(async (character) => {
          const rendered = character.glb ? await characterThumbnail(character.glb) : null
          return {
            id: character.id,
            title: character.label,
            description: character.glb ? 'Rigged 3D' : 'Flat cutout',
            image: rendered ?? character.png ?? fallbackTile(character.label),
          } satisfies InfiniteMenuItem
        }),
      )

      if (!cancelled) setItems(tiles)
    }

    void build()
    return () => {
      cancelled = true
    }
  }, [kind])

  return items
}

/**
 * Spin-to-browse, inline in the settings panel.
 *
 * Sized to the panel rather than taking the screen: choosing a backdrop while
 * you can still see the backdrop is the point, and a full-screen picker hides
 * the thing being changed. The sphere is small here, so the labels above it do
 * the identifying and the tiles only have to be recognisable.
 */
export function PickerPanel({
  kind,
  onPick,
}: {
  kind: PickerKind
  onPick: (id: string) => void
}) {
  const items = usePickerItems(kind)

  if (items === null) {
    return (
      <div className="grid h-64 place-items-center rounded-card border border-white/[0.08] bg-white/[0.02]">
        <span className="flex items-center gap-2.5 text-[0.8rem] text-mist">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          {kind === 'character' ? 'Rendering the roster…' : 'Loading backdrops…'}
        </span>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-white/15 bg-white/[0.02] px-5 py-8 text-center text-[0.82rem] leading-relaxed text-mist">
        Nothing to choose from yet.
      </p>
    )
  }

  return (
    <div className="picker-compact relative h-80 overflow-hidden rounded-card border border-white/[0.08] bg-[radial-gradient(120%_90%_at_50%_0%,var(--color-grade-violet),var(--color-void)_70%)]">
      <Suspense fallback={null}>
        <InfiniteMenu
          items={items}
          /* Barely pulled back — enough to keep the outer discs off the edges
             without shrinking them into specks in a panel this size. */
          scale={1.08}
          selectLabel={kind === 'character' ? 'Be this one' : 'Stand here'}
          onSelect={(item) => onPick(item.id)}
        />
      </Suspense>
    </div>
  )
}
