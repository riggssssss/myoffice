import * as THREE from 'three';
import {
  CHAIR_DEFAULTS,
  CHAIR_FRAMES,
  chairStyle,
  chairStyleFor,
  deskStyle,
  windowStyle,
  type ChairModel,
  type ChairPack,
  type ChairStyle,
  type DeskModel,
  type ItemKind,
  type WindowModel,
} from '../sim/layout';
import { buildItem, buildWindow, deskObject, placeChair, type Assets, type MatFn, type RoomLook } from './furniture';
import { LIGHT, Materials } from './palette';

/**
 * Pictures of the real models for the editor's pickers. The panel asks for one by spec; the
 * scene renders queued ones a couple per frame and the panel redraws as they arrive.
 */
export type ThumbSpec =
  | { type: 'item'; kind: ItemKind }
  | { type: 'desk'; model: DeskModel }
  | { type: 'chair'; pack: ChairPack; model: ChairModel }
  | { type: 'window'; model: WindowModel };

const cache = new Map<string, string>();
const queue = new Map<string, ThumbSpec>();
const listeners = new Set<() => void>();
let version = 0;

/** A pack's colours carried over to another model (falling back where that model has no such finish). */
function chairFor(pack: ChairPack, model: ChairModel): ChairStyle {
  const cur = chairStyle(pack);
  if (cur.model === model) return cur;
  const fabric = cur.fabric === 'theme' && model !== 'classic' ? CHAIR_DEFAULTS[model].fabric : cur.fabric;
  const frame = CHAIR_FRAMES[model].some((f) => f.id === cur.frame) ? cur.frame : CHAIR_DEFAULTS[model].frame;
  return chairStyleFor({ model, fabric, frame });
}

function look(): RoomLook {
  return { desk: deskStyle(), chairs: { desk: chairStyle('desk'), meeting: chairStyle('meeting') }, windows: windowStyle() };
}

/** Cache key: the spec plus whatever of the current look shows in the picture. */
function keyOf(spec: ThumbSpec): string {
  const l = look();
  const c = (s: ChairStyle) => `${s.model}/${s.fabric}/${s.frame}`;
  switch (spec.type) {
    case 'item': {
      const extra =
        spec.kind === 'desk'
          ? `${l.desk.model}/${l.desk.top}/${l.desk.frame}|${c(l.chairs.desk)}`
          : spec.kind === 'meeting'
            ? c(l.chairs.meeting)
            : spec.kind === 'window'
              ? `${l.windows.model}/${l.windows.frame}`
              : '';
      return `${version}|item|${spec.kind}|${extra}`;
    }
    case 'desk':
      return `${version}|desk|${spec.model}|${l.desk.top}/${l.desk.frame}`;
    case 'chair':
      return `${version}|chair|${c(chairFor(spec.pack, spec.model))}`;
    case 'window':
      return `${version}|window|${spec.model}|${l.windows.frame}`;
  }
}

/** Data URL of the picture, or null while it's being made (it's queued). */
export function thumb(spec: ThumbSpec): string | null {
  const key = keyOf(spec);
  const url = cache.get(key);
  if (url) return url;
  queue.set(key, spec);
  return null;
}

export function onThumbs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Models finished loading: pictures made with stand-ins are stale. */
export function setThumbVersion(v: number): void {
  if (v === version) return;
  version = v;
  for (const fn of listeners) fn();
}

/** Renders queued pictures in a small offscreen canvas of its own. */
export class ThumbRenderer {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(24, 1, 0.05, 100);
  private mats = new Materials();
  private m: MatFn = (slot, extra) => this.mats.get(slot, LIGHT, extra);

  constructor(private assets: () => Assets) {
    this.scene.add(new THREE.HemisphereLight('#fff6e8', '#c9bba3', 2.2));
    const sun = new THREE.DirectionalLight('#fff4e2', 2.4);
    sun.position.set(4, 7, 5);
    this.scene.add(sun);
  }

  private build(spec: ThumbSpec): THREE.Object3D {
    const a = this.assets();
    const g = new THREE.Group();
    switch (spec.type) {
      case 'item':
        return buildItem({ id: 'thumb', kind: spec.kind, x: 0, z: 0, rot: 0, slot: 0, decor: 'plant' }, this.m, a, look()).obj;
      case 'desk':
        g.add(deskObject({ ...deskStyle(), model: spec.model }, this.m, a));
        return g;
      case 'chair':
        g.add(placeChair(chairFor(spec.pack, spec.model), spec.pack, this.m, a));
        return g;
      case 'window':
        buildWindow(g, a, { ...windowStyle(), model: spec.model });
        return g;
    }
  }

  /** Render up to `max` queued pictures. Returns whether any were made. */
  process(max = 2): boolean {
    if (!queue.size) return false;
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(192, 192, false);
    }
    let made = 0;
    for (const [key, spec] of queue) {
      queue.delete(key);
      if (cache.has(key) || !key.startsWith(`${version}|`)) continue;
      const obj = this.build(spec);
      this.scene.add(obj);
      const box = new THREE.Box3().setFromObject(obj);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const dir = new THREE.Vector3(0.75, 0.62, 1).normalize();
      if (spec.type === 'chair') dir.set(0.8, 0.5, 1).normalize();
      const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 0.98;
      this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
      this.camera.lookAt(sphere.center);
      this.renderer.render(this.scene, this.camera);
      cache.set(key, this.renderer.domElement.toDataURL('image/png'));
      this.scene.remove(obj);
      obj.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        if (!o.userData.shared) o.geometry.dispose();
        for (const mat of Array.isArray(o.material) ? o.material : [o.material]) if (!mat.userData.shared) mat.dispose();
      });
      if (++made >= max) break;
    }
    if (made) for (const fn of listeners) fn();
    return made > 0;
  }
}
