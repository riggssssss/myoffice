import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Look } from '../sim/look';
import { ROLES } from '../sim/seed';
import type { Activity, Worker } from '../sim/types';
import { route, type Point, type Pose, type Spot } from './navigation';
import { grainMap, twillMap } from './textures';

const WALK_SPEED = 2.3;
const HEAD_R = 0.21;
const POSE_Y: Record<Pose, number> = { stand: 0.71, seat: 0.53, stool: 0.55 };
const TORSO_Y = 0.04;
const HEAD_Y = 0.54 + HEAD_R;
/** Top of the head (plus a hat) above the pelvis, for placing name tags. */
const HEAD_TOP = TORSO_Y + HEAD_Y + HEAD_R + 0.08;

type Mood = 'neutral' | 'happy' | 'focused' | 'worried';

/** Exponential approach, frame-rate independent. */
const damp = (from: number, to: number, rate: number, dt: number) => from + (to - from) * (1 - Math.exp(-rate * dt));

function angleDamp(from: number, to: number, rate: number, dt: number) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + d * (1 - Math.exp(-rate * dt));
}

const tint = (hex: string, f: number) => '#' + new THREE.Color(hex).multiplyScalar(f).getHexString();

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  return m;
}

const rbox = (w: number, h: number, d: number, r: number, seg = 5) => new RoundedBoxGeometry(w, h, d, seg, r);

/** Put a face feature on the head sphere, facing outward along the surface normal. */
function onHead<T extends THREE.Object3D>(obj: T, x: number, y: number, lift = 0): T {
  const z = Math.sqrt(Math.max(0, HEAD_R * HEAD_R - x * x - y * y));
  const n = new THREE.Vector3(x, y, z).normalize();
  obj.position.copy(n).multiplyScalar(HEAD_R + lift);
  obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  return obj;
}

/** Matte painted vinyl, like the designer toys: soft sheen, faint grain. */
function vinyl(color: string, roughness = 0.5): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, bumpMap: grainMap(), bumpScale: 0.25 });
}

/** Cloth reads slightly rougher with a woven texture. */
function fabric(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.78, map: twillMap(), bumpMap: grainMap(), bumpScale: 0.5 });
}

interface PoseTarget {
  pelvisY: number;
  hipL: number;
  hipR: number;
  kneeL: number;
  kneeR: number;
  torsoX: number;
  armLX: number;
  armLZ: number;
  armRX: number;
  armRZ: number;
  elbowL: number;
  elbowR: number;
  headX: number;
  headY: number;
  headZ: number;
  mug: boolean;
  mood: Mood;
  /** Eye direction, -1 … 1 sideways. null = let the eyes wander. */
  look: number | null;
}

/**
 * Designer vinyl-toy figure (round head, dot eyes, hoodie, wide trousers, chunky
 * sneakers), assembled from a `Look`. Jointed at shoulder/elbow and hip/knee.
 */
export class Avatar {
  readonly root = new THREE.Group();
  readonly look: Look;
  headTop = POSE_Y.seat + HEAD_TOP;

  private pelvis = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private hipL = new THREE.Group();
  private hipR = new THREE.Group();
  private kneeL = new THREE.Group();
  private kneeR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private elbowL = new THREE.Group();
  private elbowR = new THREE.Group();
  private eyes: THREE.Mesh[] = [];
  private eyeGroups: THREE.Group[] = [];
  private brows: THREE.Group[] = [];
  private mouth = new THREE.Group();
  private mug!: THREE.Mesh;
  private ring!: THREE.Mesh;
  private highlight: THREE.MeshStandardMaterial;

  private spot: Spot | null = null;
  private path: Point[] = [];
  private walkPhase = 0;
  private heading = 0;
  private seed = Math.random() * 100;
  private hovered = false;
  private selected = false;
  private nextBlink = 1 + Math.random() * 3;
  private blinkT = -1;
  private glance = 0;
  private nextGlance = 0;
  private frown = 0;

