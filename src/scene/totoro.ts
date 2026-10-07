import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { Look } from '../sim/look';
import type { Activity, Worker } from '../sim/types';
import { route, type Point, type Pose, type Spot } from './navigation';

/** Standing height in office units (a desk is 0.74 high). */
const HEIGHT = 1.2;
const WALK_SPEED = 2.1;
/** Where the bottom of the body rests for each pose (chair and stool seats). */
const SEAT_Y: Record<Pose, number> = { stand: 0, seat: 0.45, stool: 0.46 };

const damp = (from: number, to: number, rate: number, dt: number) => from + (to - from) * (1 - Math.exp(-rate * dt));

function angleDamp(from: number, to: number, rate: number, dt: number) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + d * (1 - Math.exp(-rate * dt));
}

/**
 * Loads the model once, scaled to office size with its feet at y = 0 and facing +z.
 * Meshes that came without normals (the decimated whiskers) get smooth ones.
 */
let template: Promise<THREE.Object3D> | null = null;

/** The model is fetched once and shared (geometry included) by every Totoro. */
export function totoroTemplate(): Promise<THREE.Object3D> {
  template ??= loadTotoro(`${import.meta.env.BASE_URL}models/totoro.glb`);
  return template;
}

async function loadTotoro(url: string): Promise<THREE.Object3D> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;
  model.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      if (!o.geometry.getAttribute('normal')) o.geometry.computeVertexNormals();
      o.castShadow = true;
    }
  });
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const s = HEIGHT / size.y;
  const wrap = new THREE.Group();
  model.position.set(-center.x, -box.min.y, -center.z);
  wrap.add(model);
  wrap.scale.setScalar(s);
  return wrap;
}

interface Motion {
  lift: number;
  squash: number;
  leanX: number;
  roll: number;
  turn: number;
  mug: boolean;
  /** Arms flap (radians), used for waving and gestures. */
  arms: number;
}

/**
 * A Totoro standing in for a worker. The model has no skeleton, so life comes from
 * moving whole parts: hop and waddle when walking, squash when sitting, breathing,
 * blinking eyes, twitching ears, a wobbling leaf (tinted with the role colour) and tail.
 */
export class TotoroAvatar {
  readonly root = new THREE.Group();
  headTop = SEAT_Y.seat + HEIGHT;

  private body = new THREE.Group();
  private parts: Partial<Record<'eyes' | 'ears' | 'leaf' | 'tail' | 'arms', THREE.Object3D>> = {};
  private base = new Map<THREE.Object3D, { s: THREE.Vector3; r: THREE.Euler }>();
  private highlight: THREE.MeshStandardMaterial[] = [];
  private leafMat: THREE.MeshStandardMaterial | null = null;
  private mug: THREE.Mesh;
  private ring: THREE.Mesh;

  private spot: Spot | null = null;
  private path: Point[] = [];
  private walkPhase = 0;
  private heading = 0;
  private seed = Math.random() * 100;
  private hovered = false;
  private selected = false;
  private nextBlink = 1 + Math.random() * 3;
  private blinkT = -1;
  private nextTwitch = 2 + Math.random() * 4;
  private twitchT = -1;
  private m: Motion = { lift: SEAT_Y.seat, squash: 1, leanX: 0, roll: 0, turn: 0, mug: false, arms: 0 };

