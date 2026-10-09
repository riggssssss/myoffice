import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  DOOR_H,
  DOOR_W,
  ENTRANCE,
  KINDS,
  onLine,
  roomGeometry,
  roomOf,
  WALL_H,
  WALL_T,
  wallOf,
  windowModel,
  type FloorKind,
  type BenchModel,
  type GroundKind,
  type LampModel,
  type Item,
  type OuterWall,
  type P,
  type Room,
  type WallKind,
  type WallLine,
  type WindowStyle,
} from '../sim/layout';
import { floorBump, floorTexture, WALL_PAINT, wallTexture } from './floors';
import { grainSheen } from './wood';
import { buildItem, setLampGlow, type Assets, type MatFn, type RoomLook } from './furniture';
import { Materials, type ScenePalette } from './palette';
import { groundMesh, setRoomOpenings, type Opening as LitOpening } from './ground';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { buildLandscape, type Landscape } from './landscape';
import { groundShadow, type ShadowBlock } from './textures';

const HALF = WALL_T / 2;
/** Warm lighting (about 3000 K, like home bulbs) and its full strength. */
const CEILING_LIGHT = '#ffd8a6';
const CEILING_INTENSITY = 14;
/** How bright a lit room's window is, seen from outside (area light, per unit of interior light). */
const WINDOW_GLOW = 6;
/** The same through a wall that has dropped out of the way (bigger, so less per square metre). */
const WALL_GLOW = 1.6;
let rectLightsReady = false;
/** The desk lamps' strength in the palette when fully on (see DARK.lampIntensity). */
const LAMP_FULL = 5;
const NIGHT_FLOOR = new THREE.Color('#6f675d');
const DAY_FLOOR = new THREE.Color('#ffffff');
/** A wall turned away from the camera drops all the way: only the slab's edge stays. */
const CUT_OUT = 0;
/** A partition between rooms that would hide one of them drops to half height. */
const CUT_LOW = 1.0 / WALL_H;

/** Free what one object owns; shared model geometry and palette materials stay. */
function dispose(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    // Its per-copy buffers (positions, colours) go even when the shape is shared.
    if (o instanceof THREE.InstancedMesh) o.dispose();
    if (!o.userData.shared) o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (!m.userData.shared) m.dispose();
  });
}

/** Every attribute as plain floats (models come quantized or interleaved), ready to merge. */
function plainAttributes(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  if (g.index) out.setIndex(Array.from(g.index.array));
  for (const [name, a] of Object.entries(g.attributes)) {
    const n = a.itemSize;
    const arr = new Float32Array(a.count * n);
    for (let i = 0; i < a.count; i++) {
      arr[i * n] = a.getX(i);
      if (n > 1) arr[i * n + 1] = a.getY(i);
      if (n > 2) arr[i * n + 2] = a.getZ(i);
      if (n > 3) arr[i * n + 3] = a.getW(i);
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, n));
  }
  return out;
}

/**
 * Fold the parts of one object that never move and share a material into a single mesh each:
 * a shelf of books, desk legs, lamp parts each cost one draw (and one more for the shadows)
 * instead of dozens. `keep` (the door's hinge) and anything tagged for picking stay as they are.
 */
