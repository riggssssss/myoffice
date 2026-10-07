import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/**
 * iMac + keyboard + mouse set (user-supplied FBX, converted to GLB). Model units are
 * centimetres, front faces +z, everything rests on a surface at y = 1.9.
 */
const MODEL = {
  surfaceY: 1.9,
  /** Centre of the whole set (x) and of its depth (z), so it can be centred on a desk. */
  centerX: -3.2,
  centerZ: -1.05,
  /** Front glass of the display: black bezel, and the lit screen inside it. */
  glass: { x: -3.2, y: 35.6, w: 62.4, h: 36, z: -12.45 },
  screen: { x: -3.2, y: 35.6, w: 58, h: 32, z: -12.38 },
  width: 63.2,
};

/** Desk-sized: the display ends up about as wide as the old monitor. */
const SCALE = 0.95 / MODEL.width;

export async function loadComputer(): Promise<THREE.Object3D> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/imac.glb`);
  // The FBX came without materials: anodised aluminium body, white mouse.
  const aluminium = new THREE.MeshStandardMaterial({ color: '#cfd2d6', roughness: 0.38, metalness: 0.15 });
  const mouse = new THREE.MeshStandardMaterial({ color: '#f3f3f1', roughness: 0.3 });
  // Shared by every desk: never disposed with one of them.
  aluminium.userData.shared = mouse.userData.shared = true;
  gltf.scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.material = o.name === 'Box002' ? mouse : aluminium;
      o.castShadow = true;
      o.receiveShadow = true;
      o.userData.shared = true;
    }
  });
  return gltf.scene;
}

/** One desk's set, in desk-local space: screen facing the chair (local -z), on the desk top. */
export function placeComputer(template: THREE.Object3D, screen: THREE.Material, deskTopY: number): THREE.Group {
  const inner = template.clone(true);
  inner.position.set(-MODEL.centerX, -MODEL.surfaceY, -MODEL.centerZ);

  const glassMat = new THREE.MeshStandardMaterial({ color: '#0d0d0e', roughness: 0.12, metalness: 0.2 });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(MODEL.glass.w, MODEL.glass.h), glassMat);
  glass.position.set(MODEL.glass.x, MODEL.glass.y, MODEL.glass.z);
  const lit = new THREE.Mesh(new THREE.PlaneGeometry(MODEL.screen.w, MODEL.screen.h), screen);
  lit.position.set(MODEL.screen.x, MODEL.screen.y, MODEL.screen.z);
  inner.add(glass, lit);

  const set = new THREE.Group();
  set.add(inner);
  set.scale.setScalar(SCALE);
  set.rotation.y = Math.PI;
  set.position.y = deskTopY;
  return set;
}
