import { Box3, Vector3, type Object3D } from 'three'

/**
 * Sizing a rigged character, shared by the hub stage and the picker preview.
 *
 * Both have to solve the same two problems before a downloaded `.glb` can be
 * framed: how tall is it really, and is it even standing up.
 */

/**
 * The character's real extents.
 *
 * Deliberately measured from **bone positions**, not from geometry. A skinned
 * mesh's `geometry.boundingBox` describes its bind pose in bind space, and says
 * nothing about the scale the armature actually renders it at — a Mixamo export
 * can report a 4cm box and draw a 4m character. Bones carry the live world
 * transforms, so they are the only honest ruler here.
 *
 * Falls back to the geometry box for static, boneless models.
 */
export function measure(root: Object3D): Box3 {
  root.updateWorldMatrix(true, true)

  const box = new Box3()
  const point = new Vector3()
  let bones = 0

  root.traverse((node) => {
    if ((node as { isBone?: boolean }).isBone) {
      bones += 1
      box.expandByPoint(point.setFromMatrixPosition(node.matrixWorld))
    }
  })

  if (bones > 2) return box
  return new Box3().setFromObject(root)
}

/**
 * Stand the model up if it arrived lying down.
 *
 * FBX is Z-up, and a Mixamo character exported through Blender routinely keeps
 * that convention — which shows up as a vertical extent on Z and a Y extent
 * that is only body thickness.
 */
export function standUp(root: Object3D) {
  const size = measure(root).getSize(new Vector3())
  if (size.y < size.x * 0.6 && size.y < size.z * 0.6) {
    root.rotation.x = -Math.PI / 2
  }
}