function mergeStatic(root: THREE.Object3D, keep?: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const groups = new Map<string, THREE.Mesh[]>();
  const kept = new Set<THREE.Object3D>();
  keep?.traverse((o) => kept.add(o));
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || o instanceof THREE.SkinnedMesh) return;
    if (kept.has(o) || Array.isArray(o.material) || o.morphTargetInfluences || o.userData.calendar) return;
    // Mirrored parts would come out inside out.
    if (o.matrixWorld.determinant() < 0) return;
    const g = o.geometry;
    const attrs = Object.keys(g.attributes).map((k) => `${k}${g.attributes[k].itemSize}`).sort().join();
    const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${o.renderOrder}|${!!g.index}|${attrs}`;
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(o);
  });
  const m = new THREE.Matrix4();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const parts = list.map((o) => plainAttributes(o.geometry).applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)));
    const merged = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    if (!merged) continue;
    const first = list[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    if (first.raycast !== THREE.Mesh.prototype.raycast) mesh.raycast = first.raycast;
    for (const o of list) {
      o.removeFromParent();
      if (!o.userData.shared) o.geometry.dispose();
    }
    root.add(mesh);
  }
}

/** Soft darkening where a wall meets the floor (strength at the corner; it fades out from it). */
const WALL_AO = 0.3;
const wallAOMat = new THREE.MeshBasicMaterial({
  color: '#000000',
  vertexColors: true,
  transparent: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -1,
});
wallAOMat.userData.shared = true;

/**
 * The shade in the corner between a wall and the floor, on one side of the wall (`n` points
 * into the room): a band on the floor and a lower one up the wall, darkest in the corner.
 * Fake ambient occlusion: the sky and the lamps reach less into a corner. Doorways stay clear.
 */
function wallAO(l: WallLine, from: number, to: number, gaps: Opening[], n: P): THREE.Mesh | null {
  const side = Math.sign(n.x + n.z);
  const pts: number[] = [];
  const cols: number[] = [];
  // Across the band: distance out from the corner and how dark it is there (a quick falloff, then a tail).
  const floor = [[0, 1], [0.1, 0.45], [0.42, 0]] as const;
  const wall = [[0, 0.85], [0.08, 0.4], [0.34, 0]] as const;
  const strip = (a: number, b: number, at: (t: number, d: number) => THREE.Vector3, rows: readonly (readonly [number, number])[]) => {
    for (let r = 0; r < rows.length - 1; r++) {
      const [d0, k0] = rows[r];
      const [d1, k1] = rows[r + 1];
      const quad = [at(a, d0), at(b, d0), at(b, d1), at(a, d1)];
      const alpha = [k0, k0, k1, k1];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        pts.push(...quad[i].toArray());
        cols.push(0, 0, 0, alpha[i] * WALL_AO);
      }
    }
  };
  const face = HALF * side;
  const onFloor = (t: number, d: number) => {
    const p = onLine(l, t, face + side * d);
    return new THREE.Vector3(p.x, 0.004, p.z);
  };
  const onWall = (t: number, d: number) => {
    const p = onLine(l, t, face + side * 0.003);
    return new THREE.Vector3(p.x, d, p.z);
  };
  let cur = from;
  const doors = gaps.filter((g) => g.y0 < 0.01).sort((p, q) => p.a - q.a);
  for (const g of [...doors, { a: to, b: to }]) {
    const b = Math.min(g.a, to);
    if (b - cur > 0.05) {
      strip(cur, b, onFloor, floor);
      strip(cur, b, onWall, wall);
    }
    cur = Math.max(cur, g.b);
  }
  if (!pts.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 4));
  const mesh = new THREE.Mesh(geo, wallAOMat);
  mesh.renderOrder = 1;
  mesh.raycast = () => {};
  return mesh;
}

interface Placed {
  /** Rebuild when this changes: kind, desk decor or style, or a model finished loading. */
  sig: string;
  /** Entrance: the hinge to swing. */
  door?: THREE.Object3D;
  root: THREE.Group;
  screen?: THREE.MeshStandardMaterial;
}

/** One straight wall, lowered or raised as the camera goes round. */
interface WallRun {
  group: THREE.Group;
  /** Outside walls: where it runs and whose wall it is (to see what lies behind it). */
  line?: WallLine;
  room?: string;
  /** Outside walls that continue one another in a straight line (across rooms) move as one. */
  chain: number;
  /** Outside walls: points into their room. Partitions: either side. */
  normal: P;
  partition: boolean;
  /** Current and wanted height, as a fraction of the full wall. */
  s: number;
  goal: number;
}

/** A gap in a wall: along the wall, and from y0 up to y1. */
interface Opening {
  a: number;
  b: number;
  y0: number;
  y1: number;
}

/**
 * Box faces in BoxGeometry order: +x, −x, +y, −y, +z, −z. A wall's two big faces get the
 * finish of the room on that side; the rest is the bare shell.
 */
function wallBox(l: WallLine, a: number, b: number, y0: number, y1: number, faces: (THREE.Material | null)[], shell: THREE.Material): THREE.Mesh {
  const len = b - a;
  const mid = onLine(l, (a + b) / 2);
  const geo = l.axis === 'x' ? new THREE.BoxGeometry(len, y1 - y0, WALL_T) : new THREE.BoxGeometry(WALL_T, y1 - y0, len);
  geo.translate(mid.x, (y0 + y1) / 2, mid.z);
  const mesh = new THREE.Mesh(geo, faces.map((f) => f ?? shell));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Wall pieces around a set of openings. Pieces above an opening are tagged so cut walls can drop them. */
function wallPieces(l: WallLine, from: number, to: number, openings: Opening[], faces: (THREE.Material | null)[], shell: THREE.Material): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  let cur = from;
  for (const o of [...openings].sort((p, q) => p.a - q.a)) {
    if (o.a - cur > 0.001) out.push(wallBox(l, cur, o.a, 0, WALL_H, faces, shell));
    if (o.y0 > 0.001) out.push(wallBox(l, o.a, o.b, 0, o.y0, faces, shell));
    if (WALL_H - o.y1 > 0.001) {
      const lintel = wallBox(l, o.a, o.b, o.y1, WALL_H, faces, shell);
      lintel.userData.lintel = true;
      out.push(lintel);
    }
    cur = Math.max(cur, o.b);
  }
  if (to - cur > 0.001) out.push(wallBox(l, cur, to, 0, WALL_H, faces, shell));
  return out;
}

/** Index of the box face that looks along `n`. */
function faceIndex(l: WallLine, n: P): number {
  return l.axis === 'x' ? (n.z > 0 ? 4 : 5) : n.x > 0 ? 0 : 1;
}

/** Soft-edged rectangle used for the sun patches: bright core, feathered rim. */
let patchTex: THREE.CanvasTexture | null = null;
function patchTexture(): THREE.CanvasTexture {
  if (patchTex) return patchTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.filter = 'blur(9px)';
  ctx.fillStyle = '#fff';
  ctx.fillRect(18, 18, 92, 92);
  // Mullion shadow down the middle, like the frame of a two-leaf window.
  ctx.filter = 'blur(4px)';
  ctx.fillStyle = '#000';
  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = 0.55;
  ctx.fillRect(60, 0, 8, 128);
  patchTex = new THREE.CanvasTexture(c);
  return patchTex;
}

/** World-space UVs for a wall finish: the pattern stays put however the wall is cut or scaled. */
function worldMapped(mat: THREE.MeshStandardMaterial, repeat: THREE.Vector2): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.wallRepeat = { value: repeat };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWallPos;\nvarying vec3 vWallN;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWallPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWallN = normalize(mat3(modelMatrix) * objectNormal);',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWallPos;\nvarying vec3 vWallN;\nuniform vec2 wallRepeat;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec2 wallUv = (abs(vWallN.x) > 0.5 ? vWallPos.zy : vWallPos.xy) * wallRepeat;
          diffuseColor *= texture2D(map, wallUv);
        #endif`,
      );
  };
  // Named, so it never shares a program with another material's hook once the clouds wrap it.
  mat.customProgramCacheKey = () => 'wall-mapped';
}

