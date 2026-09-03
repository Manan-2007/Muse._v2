import {Suspense} from 'react'

import { ModelBoundary } from '@/components/background/ModelBoundary'
import { FlatCharacter } from '@/features/dashboard/hub/FlatCharacter'
import { Nameplate, type PlateStatus } from '@/features/dashboard/hub/Nameplate'
import type { PartyMember } from '@/features/dashboard/hub/CharacterCanvas'
import type { PointerTilt } from '@/hooks/usePointerTilt'
import { usePageVisible } from '@/hooks/usePageVisible'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { hasRiggedCharacters, type Character } from '@/lib/characters'
import { lazyChunk } from '@/lib/lazyChunk'

const CharacterCanvas = lazyChunk(() => import('@/features/dashboard/hub/CharacterCanvas'))

export type HubMember = {
  id: string
  name: string
  status: PlateStatus
  owner: boolean
  you: boolean
  character?: Character
}

/**
 * Stand-in for a member with no artwork yet — a lit glass figure rather than a
 * gap. The hub has to be a finished screen before the roster exists, the same
 * way the hero's plinth stands on its own without a model.
 */
function GlassFigure({ dim = false }: { dim?: boolean }) {
  return (
    <div className="relative flex h-full w-full items-end justify-center">
      <div
        aria-hidden
        className="absolute bottom-[3%] h-5 w-[46%] rounded-[50%] bg-[radial-gradient(ellipse,rgb(0_0_0/0.55),transparent_72%)] blur-[6px]"
      />
      <div
        className={[
          'relative flex h-[76%] w-[34%] flex-col items-center gap-[3%]',
          dim ? 'opacity-45' : 'opacity-80',
        ].join(' ')}
      >
        <div className="glass aspect-square w-[38%] shrink-0 animate-float-slow rounded-full ring-1 ring-inset ring-white/25" />
        <div className="glass w-full flex-1 rounded-[42%_42%_28%_28%/22%_22%_10%_10%] ring-1 ring-inset ring-white/20" />
      </div>
    </div>
  )
}

/**
 * Everyone standing in the hub.
 *
 * One 3D canvas holds the whole party rather than one canvas each — a WebGL
 * context per person would be four contexts for four friends, and browsers cap
 * how many a tab may hold. Members whose character has no rigged model are
 * drawn flat in the same row instead.
 */
export function CharacterParty({
  members,
  tilt,
  ground,
  insetRight = 0,
  covered = false,
}: {
  members: HubMember[]
  tilt: PointerTilt
  /** The scene's ground line, as a fraction of viewport height. */
  ground: number
  /** Rem of space the side panel is occupying, so the party stays centred. */
  insetRight?: number
  /**
   * Whether a full-screen activity is sitting on top of the hub.
   *
   * The party stays mounted underneath — leaving Watch should put you back in
   * the room you left, not rebuild it — but there is nothing to be gained by
   * animating a scene the stage is completely covering.
   */
  covered?: boolean
}) {
  const reduced = usePrefersReducedMotion()
  const visible = usePageVisible()

  /*
   * Frozen whenever nobody can see it: behind a stage, in a backgrounded tab,
   * or for someone who asked for less motion. The canvas drops to R3F's
   * `demand` loop, so it holds its last frame instead of rendering new ones —
   * which is the whole cost of the scene, and it comes back the instant the
   * hub is on top again.
   */
  const still = reduced || covered || !visible

  const rigged: PartyMember[] = members
    .filter((member) => member.character?.glb)
    .map((member) => ({ id: member.id, name: member.name, url: member.character!.glb! }))

  /* The 3D layer covers the whole stage, so flats can only be laid out beside
     it when nobody is rigged. Mixing the two in one row would need the DOM to
     track projected 3D positions — not worth it while a roster is either all
     rigged or all flat in practice. */
  const useCanvas = hasRiggedCharacters && rigged.length > 0
  const showFlats = !useCanvas

  return (
    <div
      className="pointer-events-none absolute inset-y-0 left-0 transition-[right] duration-500 ease-glass"
      style={{ right: `${insetRight}rem` }}
    >
      {/* The stage's floor is pinned to the scene's ground line, not to the
          bottom of the viewport — that is what stops the party hovering over
          water in one backdrop and sinking into a path in another. */}
      <div
        className="absolute inset-x-0 mx-auto flex max-w-[90rem] flex-col items-center px-6 lg:px-[19rem]"
        style={{
          bottom: `${(1 - ground) * 100}%`,
          height: `min(74svh, calc(${ground * 100}% - 2rem))`,
        }}
      >
        <div className="relative h-full w-full">
          {useCanvas ? (
            <ModelBoundary fallback={<GlassFigure />}>
              <Suspense fallback={<GlassFigure />}>
                <div className="pointer-events-auto absolute inset-0">
                  <CharacterCanvas members={rigged} tilt={tilt} still={still} />
                </div>
              </Suspense>
            </ModelBoundary>
          ) : null}

          {showFlats && (
            <div className="flex h-full items-end justify-center gap-4 md:gap-8">
              {members.map((member, index) => (
                <div
                  key={member.id}
                  className="flex h-full min-w-0 flex-1 items-end justify-center"
                  style={{ maxWidth: '18rem' }}
                >
                  {member.character?.png ? (
                    <div
                      className={member.status === 'away' ? 'h-full opacity-45' : 'h-full'}
                      style={{ height: '100%' }}
                    >
                      <FlatCharacter
                        src={member.character.png}
                        alt={member.name}
                        tilt={tilt}
                        delay={index * 0.7}
                      />
                    </div>
                  ) : (
                    <GlassFigure dim={member.status === 'away'} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Plates sit just below the ground line, so they read as labels on the
          floor by each person's feet rather than as floating chrome. */}
      <div
        className="absolute inset-x-0 mx-auto flex max-w-[90rem] items-start justify-center gap-4 px-6 md:gap-8 lg:px-[19rem]"
        /* Clamped off the bottom edge: a high ground line would otherwise push
           the plates into the room chip and voice control down there. */
        style={{ top: `min(calc(${ground * 100}% + 0.85rem), calc(100% - 9rem))` }}
      >
        {members.map((member) => (
          <div
            key={member.id}
            className="flex min-w-0 flex-1 justify-center"
            style={{ maxWidth: '18rem' }}
          >
            <Nameplate
              name={member.name}
              status={member.status}
              owner={member.owner}
              you={member.you}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