  constructor(
    readonly workerId: string,
    w: Worker,
    readonly index: number,
  ) {
    this.look = w.look;
    const L = w.look;
    const roleColor = ROLES[w.role].color;
    const topColor = L.topColor ?? roleColor;

    const skin = vinyl(L.skin, 0.55);
    const skinShade = vinyl(tint(L.skin, 0.88), 0.6);
    const hair = vinyl(L.hairColor, 0.62);
    const top = fabric(topColor);
    top.emissive.set(topColor);
    top.emissiveIntensity = 0;
    const topTrim = fabric(tint(topColor, 0.86));
    const pants = fabric(L.pantsColor);
    const pantsTrim = fabric(tint(L.pantsColor, 0.88));
    const ink = new THREE.MeshStandardMaterial({ color: '#151311', roughness: 0.15 });

    this.root.add(this.pelvis);
    this.pelvis.position.y = POSE_Y.seat;

    this.buildLegs(pants, pantsTrim, L.shoeColor);
    this.pelvis.add(this.torso);
    this.torso.position.y = TORSO_Y;
    this.highlight = this.buildTop(L, top, topTrim, skin);
    this.buildArms(L, top, topTrim, skin);

    this.head.position.y = HEAD_Y;
    this.torso.add(this.head);
    const skull = mesh(new THREE.SphereGeometry(HEAD_R, 48, 36), skin);
    skull.scale.set(1.04, 1, 1);
    this.head.add(skull);
    this.buildFace(skin, skinShade, ink, L.hairColor);
    this.buildHair(L, hair);
    this.buildFacialHair(L, hair);
    this.buildHeadwear(L, topColor);
    this.buildGlasses(L);

    this.ring = mesh(
      new THREE.RingGeometry(0.46, 0.56, 48),
      new THREE.MeshBasicMaterial({ color: roleColor, transparent: true, opacity: 0.85, depthWrite: false }),
      false,
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.015;
    this.ring.visible = false;
    this.root.add(this.ring);

    this.root.traverse((o) => (o.userData.workerId = workerId));
  }

  // ---------------------------------------------------------------- build

  private buildLegs(pants: THREE.Material, trim: THREE.Material, shoeColor: string): void {
    const hips = mesh(rbox(0.38, 0.18, 0.27, 0.08), pants);
    hips.position.y = -0.01;
    this.pelvis.add(hips);

    const upper = vinyl(shoeColor, 0.45);
    const sole = vinyl('#f3efe6', 0.6);
    const lace = vinyl(shoeColor === '#f1ede4' ? '#25221f' : '#f7f4ee', 0.5);
    for (const [hip, knee, x] of [
      [this.hipL, this.kneeL, -0.1],
      [this.hipR, this.kneeR, 0.1],
    ] as const) {
      hip.position.set(x, -0.03, 0);
      const thigh = mesh(new THREE.CapsuleGeometry(0.1, 0.14, 8, 20), pants);
      thigh.position.y = -0.15;
      hip.add(thigh);
      knee.position.y = -0.3;
      hip.add(knee);
      knee.add(mesh(new THREE.SphereGeometry(0.1, 20, 14), pants));
      // Wide, slightly flared trouser leg with a turned-up cuff.
      const shin = mesh(new THREE.CylinderGeometry(0.1, 0.112, 0.27, 24), pants);
      shin.position.y = -0.125;
      const cuff = mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.035, 24), trim);
      cuff.position.y = -0.25;
      knee.add(shin, cuff);

      const shoe = new THREE.Group();
      shoe.position.set(0, -0.31, 0.04);
      const body = mesh(rbox(0.15, 0.095, 0.27, 0.045, 4), upper);
      const toe = mesh(new THREE.SphereGeometry(0.075, 18, 12), upper);
      toe.scale.set(1, 0.62, 1);
      toe.position.set(0, -0.012, 0.09);
      const base = mesh(rbox(0.165, 0.045, 0.3, 0.02, 3), sole);
      base.position.y = -0.055;
      shoe.add(body, toe, base);
      for (let i = 0; i < 3; i++) {
        const l = mesh(new THREE.BoxGeometry(0.085, 0.008, 0.014), lace, false);
        l.position.set(0, 0.048, 0.06 - i * 0.04);
        shoe.add(l);
      }
      knee.add(shoe);
      this.pelvis.add(hip);
    }
  }

  /** Torso garment. Returns the material that glows on hover. */
  private buildTop(L: Look, top: THREE.MeshStandardMaterial, trim: THREE.Material, skin: THREE.Material) {
    const neck = mesh(new THREE.CylinderGeometry(0.058, 0.065, 0.1, 16), skin);
    neck.position.y = 0.53;
    this.torso.add(neck);

    if (L.top === 'hoodie') {
      const body = mesh(rbox(0.46, 0.5, 0.3, 0.12, 6), top);
      body.position.y = 0.27;
      const hem = mesh(rbox(0.47, 0.06, 0.31, 0.03, 3), trim);
      hem.position.y = 0.045;
      const pocket = mesh(rbox(0.27, 0.13, 0.03, 0.015, 3), trim);
      pocket.position.set(0, 0.15, 0.152);
      this.torso.add(body, hem, pocket);
      if (L.headwear !== 'hood') {
        // Hood down: a soft roll around the neck and a fold over the back.
        const collar = mesh(new THREE.TorusGeometry(0.12, 0.055, 14, 32), top);
        collar.rotation.x = Math.PI / 2;
        collar.position.y = 0.51;
        const fold = mesh(rbox(0.3, 0.2, 0.12, 0.06, 4), top);
        fold.position.set(0, 0.44, -0.16);
        fold.rotation.x = 0.3;
        this.torso.add(collar, fold);
      }
      const cord = vinyl('#f3efe6', 0.6);
      for (const x of [-0.045, 0.045]) {
        const c = mesh(new THREE.CapsuleGeometry(0.008, 0.08, 4, 8), cord, false);
        c.position.set(x, 0.41, 0.155);
        this.torso.add(c);
      }
      return top;
    }

    const teeColor = L.top === 'vest' ? '#ece7dc' : null;
    const tee = teeColor ? fabric(teeColor) : top;
    const body = mesh(rbox(0.42, 0.49, 0.27, 0.1, 6), tee);
    body.position.y = 0.27;
    const collar = mesh(new THREE.TorusGeometry(0.075, 0.014, 8, 28), teeColor ? fabric('#d8d2c5') : trim);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.505;
    this.torso.add(body, collar);
    if (L.top === 'tee') return top;

    // Puffer vest: three stacked quilted segments (the creases fall between them), zip, high collar.
    for (const [y, w] of [
      [0.15, 0.49],
      [0.28, 0.5],
      [0.41, 0.47],
    ]) {
      const seg = mesh(rbox(w, 0.15, 0.33, 0.07, 5), top);
      seg.position.y = y;
      this.torso.add(seg);
    }
    const zip = mesh(new THREE.BoxGeometry(0.012, 0.4, 0.01), vinyl('#c9c3b8', 0.4), false);
    zip.position.set(0, 0.3, 0.163);
    const high = mesh(rbox(0.3, 0.09, 0.25, 0.04, 3), top);
    high.position.set(0, 0.5, -0.01);
    this.torso.add(zip, high);
    return top;
  }

  private buildArms(L: Look, top: THREE.Material, trim: THREE.Material, skin: THREE.Material): void {
    const sleeve = L.top === 'vest' ? fabric('#ece7dc') : top;
    const longSleeve = L.top === 'hoodie';
    for (const [arm, elbow, x] of [
      [this.armL, this.elbowL, -0.255],
      [this.armR, this.elbowR, 0.255],
    ] as const) {
      arm.position.set(x, 0.43, 0);
      const upper = mesh(new THREE.CapsuleGeometry(0.075, 0.14, 8, 16), sleeve);
      upper.position.y = -0.1;
      arm.add(upper);
      elbow.position.y = -0.22;
      arm.add(elbow);
      if (longSleeve) {
        const fore = mesh(new THREE.CapsuleGeometry(0.07, 0.12, 8, 16), sleeve);
        fore.position.y = -0.08;
        const cuff = mesh(new THREE.CylinderGeometry(0.064, 0.064, 0.05, 20), trim);
        cuff.position.y = -0.18;
        elbow.add(fore, cuff);
      } else {
        const fore = mesh(new THREE.CapsuleGeometry(0.055, 0.14, 8, 16), skin);
        fore.position.y = -0.1;
        elbow.add(fore);
      }
      // Rounded fist, like the toy's sculpted hands.
      const hand = mesh(rbox(0.09, 0.1, 0.085, 0.04, 4), skin);
      hand.position.y = -0.265;
      const knuckles = mesh(new THREE.CapsuleGeometry(0.03, 0.05, 4, 10), skin);
      knuckles.rotation.z = Math.PI / 2;
      knuckles.position.set(0, -0.3, 0.012);
      elbow.add(hand, knuckles);
      this.torso.add(arm);
    }

    const mugMat = vinyl('#f4efe6', 0.4);
    this.mug = mesh(new THREE.CylinderGeometry(0.06, 0.052, 0.12, 18), mugMat);
    const handle = mesh(new THREE.TorusGeometry(0.032, 0.011, 6, 12), mugMat);
    handle.position.x = 0.065;
    this.mug.add(handle);
    this.mug.position.set(0, -0.3, 0.07);
    this.mug.visible = false;
    this.elbowR.add(this.mug);
  }

  private buildFace(skin: THREE.Material, shade: THREE.Material, ink: THREE.Material, browColor: string): void {
    for (const side of [-1, 1]) {
      const ear = mesh(new THREE.SphereGeometry(0.048, 18, 14), skin);
      ear.scale.set(0.55, 1, 0.8);
      ear.position.set(side * HEAD_R * 1.02, -0.01, -0.01);
      this.head.add(ear);

      const eyeGroup = onHead(new THREE.Group(), side * 0.068, 0.0, -0.006);
      const eye = mesh(new THREE.SphereGeometry(0.021, 16, 12), ink, false);
      eye.scale.z = 0.5;
      eyeGroup.add(eye);
      this.eyes.push(eye);
      this.eyeGroups.push(eyeGroup);
      this.head.add(eyeGroup);

      const brow = onHead(new THREE.Group(), side * 0.07, 0.058, -0.003);
      const browMesh = mesh(new THREE.CapsuleGeometry(0.007, 0.032, 4, 8), vinyl(tint(browColor, 0.8), 0.5), false);
      browMesh.rotation.z = Math.PI / 2;
      browMesh.scale.z = 0.6;
      brow.add(browMesh);
      this.brows.push(brow);
      this.head.add(brow);
    }
    this.head.add(onHead(mesh(new THREE.SphereGeometry(0.02, 14, 10), shade, false), 0, -0.032, -0.008));

    const arc = Math.PI * 0.6;
    const mouth = mesh(new THREE.TorusGeometry(0.02, 0.0045, 6, 16, arc), ink, false);
    mouth.rotation.z = (3 * Math.PI) / 2 - arc / 2;
    mouth.position.y = 0.02;
    mouth.scale.z = 0.5;
    onHead(this.mouth, 0, -0.078, -0.002);
    this.mouth.add(mouth);
    this.head.add(this.mouth);
  }

  private cap(mat: THREE.Material, scale: number, coverage: number, tilt: number): THREE.Mesh {
    const m = mesh(new THREE.SphereGeometry(HEAD_R * scale, 48, 24, 0, Math.PI * 2, 0, Math.PI * coverage), mat);
    m.rotation.x = tilt;
    m.scale.x = 1.04;
    return m;
  }

  private buildHair(L: Look, mat: THREE.Material): void {
    if (L.hairStyle === 'bald' || L.headwear === 'hood') return;
    const hatted = L.headwear !== 'none';
    const add = (...o: THREE.Object3D[]) => this.head.add(...o);

    if (L.hairStyle === 'buzz') {
      add(this.cap(mat, 1.02, 0.47, -0.4));
      return;
    }
    // Under a hat only the sides and back show, so a lower cap is enough.
    add(this.cap(mat, 1.065, hatted ? 0.5 : 0.45, -0.45));
    if (hatted && L.hairStyle !== 'long' && L.hairStyle !== 'ponytail') return;

    switch (L.hairStyle) {
      case 'fringe': {
        const f = mesh(new THREE.CapsuleGeometry(0.055, 0.17, 8, 16), mat);
        f.scale.z = 0.55;
        onHead(f, 0.03, 0.135, -0.005);
        f.rotateZ(Math.PI / 2 - 0.25);
        add(f);
        break;
      }
      case 'curly': {
        // Golden-angle spiral of curls over the crown, keeping the face clear.
        const n = 42;
        for (let i = 0; i < n; i++) {
          const y = 1 - (i / (n - 1)) * 1.3;
          const r = Math.sqrt(Math.max(0, 1 - y * y));
          const a = i * 2.39996;
          const p = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
          if (p.y < 0.15 && p.z > 0.2) continue;
          if (p.y < -0.25) continue;
          const curl = mesh(new THREE.SphereGeometry(0.058, 12, 10), mat);
          curl.position.copy(p.multiplyScalar(HEAD_R * 1.08));
          add(curl);
        }
        break;
      }
      case 'long': {
        const back = mesh(rbox(0.4, 0.38, 0.1, 0.05, 4), mat);
        back.position.set(0, -0.1, -0.165);
        add(back);
        break;
      }
      case 'bun': {
        const bun = mesh(new THREE.SphereGeometry(0.085, 20, 14), mat);
        bun.position.set(0, 0.2, -0.12);
        add(bun);
        break;
      }
      case 'ponytail': {
        const tie = mesh(new THREE.SphereGeometry(0.045, 14, 10), mat);
        tie.position.set(0, 0.07, -0.21);
        const tail = mesh(new THREE.CapsuleGeometry(0.055, 0.16, 8, 14), mat);
        tail.position.set(0, -0.06, -0.25);
        tail.rotation.x = 0.35;
        add(tie, tail);
        break;
      }
    }
  }

  private buildFacialHair(L: Look, mat: THREE.Material): void {
    const beard = L.facialHair === 'beard' || L.facialHair === 'full';
    const moustache = L.facialHair === 'moustache' || L.facialHair === 'full';
    if (beard) {
      // An ellipsoid sunk into the lower face: only the jaw and chin poke out,
      // so the beard line follows the head naturally, like a sculpted toy beard.
      const jaw = mesh(new THREE.SphereGeometry(HEAD_R * 0.78, 40, 28), mat);
      jaw.scale.set(1.27, 0.8, 0.92);
      jaw.position.set(0, -0.095, 0.045);
      this.head.add(jaw);
      // Mouth sits on top of the beard.
      this.mouth.position.multiplyScalar((HEAD_R + 0.016) / this.mouth.position.length());
    }
    if (moustache) {
      for (const side of [-1, 1]) {
        const half = mesh(new THREE.CapsuleGeometry(0.012, 0.03, 4, 8), mat, false);
        onHead(half, side * 0.022, -0.055, 0.002);
        half.rotateZ(Math.PI / 2 + side * 0.35);
        half.scale.z = 0.6;
        this.head.add(half);
      }
    }
    if (L.facialHair === 'goatee') {
      const g = mesh(new THREE.SphereGeometry(0.035, 16, 12), mat, false);
      g.scale.set(1, 0.85, 0.6);
      onHead(g, 0, -0.15, -0.004);
      this.head.add(g);
    }
  }

  private buildHeadwear(L: Look, topColor: string): void {
    const c = L.headwearColor;
    switch (L.headwear) {
      case 'beanie': {
        const knit = new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, map: twillMap(), bumpMap: grainMap(), bumpScale: 1.2 });
        const dome = mesh(new THREE.SphereGeometry(HEAD_R * 1.13, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), knit);
        dome.scale.set(1.04, 1.28, 1);
        dome.position.y = 0.025;
        dome.rotation.x = -0.12;
        const cuff = mesh(new THREE.CylinderGeometry(HEAD_R * 1.16, HEAD_R * 1.17, 0.085, 48, 1, true), knit);
        cuff.material = knit.clone();
        (cuff.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
        (cuff.material as THREE.MeshStandardMaterial).color.set(tint(c, 0.92));
        cuff.scale.x = 1.04;
        cuff.position.y = 0.035;
        cuff.rotation.x = -0.12;
        this.head.add(dome, cuff);
        break;
      }
      case 'cap': {
        const m = vinyl(c, 0.7);
        const crown = mesh(new THREE.SphereGeometry(HEAD_R * 1.1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), m);
        crown.scale.x = 1.04;
        crown.position.y = 0.03;
        crown.rotation.x = -0.1;
        const brim = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.016, 36), m);
        brim.scale.z = 1.15;
        brim.position.set(0, 0.06, HEAD_R * 0.98);
        brim.rotation.x = 0.14;
        const button = mesh(new THREE.SphereGeometry(0.016, 10, 8), m, false);
        button.position.y = HEAD_R * 1.1 + 0.03;
        this.head.add(crown, brim, button);
        break;
      }
      case 'hat': {
        const m = vinyl(c, 0.75);
        const g = new THREE.Group();
        g.position.y = 0.09;
        g.rotation.x = -0.06;
        const crown = mesh(new THREE.CylinderGeometry(HEAD_R * 0.88, HEAD_R * 1.02, 0.19, 40), m);
        crown.position.y = 0.1;
        const top = mesh(new THREE.SphereGeometry(HEAD_R * 0.88, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2), m);
        top.scale.y = 0.25;
        top.position.y = 0.195;
        const brim = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.016, 48), m);
        const band = mesh(new THREE.CylinderGeometry(HEAD_R * 1.0, HEAD_R * 1.03, 0.04, 40), vinyl(tint(c, 0.55), 0.6));
        band.position.y = 0.03;
        g.add(crown, top, brim, band);
        this.head.add(g);
        break;
      }
      case 'hood': {
        const m = fabric(topColor);
        m.side = THREE.DoubleSide;
        // Shell around the head, open at the face.
        const shell = mesh(new THREE.SphereGeometry(HEAD_R * 1.32, 48, 32, Math.PI / 2 + 1.0, Math.PI * 2 - 2.0, 0, Math.PI * 0.84), m);
        shell.scale.set(1.04, 1.08, 1);
        shell.position.set(0, 0.01, -0.02);
        const rim = mesh(new THREE.TorusGeometry(0.235, 0.038, 12, 48), m);
        rim.scale.set(1, 1.18, 1);
        rim.position.set(0, -0.005, 0.135);
        this.head.add(shell, rim);
        break;
      }
    }
  }

  private buildGlasses(L: Look): void {
    if (L.glasses === 'none') return;
    const frame = new THREE.MeshStandardMaterial({ color: '#1c1a18', roughness: 0.25 });
    const g = onHead(new THREE.Group(), 0, 0.0, 0.016);
    for (const side of [-1, 1]) {
      const ring =
        L.glasses === 'square'
          ? mesh(new THREE.TorusGeometry(0.044, 0.0065, 6, 4), frame, false)
          : mesh(new THREE.TorusGeometry(0.037, 0.0065, 8, 28), frame, false);
      if (L.glasses === 'square') ring.rotation.z = Math.PI / 4;
      ring.position.set(side * 0.068, 0, -0.008);
      g.add(ring);
      if (L.glasses === 'sun') {
        const lens = mesh(new THREE.CircleGeometry(0.036, 24), new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.1, metalness: 0.3 }), false);
        lens.position.set(side * 0.068, 0, -0.01);
        g.add(lens);
      }
      // Temple arm back to the ear, angled out around the head.
      const temple = mesh(new THREE.BoxGeometry(0.007, 0.007, 0.234), frame, false);
      temple.position.set(side * 0.165, 0.005, -0.11);
      temple.rotation.y = -side * 0.54;
      g.add(temple);
    }
    const bridge = mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.03, 6), frame, false);
    bridge.rotation.z = Math.PI / 2;
    bridge.position.set(0, 0.008, -0.002);
    g.add(bridge);
    this.head.add(g);
  }

  // ---------------------------------------------------------------- state

  /** Take over position and route from the figure this one replaces (look or model change). */
  adopt(prev: { root: THREE.Object3D; spotSnapshot(): { spot: Spot | null; path: Point[]; heading: number }; isSelected: boolean }): void {
    const snap = prev.spotSnapshot();
    this.root.position.copy(prev.root.position);
    this.heading = snap.heading;
    this.root.rotation.y = snap.heading;
    this.spot = snap.spot;
    this.path = snap.path;
    this.setSelected(prev.isSelected);
  }

  spotSnapshot() {
    return { spot: this.spot, path: this.path, heading: this.heading };
  }

  get isSelected(): boolean {
    return this.selected;
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
  }

  setRole(color: string): void {
    if (!this.look.topColor) {
      this.highlight.color.set(color);
      this.highlight.emissive.set(color);
    }
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

  /** Head the avatar to a new spot. `instant` skips walking (first frame, reduced motion). */
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

    const target = this.walking ? this.walkPose(t) : this.poseFor(activity, role, t);
    const r = 10;

    this.pelvis.position.y = damp(this.pelvis.position.y, target.pelvisY, r, dt);
    this.hipL.rotation.x = damp(this.hipL.rotation.x, target.hipL, r * 1.5, dt);
    this.hipR.rotation.x = damp(this.hipR.rotation.x, target.hipR, r * 1.5, dt);
    this.kneeL.rotation.x = damp(this.kneeL.rotation.x, target.kneeL, r * 1.5, dt);
    this.kneeR.rotation.x = damp(this.kneeR.rotation.x, target.kneeR, r * 1.5, dt);
    this.torso.rotation.x = damp(this.torso.rotation.x, target.torsoX, r, dt);
    this.armL.rotation.x = damp(this.armL.rotation.x, target.armLX, r * 1.4, dt);
    this.armL.rotation.z = damp(this.armL.rotation.z, target.armLZ, r, dt);
    this.armR.rotation.x = damp(this.armR.rotation.x, target.armRX, r * 1.4, dt);
    this.armR.rotation.z = damp(this.armR.rotation.z, target.armRZ, r, dt);
    this.elbowL.rotation.x = damp(this.elbowL.rotation.x, target.elbowL, r * 1.4, dt);
    this.elbowR.rotation.x = damp(this.elbowR.rotation.x, target.elbowR, r * 1.4, dt);
    this.head.rotation.x = damp(this.head.rotation.x, target.headX, r * 0.6, dt);
    this.head.rotation.y = damp(this.head.rotation.y, target.headY, r * 0.6, dt);
    this.head.rotation.z = damp(this.head.rotation.z, target.headZ, r * 0.6, dt);
    this.mug.visible = target.mug;
    this.updateFace(dt, target);

    if (!this.walking && this.spot) this.heading = angleDamp(this.heading, this.spot.rotY, 8, dt);
    this.root.rotation.y = this.heading;

    this.highlight.emissiveIntensity = damp(this.highlight.emissiveIntensity, this.hovered ? 0.22 : 0, 14, dt);
    if (this.selected) this.ring.scale.setScalar(1 + Math.sin(time * 3) * 0.05);

    this.headTop = this.pelvis.position.y + HEAD_TOP;
  }

  /** Blinks, sideways glances, and a mood read off brows and mouth. */
  private updateFace(dt: number, p: PoseTarget): void {
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blinkT = 0;
      this.nextBlink = 2 + Math.random() * 4;
    }
    let open = 1;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      open = Math.abs(1 - this.blinkT / 0.07);
      if (this.blinkT > 0.14) this.blinkT = -1;
    }
    this.nextGlance -= dt;
    if (this.nextGlance <= 0) {
      this.glance = (Math.random() * 2 - 1) * 0.9;
      this.nextGlance = 1.2 + Math.random() * 2.5;
    }
    const look = p.look ?? this.glance;
    for (const eye of this.eyes) {
      eye.scale.y = Math.max(0.12, open);
      eye.position.x = damp(eye.position.x, look * 0.01, 18, dt);
    }

    const browTilt = { neutral: 0, happy: 0.08, focused: -0.18, worried: 0.38 }[p.mood];
    const browLift = { neutral: 0, happy: 0.008, focused: -0.006, worried: 0.006 }[p.mood];
    this.brows.forEach((b, i) => {
      const side = i === 0 ? -1 : 1;
      b.rotation.z = damp(b.rotation.z, -side * browTilt, 10, dt);
      b.children[0].position.y = damp(b.children[0].position.y, browLift, 10, dt);
    });

    // Scaling the group (pivot = bottom of the curve) flips smile → frown in place.
    this.frown = damp(this.frown, p.mood === 'worried' ? 1 : 0, 8, dt);
    const smile = 1 - 2 * this.frown;
    this.mouth.scale.y = smile * (p.mood === 'happy' ? 1.2 : p.mood === 'focused' ? 0.3 : 0.7);
    this.mouth.scale.x = p.mood === 'happy' ? 1.25 : 1;
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
    this.walkPhase += dist * 7;
  }

  // ---------------------------------------------------------------- poses

  private base(pose: Pose): PoseTarget {
    const seated = pose !== 'stand';
    return {
      // Taller or lower chairs lift or drop the seated pose to their seat.
      pelvisY: POSE_Y[pose] + (seated ? (this.spot?.lift ?? 0) : 0),
      hipL: seated ? -1.5 : 0,
      hipR: seated ? -1.5 : 0,
      kneeL: seated ? 1.45 : 0.03,
      kneeR: seated ? 1.45 : 0.03,
      torsoX: 0,
      armLX: 0.02,
      armLZ: 0.12,
      armRX: 0.02,
      armRZ: -0.12,
      elbowL: -0.12,
      elbowR: -0.12,
      headX: 0,
      headY: 0,
      headZ: 0,
      mug: false,
      mood: 'neutral',
      look: null,
    };
  }

  private walkPose(t: number): PoseTarget {
    const s = Math.sin(this.walkPhase);
    const p = this.base('stand');
    p.pelvisY += Math.abs(Math.cos(this.walkPhase)) * 0.03;
    p.hipL = s * 0.48;
    p.hipR = -s * 0.48;
    p.kneeL = 0.06 + Math.max(0, s) * 0.75;
    p.kneeR = 0.06 + Math.max(0, -s) * 0.75;
    p.armLX = -s * 0.4;
    p.armRX = s * 0.4;
    p.elbowL = -0.3 - Math.max(0, -s) * 0.3;
    p.elbowR = -0.3 - Math.max(0, s) * 0.3;
    p.torsoX = 0.04;
    p.headY = Math.sin(t * 0.7) * 0.12;
    p.mood = 'happy';
    p.look = 0;
    return p;
  }

  private poseFor(activity: Activity, role: Worker['role'], t: number): PoseTarget {
    const p = this.base(this.spot?.pose ?? 'seat');
    // Forearms forward onto the keyboard, fingers tapping.
    const typing = (speed: number) => {
      p.armLX = -0.5;
      p.armRX = -0.5;
      p.elbowL = -1.1 + Math.sin(t * speed) * 0.08;
      p.elbowR = -1.1 + Math.sin(t * speed + 1.7) * 0.08;
      p.armLZ = 0.2;
      p.armRZ = -0.2;
      p.torsoX = 0.1;
      p.headX = 0.08;
      p.mood = 'focused';
      p.look = Math.sin(t * 0.9) * 0.4;
    };

    switch (activity) {
      case 'working': {
        typing(role === 'backend' ? 22 : 13);
        if (role === 'research' && t % 7 > 4.2) {
          // Hand to chin while reading results.
          p.armRX = -0.85;
          p.elbowR = -2.3;
          p.armRZ = -0.35;
          p.headZ = 0.12;
          p.headX = -0.04;
          p.mood = 'neutral';
          p.look = -0.7;
        } else if (role === 'design') {
          p.armRX = -0.55;
          p.elbowR = -1.0;
          p.armRZ = -0.15 + Math.sin(t * 2.2) * 0.1;
          p.armLX = -0.3;
          p.elbowL = -0.9;
        } else if (role === 'pm' && t % 9 > 7) {
          p.headY = Math.sin(t * 2) * 0.6;
          p.look = Math.sin(t * 2) > 0 ? 0.9 : -0.9;
        }
        break;
      }
      case 'reviewing':
        typing(8);
        p.headX = 0.16;
        p.headZ = Math.sin(t * 0.8) * 0.06;
        break;
      case 'pairing': {
        const pointing = t % 6 > 4.5;
        p.armLX = -0.45;
        p.elbowL = -1.0;
        p.armRX = pointing ? -1.25 : -0.45;
        p.elbowR = pointing ? -0.2 : -1.0;
        p.armLZ = 0.2;
        p.armRZ = -0.15;
        p.headY = Math.sin(t * 0.9) * 0.25;
        p.torsoX = 0.14;
        p.mood = pointing ? 'happy' : 'focused';
        p.look = -0.8;
        break;
      }
      case 'meeting': {
        const speaking = Math.floor(t / 4) % 6 === this.index;
        p.armLX = -0.5;
        p.elbowL = -0.95;
        p.armRX = speaking ? -0.75 + Math.sin(t * 5) * 0.2 : -0.5;
        p.elbowR = speaking ? -1.4 : -0.95;
        p.armLZ = 0.25;
        p.armRZ = speaking ? -0.35 : -0.25;
        p.headX = speaking ? -0.05 : Math.max(0, Math.sin(t * 1.3)) * 0.12;
        p.mood = speaking ? 'happy' : 'neutral';
        break;
      }
      case 'coffee': {
        const sip = t % 5 > 3.8;
        p.armRX = sip ? -0.6 : -0.35;
        p.elbowR = sip ? -2.3 : -1.7;
        p.armRZ = sip ? -0.35 : -0.15;
        p.elbowL = -0.2;
        p.headX = sip ? -0.18 : 0;
        p.headY = sip ? 0 : Math.sin(t * 0.6) * 0.5;
        p.mug = true;
        p.mood = 'happy';
        break;
      }
      case 'blocked':
        // Arms crossed, head down.
        p.armLX = -0.4;
        p.armRX = -0.4;
        p.elbowL = -1.95;
        p.elbowR = -1.95;
        p.armLZ = 0.5;
        p.armRZ = -0.5;
        p.torsoX = -0.1;
        p.headX = 0.28;
        p.headY = Math.sin(t * 1.6) * 0.18;
        p.mood = 'worried';
        p.look = 0;
        break;
      case 'idle':
        p.torsoX = p.pelvisY === POSE_Y.stand ? 0 : -0.15;
        p.armLX = -0.15;
        p.armRX = -0.15;
        p.elbowL = -0.4;
        p.elbowR = -0.4;
        p.armLZ = 0.15;
        p.armRZ = -0.15;
        p.headY = Math.sin(t * 0.4) * 0.7;
        p.headX = -0.1;
        break;
    }
    return p;
  }
}