/** The rooms (slab, floors, walls, doorways, window light) plus every object in the layout. */
export class Office {
  readonly group = new THREE.Group();
  /** Movable objects only: what the room editor picks from. */
  readonly items = new THREE.Group();
  private shell = new THREE.Group();
  private light = new THREE.Group();
  /** The windows' and open walls' area lights: their own group, so rebuilding the sun's patches never takes them. */
  private glow = new THREE.Group();
  private placed = new Map<string, Placed>();
  private screens = new Map<number, THREE.MeshStandardMaterial>();
  private assets: Assets = { computer: null, desks: null, chairs: null, plants: null, decor: null, windows: null, sofas: null, lamps: null };
  private assetsRev = 0;
  private shadow: THREE.Mesh | null = null;
  /** The garden round the building (lawn, path, street, trees), when the ground is «Césped». */
  private garden: { group: THREE.Group; land: Landscape | null } | null = null;
  private groundKind: GroundKind = 'grass';
  private furniture: { bench: BenchModel; lamp: LampModel } = { bench: 'maro', lamp: 'modern' };
  private doors: Item[] = [];
  private streetLights = 0;
  /** How much direct sun the clouds let through right now (dims the light through the windows). */
  private veil = 1;
  private shellSig = '';
  /** Ceiling lights, a few per room: off by day, warming up as the sun goes down. */
  private ceiling: THREE.PointLight[] = [];
  private interior = 0;
  /** Entrance door: how far open (0–1) and where it's heading. */
  private doorOpen = 0;
  private doorGoal = 0;
  private runs: WallRun[] = [];
  private rooms: readonly Room[] = [];
  /** Wall objects ride with the wall they hang on. */
  private wallItems = new Map<string, WallRun>();
  /** Windows in outside walls: where along their run, and how high (they let the rooms' light out). */
  private panes: { run: WallRun; a: number; b: number; y0: number; y1: number }[] = [];
  /** Each window's glass as a real light facing out: the rooms' light reaching the ground outside. */
  private windowGlow: { light: THREE.RectAreaLight; run: WallRun; wall: boolean }[] = [];
  private windowGlowKey = '';
  private floorMats = new Map<string, { mat: THREE.MeshStandardMaterial; kind: FloorKind }>();
  private wallMats = new Map<WallKind, THREE.MeshStandardMaterial>();
  /** Light shafts, by window: shown only while the window's wall stands. */
  private shafts = new Map<string, THREE.Mesh>();
  private sunDir = new THREE.Vector3(-0.4, -0.78, -0.5).normalize();
  /** What the window light was last built from, to rebuild it alone when the sun moves. */
  private lightFor: { rooms: readonly Room[]; windows: Item[]; style: WindowStyle } | null = null;
  private night = false;
  private palette: ScenePalette;
  private m: MatFn;

  constructor(mats: Materials, palette: ScenePalette) {
    this.palette = palette;
    this.m = (slot, extra) => mats.get(slot, palette, extra);
    this.group.add(this.shell, this.light, this.glow, this.items);
  }

  /** A model finished loading: what uses it is rebuilt on the next sync. */
  setAsset<K extends keyof Assets>(key: K, value: Assets[K]): void {
    this.assets[key] = value;
    this.assetsRev++;
  }

  get assetsVersion(): number {
    return this.assetsRev;
  }

  get assetList(): Assets {
    return this.assets;
  }

  /** Direction the sunlight travels (from the scene's sun): sets the angle of light through each window. */
  setSun(dir: THREE.Vector3): void {
    const next = dir.clone().normalize();
    // The sun crawls: only redraw the patches once it has moved a visible amount (~1°).
    if (next.angleTo(this.sunDir) < 0.017) return;
    this.sunDir.copy(next);
    this.rebuildWindowLight();
  }

  private rebuildWindowLight(): void {
    if (!this.lightFor) return;
    for (const c of [...this.light.children]) {
      this.light.remove(c);
      dispose(c);
    }
    this.shafts.clear();
    this.buildWindowLight(this.lightFor.rooms, this.lightFor.windows, this.lightFor.style);
    this.setVeil(this.veil);
  }