  constructor(
    readonly workerId: string,
    readonly look: Look,
    readonly index: number,
    template: THREE.Object3D,
    roleColor: string,
  ) {
    const model = template.clone(true);
    // Each Totoro gets its own materials so hover glow and leaf colour stay per worker.
    const cloned = new Map<string, THREE.MeshStandardMaterial>();
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const src = o.material as THREE.MeshStandardMaterial;
        let mat = cloned.get(src.uuid);
        if (!mat) {
          mat = src.clone();
          cloned.set(src.uuid, mat);
          if (src.name === 'skin' || src.name === 'belly') this.highlight.push(mat);
          if (src.name === 'leaf | body') this.leafMat = mat;
        }
        o.material = mat;
      }
      const key = ({ Eyes: 'eyes', Ears: 'ears', 'Leaf hat': 'leaf', Tail: 'tail', Arms: 'arms' } as const)[o.name as 'Eyes'];
      if (key) {
        this.parts[key] = o;
        this.base.set(o, { s: o.scale.clone(), r: o.rotation.clone() });
      }
    });
    this.body.add(model);
    this.root.add(this.body);

    this.mug = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.06, 0.13, 18),
      new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.4 }),
    );
    this.mug.castShadow = true;
    this.mug.position.set(0.12, 0.5, 0.36);
    this.mug.visible = false;
    this.body.add(this.mug);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.6, 48),
      new THREE.MeshBasicMaterial({ color: roleColor, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.015;
    this.ring.visible = false;
    this.root.add(this.ring);

    this.setRole(roleColor);
    this.root.traverse((o) => (o.userData.workerId = workerId));
  }

  adopt(prev: { root: THREE.Object3D; spotSnapshot(): { spot: Spot | null; path: Point[]; heading: number }; isSelected: boolean }): void {
    const snap = prev.spotSnapshot();
    this.root.position.copy(prev.root.position);
    this.spot = snap.spot;
    this.path = snap.path;
    this.heading = snap.heading;
    this.root.rotation.y = snap.heading;
    this.setSelected(prev.isSelected);
  }

  get isSelected(): boolean {
    return this.selected;
  }

  spotSnapshot() {
    return { spot: this.spot, path: this.path, heading: this.heading };
  }

  dispose(): void {
    // Geometry is shared with the template; only per-instance materials are ours.
    const seen = new Set<THREE.Material>();
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) seen.add(o.material as THREE.Material);
    });
    seen.forEach((m) => m.dispose());
    this.mug.geometry.dispose();
    this.ring.geometry.dispose();
  }

  setRole(color: string): void {
    this.leafMat?.color.set(color);
    (this.ring.material as THREE.MeshBasicMaterial).color.set(color);
  }

  setHover(on: boolean): void {
    this.hovered = on;
  }

  setSelected(on: boolean): void {
    this.selected = on;
    this.ring.visible = on;
  }

  get pose(): Pose | null {
    return this.walking ? 'stand' : (this.spot?.pose ?? null);
  }

  get walking(): boolean {
    return this.path.length > 0;
  }

  goTo(spot: Spot, instant: boolean): void {
    // Same seat at the same place: nothing to do. A moved desk keeps its key but not its place.
    const cur = this.spot;
    if (cur && cur.key === spot.key && Math.abs(cur.x - spot.x) < 1e-3 && Math.abs(cur.z - spot.z) < 1e-3 && Math.abs(cur.rotY - spot.rotY) < 1e-3 && (cur.lift ?? 0) === (spot.lift ?? 0)) return;
    this.spot = spot;
    if (instant) {
      this.path = [];
      this.root.position.set(spot.x, 0, spot.z);
      this.heading = spot.rotY;
      this.root.rotation.y = spot.rotY;
      return;
    }
    const { x, z } = this.root.position;
    this.path = route({ x, z }, spot);
  }

  update(dt: number, time: number, activity: Activity, role: Worker['role'], walkMul: number): void {
    const t = time + this.seed;
    if (this.path.length) this.stepWalk(dt * walkMul);
    const target = this.walking ? this.walkMotion() : this.motionFor(activity, role, t);
    const m = this.m;
    const r = 9;
    m.lift = damp(m.lift, target.lift, this.walking ? 30 : r, dt);
    m.squash = damp(m.squash, target.squash, r * 1.5, dt);
    m.leanX = damp(m.leanX, target.leanX, r, dt);
    m.roll = damp(m.roll, target.roll, r, dt);
    m.turn = damp(m.turn, target.turn, r * 0.6, dt);
    m.arms = damp(m.arms, target.arms, r * 1.5, dt);

    // Breathing on top of everything.
    const breath = 1 + Math.sin(t * 1.6) * 0.012;
    this.body.position.y = m.lift;
    this.body.scale.set((2 - m.squash) * breath, m.squash * breath, (2 - m.squash) * breath);
    this.body.rotation.set(m.leanX, m.turn, m.roll);
    this.mug.visible = target.mug;

    this.animateParts(dt, t);

    if (!this.walking && this.spot) this.heading = angleDamp(this.heading, this.spot.rotY, 8, dt);
    this.root.rotation.y = this.heading;

    const glow = this.hovered ? 0.18 : 0;
    for (const mat of this.highlight) {
      mat.emissive.setRGB(1, 1, 1);
      mat.emissiveIntensity = damp(mat.emissiveIntensity, glow, 14, dt);
    }
    if (this.selected) this.ring.scale.setScalar(1 + Math.sin(time * 3) * 0.05);
    this.headTop = m.lift + HEIGHT * m.squash + 0.06;
  }

  /** Blink, ear twitch, leaf wobble, tail wag, arm gesture. */
  private animateParts(dt: number, t: number): void {
    const { eyes, ears, leaf, tail, arms } = this.parts;
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blinkT = 0;
      this.nextBlink = 2.5 + Math.random() * 4;
    }
    let open = 1;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      open = Math.max(0.1, Math.abs(1 - this.blinkT / 0.08));
      if (this.blinkT > 0.16) this.blinkT = -1;
    }
    if (eyes) {
      const b = this.base.get(eyes)!;
      eyes.scale.set(b.s.x, b.s.y * open, b.s.z);
    }

    this.nextTwitch -= dt;
    if (this.nextTwitch <= 0) {
      this.twitchT = 0;
      this.nextTwitch = 3 + Math.random() * 6;
    }
    let twitch = 0;
    if (this.twitchT >= 0) {
      this.twitchT += dt;
      twitch = Math.sin(this.twitchT * 30) * Math.max(0, 1 - this.twitchT / 0.4) * 0.12;
      if (this.twitchT > 0.4) this.twitchT = -1;
    }
    if (ears) {
      const b = this.base.get(ears)!;
      ears.rotation.set(b.r.x + twitch, b.r.y, b.r.z);
    }
    if (leaf) {
      const b = this.base.get(leaf)!;
      const wobble = this.walking ? Math.sin(this.walkPhase * 2) * 0.18 : Math.sin(t * 1.3) * 0.05;
      leaf.rotation.set(b.r.x + wobble * 0.5, b.r.y, b.r.z + wobble);
    }
    if (tail) {
      const b = this.base.get(tail)!;
      tail.rotation.set(b.r.x, b.r.y + Math.sin(t * (this.walking ? 9 : 2)) * 0.25, b.r.z);
    }
    if (arms) {
      const b = this.base.get(arms)!;
      arms.rotation.set(b.r.x + this.m.arms, b.r.y, b.r.z);
    }
  }

  private stepWalk(dist: number): void {
    const p = this.root.position;
    let remaining = dist * WALK_SPEED;
    while (remaining > 0 && this.path.length) {
      const next = this.path[0];
      const dx = next.x - p.x;
      const dz = next.z - p.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.001) this.heading = angleDamp(this.heading, Math.atan2(dx, dz), 12, 1 / 60);
      if (len <= remaining) {
        p.x = next.x;
        p.z = next.z;
        remaining -= len;
        this.path.shift();
      } else {
        p.x += (dx / len) * remaining;
        p.z += (dz / len) * remaining;
        remaining = 0;
      }
    }
    this.walkPhase += dist * 6;
  }

  private still(pose: Pose): Motion {
    const lift = SEAT_Y[pose] + (pose === 'stand' ? 0 : (this.spot?.lift ?? 0));
    return { lift, squash: pose === 'stand' ? 1 : 0.94, leanX: 0, roll: 0, turn: 0, mug: false, arms: 0 };
  }

  /** Bouncy waddle: hop on every step, squash on landing, rock side to side. */
  private walkMotion(): Motion {
    const s = Math.sin(this.walkPhase);
    const hop = Math.abs(s);
    return {
      lift: hop * 0.09,
      squash: 0.93 + hop * 0.1,
      leanX: 0.08,
      roll: Math.cos(this.walkPhase) * 0.09,
      turn: 0,
      mug: false,
      arms: s * 0.15,
    };
  }

  private motionFor(activity: Activity, role: Worker['role'], t: number): Motion {
    const m = this.still(this.spot?.pose ?? 'seat');
    switch (activity) {
      case 'working':
        // Busy little bounce while typing; research tilts its head, PM looks round the room.
        m.squash += Math.sin(t * (role === 'backend' ? 18 : 12)) * 0.012;
        m.leanX = 0.08;
        m.arms = -0.25 + Math.sin(t * 12) * 0.05;
        if (role === 'research' && t % 7 > 4.2) m.roll = 0.12;
        if (role === 'pm' && t % 9 > 7) m.turn = Math.sin(t * 2) * 0.5;
        break;
      case 'reviewing':
        m.leanX = 0.12 + Math.max(0, Math.sin(t * 1.4)) * 0.05;
        m.arms = -0.2;
        break;
      case 'pairing':
        m.turn = Math.sin(t * 0.9) * 0.2;
        m.leanX = 0.1;
        m.arms = t % 6 > 4.5 ? -0.6 : -0.2;
        break;
      case 'meeting': {
        const speaking = Math.floor(t / 4) % 6 === this.index;
        m.roll = speaking ? Math.sin(t * 6) * 0.06 : 0;
        m.squash += speaking ? Math.abs(Math.sin(t * 5)) * 0.03 : 0;
        m.leanX = speaking ? -0.04 : Math.max(0, Math.sin(t * 1.3)) * 0.06;
        m.arms = speaking ? -0.4 + Math.sin(t * 5) * 0.25 : 0;
        break;
      }
      case 'coffee': {
        const sip = t % 5 > 3.8;
        m.mug = true;
        m.leanX = sip ? -0.12 : 0;
        m.turn = sip ? 0 : Math.sin(t * 0.6) * 0.35;
        m.arms = -0.3;
        break;
      }
      case 'blocked':
        // Deflated: squashed down, leaning back, slow rock.
        m.squash -= 0.06;
        m.leanX = -0.1;
        m.roll = Math.sin(t * 1.2) * 0.07;
        break;
      case 'idle':
        m.turn = Math.sin(t * 0.4) * 0.5;
        m.leanX = -0.04;
        break;
    }
    return m;
  }
}