  /** Bring the rooms and 3D objects in line with the layout. */
  sync(rooms: readonly Room[], items: readonly Item[], look: RoomLook): void {
    const windows = items.filter((i) => i.kind === 'window');
    const doors = items.filter((i) => i.kind === 'entrance');
    const shellSig = JSON.stringify([rooms, [...windows, ...doors].map((w) => [w.kind, w.x, w.z, w.rot]), look.windows.model]);
    if (shellSig !== this.shellSig) {
      this.shellSig = shellSig;
      this.buildShell(rooms, windows, look.windows, doors);
    }

    const seen = new Set<string>();
    const chairKey = (c: RoomLook['chairs']['desk']) => `${c.model}/${c.fabric}/${c.frame}`;
    const keys: Partial<Record<Item['kind'], string>> = {
      desk: `${look.desk.model}/${look.desk.top}/${look.desk.frame}|${chairKey(look.chairs.desk)}`,
      meeting: chairKey(look.chairs.meeting),
      window: `${look.windows.model}/${look.windows.material}/${look.windows.frame}`,
    };
    this.screens.clear();
    this.wallItems.clear();
    this.panes = [];
    const pane = windowModel(look.windows.model);
    for (const item of items) {
      seen.add(item.id);
      const sig = `${item.kind}|${item.decor ?? ''}|${this.assetsRev}|${keys[item.kind] ?? ''}`;
      let p = this.placed.get(item.id);
      if (!p || p.sig !== sig) {
        if (p) this.drop(p);
        const built = buildItem(item, this.m, this.assets, look);
        mergeStatic(built.obj, built.door);
        built.obj.userData.itemId = item.id;
        p = { sig, root: built.obj, screen: built.screen, door: built.door };
        this.placed.set(item.id, p);
        this.items.add(p.root);
      }
      p.root.position.set(item.x, 0, item.z);
      p.root.rotation.y = item.rot;
      if (p.screen && item.slot !== undefined) this.screens.set(item.slot, p.screen);
      if (KINDS[item.kind].wall) {
        const wall = wallOf(item, rooms);
        const run = wall && this.runs.find((r) => r.group.userData.wall === wallKey(wall));
        if (run) this.wallItems.set(item.id, run);
        if (run?.line && item.kind === 'window') {
          const along = run.line.axis === 'x' ? item.x : item.z;
          this.panes.push({ run, a: along - pane.width / 2, b: along + pane.width / 2, y0: pane.sill, y1: pane.head });
        }
      }
    }
    for (const [id, p] of this.placed) {
      if (seen.has(id)) continue;
      this.drop(p);
      this.placed.delete(id);
    }
    this.buildWindowGlow();
  }

  /**
   * One area light per window, the size of its glass, on the outer face and shining outwards
   * only: the warm light of the lit rooms falls on the ground outside the way it really would,
   * strongest right under the window and fading with distance, nothing behind the wall.
   */
  private buildWindowGlow(): void {
    const outer = this.runs.filter((r) => r.line && !r.partition);
    const key = [...this.panes.map((w) => `${w.a.toFixed(2)},${w.y0},${w.y1},${w.run.group.userData.wall}`), ...outer.map((r) => `${r.group.userData.wall}`)].join('|');
    if (key === this.windowGlowKey) return;
    this.windowGlowKey = key;
    for (const g of this.windowGlow) this.glow.remove(g.light);
    this.windowGlow = [];
    if (!this.panes.length && !outer.length) return;
    if (!rectLightsReady) {
      RectAreaLightUniformsLib.init();
      rectLightsReady = true;
    }
    for (const w of this.panes) {
      const l = w.run.line!;
      const out = { x: -w.run.normal.x, z: -w.run.normal.z };
      const mid = onLine(l, (w.a + w.b) / 2, -w.run.normal.x * (HALF + 0.02) - w.run.normal.z * (HALF + 0.02));
      const light = new THREE.RectAreaLight(CEILING_LIGHT, 0, w.b - w.a - 0.1, w.y1 - w.y0 - 0.1);
      light.position.set(mid.x, (w.y0 + w.y1) / 2, mid.z);
      light.lookAt(mid.x + out.x, (w.y0 + w.y1) / 2, mid.z + out.z);
      this.glow.add(light);
      this.windowGlow.push({ light, run: w.run, wall: false });
    }
    // A whole outside wall, for when it drops out of the view's way: then the room is open on
    // that side, as if the wall weren't there, and its light falls out across the ground.
    for (const r of outer) {
      const l = r.line!;
      const out = { x: -r.normal.x, z: -r.normal.z };
      const mid = onLine(l, (l.from + l.to) / 2, -r.normal.x * (HALF + 0.02) - r.normal.z * (HALF + 0.02));
      const light = new THREE.RectAreaLight(CEILING_LIGHT, 0, Math.abs(l.to - l.from), WALL_H);
      light.position.set(mid.x, WALL_H / 2, mid.z);
      light.lookAt(mid.x + out.x, WALL_H / 2, mid.z + out.z);
      this.glow.add(light);
      this.windowGlow.push({ light, run: r, wall: true });
    }
    this.syncWindowGlow();
  }

  /** As bright as the rooms are lit; dark while its wall is dropped out of the way. */
  private syncWindowGlow(): void {
    for (const g of this.windowGlow) {
      // A window shines while its wall stands; a wall shines as much as it has dropped away.
      g.light.intensity = g.wall ? this.interior * WALL_GLOW * Math.max(0, 1 - g.run.s) : g.run.s > 0.6 ? this.interior * WINDOW_GLOW : 0;
    }
  }

  // ---------------------------------------------------------------- shell

  private clearShell(): void {
    for (const g of [this.shell, this.light]) {
      for (const c of [...g.children]) {
        g.remove(c);
        dispose(c);
      }
    }
    this.runs = [];
    // New walls: the lights tied to the old ones go too.
    this.windowGlowKey = '';
    this.shafts.clear();
  }

  private buildShell(rooms: readonly Room[], windows: Item[], style: WindowStyle, doors: Item[]): void {
    this.clearShell();
    this.rooms = rooms;
    const shellMat = this.m('wall');
    const geo = roomGeometry(rooms);
    const byId = new Map(rooms.map((r) => [r.id, r]));

    // Slab: one block per room, out to the outer face of its walls.
    for (const r of rooms) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(r.x1 - r.x0 + WALL_T, WALL_T, r.z1 - r.z0 + WALL_T), shellMat);
      slab.position.set((r.x0 + r.x1) / 2, -WALL_T / 2, (r.z0 + r.z1) / 2);
      slab.receiveShadow = true;
      this.shell.add(slab);

      // Floor: UVs in world metres, so a finish runs on unbroken from one room into the next.
      const floor = new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0).rotateX(-Math.PI / 2).translate((r.x0 + r.x1) / 2, 0.002, (r.z0 + r.z1) / 2);
      const pos = floor.attributes.position;
      const uv = floor.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i), -pos.getZ(i));
      const mesh = new THREE.Mesh(floor, this.floorMaterial(r));
      mesh.receiveShadow = true;
      this.shell.add(mesh);
    }

    // Ceiling lights: roughly one per 4.5 m square of each room, just under the wall tops.
    this.ceiling = [];
    for (const r of rooms) {
      const w = r.x1 - r.x0;
      const d = r.z1 - r.z0;
      const nx = Math.max(1, Math.round(w / 4.5));
      const nz = Math.max(1, Math.round(d / 4.5));
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) {
          const x = r.x0 + (w * (i + 0.5)) / nx;
          const z = r.z0 + (d * (j + 0.5)) / nz;
          // Steep falloff: bright under the lamp, dim towards the walls, like a real bulb.
          // Kept to its room: what reaches the ground outside is the soft spill drawn there (see ground.ts).
          const light = new THREE.PointLight(CEILING_LIGHT, 0, Math.max(w / nx, d / nz) * 1.6 + 3, 2.2);
          light.position.set(x, WALL_H - 0.5, z);
          this.ceiling.push(light);
          this.shell.add(light);
        }
      }
    }
    this.setInterior(this.interior);

    const ends = wallEnds([...geo.outer, ...geo.joints]);

    // Outside walls, with a hole for each window on them.
    const win = windowModel(style.model);
    for (const w of geo.outer) {
      const openings: Opening[] = [
        ...windows
          .filter((it) => wallOf(it, rooms) === w)
          .map((it) => {
            const along = w.axis === 'x' ? it.x : it.z;
            return { a: along - win.width / 2, b: along + win.width / 2, y0: win.sill, y1: win.head };
          }),
        ...doors
          .filter((it) => wallOf(it, rooms) === w)
          .map((it) => {
            const along = w.axis === 'x' ? it.x : it.z;
            return { a: along - ENTRANCE.width / 2, b: along + ENTRANCE.width / 2, y0: 0, y1: ENTRANCE.head };
          }),
      ];
      const faces: (THREE.Material | null)[] = Array(6).fill(null);
      faces[faceIndex(w, w.inward)] = this.wallMaterial(byId.get(w.room)!.walls);
      // Close corners by running half a wall past an end, unless the wall carries on in line
      // there (another room's wall or a partition): then the two butt cleanly, no overlap.
      const a = ends.continues(w, w.from) ? w.from : w.from - HALF;
      const b = ends.continues(w, w.to) ? w.to : w.to + HALF;
      const pieces = wallPieces(w, a, b, openings, faces, shellMat);
      const ao = wallAO(w, w.from, w.to, openings, w.inward);
      if (ao) pieces.push(ao);
      this.addRun(pieces, w.inward, false, wallKey(w), w);
    }

    this.chainWalls();

    // Partitions between rooms, each with its doorway.
    for (const j of geo.joints) {
      const a = byId.get(j.a)!;
      const b = byId.get(j.b)!;
      // Which room is on the + side of the wall?
      const aPlus = j.axis === 'x' ? a.z0 >= j.at - 1e-6 : a.x0 >= j.at - 1e-6;
      const plus = j.axis === 'x' ? { x: 0, z: 1 } : { x: 1, z: 0 };
      const minus = { x: -plus.x, z: -plus.z };
      const faces: (THREE.Material | null)[] = Array(6).fill(null);
      faces[faceIndex(j, plus)] = this.wallMaterial((aPlus ? a : b).walls);
      faces[faceIndex(j, minus)] = this.wallMaterial((aPlus ? b : a).walls);
      const openings = j.door === null ? [] : [{ a: j.door - DOOR_W / 2, b: j.door + DOOR_W / 2, y0: 0, y1: DOOR_H }];
      // Stop at the face of a crossing wall; run right up to an outside wall that carries on in line.
      const from = ends.continues(j, j.from) ? j.from : j.from + HALF;
      const to = ends.continues(j, j.to) ? j.to : j.to - HALF;
      const pieces = wallPieces(j, from, to, openings, faces, shellMat);
      for (const n of [plus, minus]) {
        const ao = wallAO(j, from, to, openings, n);
        if (ao) pieces.push(ao);
      }
      this.addRun(pieces, plus, true, '');
    }

    this.doors = doors;
    this.buildGarden();
    this.buildGroundShadow(rooms, geo.outer);
    this.buildWindowLight(rooms, windows, style);
  }

  private addRun(pieces: THREE.Mesh[], normal: P, partition: boolean, key: string, outer?: OuterWall): void {
    const group = new THREE.Group();
    group.userData.wall = key;
    for (const p of pieces) group.add(p);
    this.shell.add(group);
    this.runs.push({ group, normal, partition, s: 1, goal: 1, line: outer, room: outer?.room, chain: -1 });
  }

  /** Number each straight run of outside wall: segments end to end, same line, same side. */
  private chainWalls(): void {
    const outer = this.runs.filter((r) => r.line);
    const joins = (a: WallRun, b: WallRun) => {
      const p = a.line!;
      const q = b.line!;
      return (
        p.axis === q.axis &&
        Math.abs(p.at - q.at) < 1e-6 &&
        a.normal.x === b.normal.x &&
        a.normal.z === b.normal.z &&
        (Math.abs(p.to - q.from) < 1e-6 || Math.abs(q.to - p.from) < 1e-6)
      );
    };
    let n = 0;
    for (const start of outer) {
      if (start.chain >= 0) continue;
      start.chain = n;
      const stack = [start];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const o of outer) {
          if (o.chain < 0 && joins(cur, o)) {
            o.chain = n;
            stack.push(o);
          }
        }
      }
      n++;
    }
  }

  /** Does another room lie just behind this wall, as seen from the camera (an L-shaped office)? */
  private hidesRoom(run: WallRun, bx: number, bz: number): boolean {
    const l = run.line!;
    for (const t of [0.15, 0.5, 0.85]) {
      const p = onLine(l, l.from + (l.to - l.from) * t);
      for (const d of [0.8, 2, 3.5]) {
        const r = roomOf(this.rooms, { x: p.x + bx * d, z: p.z + bz * d });
        if (r && r.id !== run.room) return true;
      }
    }
    return false;
  }

  /** The backdrop is the table the model stands on: paint the shadow the building casts on it. */
  private buildGroundShadow(rooms: readonly Room[], outer: OuterWall[]): void {
    const blocks: ShadowBlock[] = rooms.map((r) => ({ x0: r.x0 - HALF, x1: r.x1 + HALF, z0: r.z0 - HALF, z1: r.z1 + HALF, h: WALL_T }));
    for (const w of outer) {
      const a = onLine(w, w.from - HALF, -HALF);
      const b = onLine(w, w.to + HALF, HALF);
      blocks.push({ x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z), h: WALL_H + WALL_T });
    }
    const { bounds } = roomGeometry(rooms);
    const pad = 2.4;
    const box = { x0: bounds.minX - pad, x1: bounds.maxX + pad, z0: bounds.minZ - pad, z1: bounds.maxZ + pad };
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(box.x1 - box.x0, box.z1 - box.z0),
      new THREE.MeshBasicMaterial({
        // Only the soft darkening where the building meets the ground: the sun's own shadow on
        // the ground is real now (shadow map), so this one doesn't lean with the light.
        map: groundShadow(blocks, box, { x: 0, z: 0 }),
        color: '#000000',
        transparent: true,
        depthWrite: false,
        opacity: this.night ? 0.45 : 0.32,
      }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.set((box.x0 + box.x1) / 2, -WALL_T - 0.002, (box.z0 + box.z1) / 2);
    this.shadow.renderOrder = -1;
    this.shell.add(this.shadow);
  }

  /**
   * Daylight through each window: a bright patch on the floor where the sun lands (at the
   * sun's angle when it shines on that wall, a softer skylight straight in otherwise), and a
   * faint shaft of light from the glass down to it.
   */
  private buildWindowLight(rooms: readonly Room[], windows: Item[], style: WindowStyle): void {
    this.lightFor = { rooms, windows, style };
    const win = windowModel(style.model);
    const sun = this.sunDir;
    for (const it of windows) {
      const wall = wallOf(it, rooms);
      if (!wall) continue;
      const n = wall.inward;
      // A sun lower than ~15° would throw its patch far past the room: skylight instead.
      // At night the windows let in the blue of the sky, faintly, instead of sunlight.
      const moon = this.night;
      const sunny = !moon && sun.x * n.x + sun.z * n.z > 0.15 && sun.y < -0.26;
      // Skylight: straight in through the glass, falling at 40°.
      const dir = sunny ? sun.clone() : new THREE.Vector3(n.x * 0.77, -0.64, n.z * 0.77);
      const along = wall.axis === 'x' ? it.x : it.z;
      const glass = (s: number, y: number) => {
        const p = onLine(wall, along + s, HALF * 0.5 * Math.sign(n.x + n.z));
        return new THREE.Vector3(p.x, y, p.z);
      };
      const land = (v: THREE.Vector3) => v.clone().addScaledVector(dir, -v.y / dir.y).setY(0.006);
      const hw = win.width / 2 - 0.08;
      const y0 = Math.max(win.sill, 0.05);
      const y1 = win.head - 0.06;
      const top = [glass(-hw, y1), glass(hw, y1)];
      const bot = [glass(-hw, y0), glass(hw, y0)];
      const near = bot.map(land);
      const far = top.map(land);

      const patch = new THREE.BufferGeometry();
      patch.setAttribute('position', new THREE.Float32BufferAttribute([...near[0].toArray(), ...near[1].toArray(), ...far[1].toArray(), ...far[0].toArray()], 3));
      patch.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      patch.setIndex([0, 1, 2, 0, 2, 3]);
      const patchMesh = new THREE.Mesh(
        patch,
        new THREE.MeshBasicMaterial({
          map: patchTexture(),
          color: moon ? '#7f9bea' : sunny ? '#ffe2b0' : '#dfe9f5',
          transparent: true,
          opacity: moon ? 0.16 : sunny ? 0.2 : 0.09,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
      );
      patchMesh.renderOrder = 2;

      // Shaft: four quads from the glass to the patch, fading out toward the floor.
      const pts: number[] = [];
      const cols: number[] = [];
      const c = moon ? [0.5, 0.62, 0.95] : sunny ? [1, 0.88, 0.66] : [0.82, 0.88, 0.95];
      const a0 = moon ? 0.03 : sunny ? 0.035 : 0.02;
      const quad = (p: THREE.Vector3[], alpha: number[]) => {
        for (const k of [0, 1, 2, 0, 2, 3]) {
          pts.push(...p[k].toArray());
          cols.push(...c, alpha[k]);
        }
      };
      quad([bot[0], bot[1], near[1], near[0]], [a0, a0, 0, 0]);
      quad([top[0], top[1], far[1], far[0]], [a0, a0, 0, 0]);
      quad([bot[0], top[0], far[0], near[0]], [a0, a0, 0, 0]);
      quad([bot[1], top[1], far[1], near[1]], [a0, a0, 0, 0]);
      const shaft = new THREE.BufferGeometry();
      shaft.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      shaft.setAttribute('color', new THREE.Float32BufferAttribute(cols, 4));
      const shaftMesh = new THREE.Mesh(
        shaft,
        new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      shaftMesh.renderOrder = 3;
      shaftMesh.add(patchMesh);
      this.shafts.set(it.id, shaftMesh);
      this.light.add(shaftMesh);
    }
  }

  private floorMaterial(r: Room): THREE.MeshStandardMaterial {
    let f = this.floorMats.get(r.id);
    if (!f) {
      // A satin finish: the lamps and the sky glint softly off it, more off the pale boards.
      f = { mat: new THREE.MeshStandardMaterial({ roughness: 0.62 }), kind: 'plain' };
      grainSheen(f.mat);
      f.mat.userData.shared = true;
      this.floorMats.set(r.id, f);
    }
    f.kind = r.floor;
    f.mat.map = floorTexture(r.floor);
    // Seams, grout and pile catch the light: relief from the floor's own picture.
    f.mat.bumpMap = floorBump(r.floor) ? f.mat.map : null;
    f.mat.bumpScale = floorBump(r.floor);
    f.mat.needsUpdate = true;
    this.tintFloor(f);
    return f.mat;
  }

  private wallMaterial(kind: WallKind): THREE.Material {
    if (kind === 'plain') return this.m('wall');
    let mat = this.wallMats.get(kind);
    if (!mat) {
      const map = wallTexture(kind);
      mat = new THREE.MeshStandardMaterial({ roughness: 0.9, map });
      if (map) worldMapped(mat, map.repeat);
      mat.userData.shared = true;
      this.wallMats.set(kind, mat);
      this.tintWall(kind, mat);
    }
    return mat;
  }

  private tintWall(kind: WallKind, mat: THREE.MeshStandardMaterial): void {
    const paint = WALL_PAINT[kind];
    mat.color.set(paint ?? '#ffffff');
    // Dim at night like the palette does for the bare walls; with the ceiling lights on they keep their colour.
    // Only a little: the lamps light what's near them, the rest stays dark.
    if (this.night) mat.color.multiplyScalar(THREE.MathUtils.lerp(paint ? 0.32 : 0.42, 1, this.interior * 0.35));
  }

  /** Textures carry their own colour; at night they are dimmed like everything else. */
  private tintFloor(f: { mat: THREE.MeshStandardMaterial; kind: FloorKind }): void {
    if (f.kind === 'plain') f.mat.color.set(this.palette.floor);
    else f.mat.color.set(this.night ? NIGHT_FLOOR.clone().lerp(DAY_FLOOR, this.interior * 0.35) : '#ffffff');
  }

  /**
   * Per frame: walls between the camera and the inside drop away entirely, partitions that
   * would hide a room drop to half height, and the rest stand. Wall objects follow their wall.
   */
  /** How much the ceiling lights are on (0 by day, 1 at night). */
  setInterior(level: number): void {
    const was = this.interior;
    this.interior = level;
    // Kept in the scene even at zero: switching lights in and out would recompile every material.
    for (const l of this.ceiling) l.intensity = level * CEILING_INTENSITY;
    // ...and what of it gets out through the windows, onto the ground round the building.
    this.syncWindowGlow();
    // Lit rooms don't sink into the night as much: floors and walls keep more of their colour.
    if (Math.abs(was - level) > 0.02) {
      for (const f of this.floorMats.values()) this.tintFloor(f);
      for (const [kind, mat] of this.wallMats) this.tintWall(kind, mat);
    }
  }

  /** Reading lamps on the desks (0 = off). Whenever the ceiling lights are on, they are too. */
  setDeskLamps(intensity: number): void {
    setLampGlow(Math.max(intensity / LAMP_FULL, this.interior));
  }

  /** Someone is at the entrance: swing the door open (it closes again on its own). */
  setDoorOpen(open: boolean): void {
    this.doorGoal = open ? 1 : 0;
  }

  update(camera: THREE.Camera, target: THREE.Vector3, dt: number, instant = false): void {
    // Opens briskly, closes a little slower, easing out like a real door.
    this.doorOpen += (this.doorGoal - this.doorOpen) * (instant ? 1 : 1 - Math.exp(-(this.doorGoal > this.doorOpen ? 6 : 3.5) * dt));
    for (const p of this.placed.values()) if (p.door) p.door.rotation.y = -1.4 * this.doorOpen;

    const tx = camera.position.x - target.x;
    const tz = camera.position.z - target.z;
    const len = Math.hypot(tx, tz) || 1;
    const k = instant ? 1 : 1 - Math.exp(-9 * dt);
    const chainGoal = new Map<number, number>();
    for (const run of this.runs) {
      const dot = (run.normal.x * tx + run.normal.z * tz) / len;
      if (run.partition) run.goal = Math.abs(dot) > 0.4 ? CUT_LOW : 1;
      else if (dot <= -0.12) run.goal = CUT_OUT;
      else run.goal = this.hidesRoom(run, -tx / len, -tz / len) ? CUT_LOW : 1;
      if (run.chain >= 0) chainGoal.set(run.chain, Math.min(chainGoal.get(run.chain) ?? 1, run.goal));
    }
    for (const run of this.runs) {
      // A straight wall across several rooms drops as one piece, corner columns included.
      if (run.chain >= 0) run.goal = chainGoal.get(run.chain)!;
      if (Math.abs(run.goal - run.s) < 0.002) run.s = run.goal;
      else run.s += (run.goal - run.s) * k;
      run.group.visible = run.s > 0.004;
      run.group.scale.y = Math.max(run.s, 0.004);
      for (const c of run.group.children) if (c.userData.lintel) c.visible = run.s > 0.9;
    }
    this.updateOpenings();
    for (const [id, run] of this.wallItems) {
      const root = this.placed.get(id)?.root;
      if (root) root.visible = run.s > 0.6;
      const shaft = this.shafts.get(id);
      if (shaft) shaft.visible = run.s > 0.6;
    }
    this.syncWindowGlow();
  }

  /**
   * Where the rooms' light gets out, for the ground to catch and mirror: each window in a
   * standing wall, and the open part above an outside wall that has dropped out of the view's way.
   */
  private updateOpenings(): void {
    const out: LitOpening[] = [];
    const add = (l: WallLine, n: P, a: number, b: number, y0: number, y1: number) => {
      const p = onLine(l, a, -n.x * HALF - n.z * HALF);
      const q = onLine(l, b, -n.x * HALF - n.z * HALF);
      out.push({ x0: p.x, z0: p.z, x1: q.x, z1: q.z, y0, y1, out: { x: -n.x, z: -n.z } });
    };
    for (const run of this.runs) {
      if (!run.line || run.s > 0.98) continue;
      add(run.line, run.normal, run.line.from, run.line.to, run.s * WALL_H, WALL_H + 0.4);
    }
    for (const w of this.panes) if (w.run.s > 0.6) add(w.run.line!, w.run.normal, w.a, w.b, w.y0, Math.min(w.y1, w.run.s * WALL_H));
    setRoomOpenings(out);
  }

  private drop(p: Placed): void {
    this.items.remove(p.root);
    dispose(p.root);
  }

  /** The screen on the desk with this seat number. */
  screenFor(slot: number): THREE.MeshStandardMaterial | undefined {
    return this.screens.get(slot);
  }

  rootOf(itemId: string): THREE.Group | undefined {
    return this.placed.get(itemId)?.root;
  }

  /** How much the ceiling lights are on (0–1). */
  get interiorLight(): number {
    return this.interior;
  }

  /** «Por defecto»: the plain table, which mirrors faintly even when dry. */
  get plainGround(): boolean {
    return this.groundKind !== 'grass';
  }

  /** The ground and the garden on it (what the puddles don't mirror). */
  get outdoors(): THREE.Object3D | null {
    return this.garden?.group ?? null;
  }

  /** The lawn and everything on it, or nothing («Por defecto»: the model alone on the table). */
  private buildGarden(): void {
    if (this.garden) {
      this.shell.remove(this.garden.group);
      dispose(this.garden.group);
      this.garden = null;
    }
    if (!this.rooms.length) return;
    const { bounds } = roomGeometry(this.rooms);
    const group = new THREE.Group();
    if (this.groundKind !== 'grass') {
      // «Por defecto»: just the table, but it still gets wet, shaded and puddled.
      group.add(groundMesh(bounds, 'plain'));
      this.garden = { group, land: null };
      this.shell.add(group);
      return;
    }
    group.add(groundMesh(bounds));
    const land = buildLandscape(this.rooms, bounds, this.doors[0], this.furniture);
    land.setNight(this.streetLights);
    group.add(land.group);
    this.garden = { group, land };
    this.shell.add(group);
  }

  /** What the ground outside is, and the bench and lamps on it: swapped in place, nothing else rebuilt. */
  setOutdoor(o: { ground: GroundKind; bench: BenchModel; lamp: LampModel }): void {
    if (o.ground === this.groundKind && o.bench === this.furniture.bench && o.lamp === this.furniture.lamp) return;
    this.groundKind = o.ground;
    this.furniture = { bench: o.bench, lamp: o.lamp };
    if (this.rooms.length) this.buildGarden();
  }

  /** The street lamps outside: 0 off, 1 fully on (dusk, night, a dark storm). */
  setStreetLights(k: number): void {
    if (Math.abs(k - this.streetLights) < 0.01) return;
    this.streetLights = k;
    this.garden?.land?.setNight(k);
  }

  /**
   * A cloud over the office: the sunlight through the windows fades with it (`k`: how much of
   * the direct sun gets through).
   */
  setVeil(k: number): void {
    this.veil = k;
    this.light.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = o.material as THREE.MeshBasicMaterial;
      m.userData.base ??= m.opacity;
      m.opacity = m.userData.base * (this.night ? 1 : 0.25 + 0.75 * k);
    });
  }

  setNight(night: boolean, p: ScenePalette): void {
    const changed = night !== this.night;
    this.night = night;
    if (changed) this.rebuildWindowLight();
    this.palette = p;
    for (const f of this.floorMats.values()) this.tintFloor(f);
    for (const [kind, mat] of this.wallMats) this.tintWall(kind, mat);
    if (this.shadow) (this.shadow.material as THREE.MeshBasicMaterial).opacity = night ? 0.45 : 0.32;
  }
}

/** Which wall ends carry straight on into another wall on the same line. */
function wallEnds(walls: WallLine[]) {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  return {
    continues(w: WallLine, at: number): boolean {
      return walls.some((o) => o !== w && o.axis === w.axis && near(o.at, w.at) && (near(o.from, at) || near(o.to, at)));
    },
  };
}

const wallKey = (w: OuterWall) => `${w.room}:${w.axis}:${w.at}:${w.from}`;
