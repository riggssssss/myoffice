import * as THREE from 'three';
import { WALL_T, wallOf, type BenchModel, type Item, type LampModel, type Room } from '../sim/layout';
import { FLORA, loadFlora, plant, type Planting } from './flora';
import { fadeOut, FADE, surfaceMaterial, surfaceTile, wetten, type Surface } from './ground';
import { benchObject, lampObject, loadStreet, streetNight } from './street';

/**
 * The garden round the office: a stone path from the door to the street, with a little paved
 * landing and a bench either side; the pavement and the road beyond it, with street lamps that
 * light up at night; trees (a few already turning, it's autumn), bushes, a hedge and flowering
 * shrubs along the walls; and on the lawn itself, tufts of long grass, clover and daisies,
 * thickest near the building. Laid out from a fixed seed, so it's the same every visit, and kept
 * off the ground people walk on: round the walls, out of the door and off to the street. The
 * plants arrive a moment after the rest (their models load once, see flora.ts).
 */
const GROUND_Y = -WALL_T;

/** Distances out from the door's wall (m): the pavement, the road, the far pavement. */
const WALK = { from: 7, to: 9.3 };
const ROAD = { from: 9.3, to: 16.1 };
const FAR = { from: 16.1, to: 18.1 };

type Box = { minX: number; maxX: number; minZ: number; maxZ: number };

/** A small seeded random: the same garden every time for the same office. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Distance from a point to the building's footprint (0 inside). */
const fromBuilding = (b: Box, x: number, z: number) => Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));

/**
 * A flat ribbon along a line (xz points), `width` wide, lying at `y`; UVs in metres so the
 * surface's photo keeps its scale.
 */
function ribbon(points: THREE.Vector2[], width: number, surface: Surface, y: number): THREE.Mesh {
  const tile = surfaceTile(surface);
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  let along = 0;
  points.forEach((p, i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dir = next.clone().sub(prev).normalize();
    const n = new THREE.Vector2(-dir.y, dir.x).multiplyScalar(width / 2);
    if (i) along += p.distanceTo(points[i - 1]);
    pos.push(p.x + n.x, y, p.y + n.y, p.x - n.x, y, p.y - n.y);
    uv.push(0, along / tile, width / tile, along / tile);
    if (i) {
      const k = i * 2;
      index.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  // Facing up whichever way the line runs.
  if (g.attributes.normal.getY(0) < 0) {
    g.setIndex(index.map((_, i) => index[i - (i % 3) + (2 - (i % 3))]));
    g.computeVertexNormals();
  }
  const m = new THREE.Mesh(g, surfaceMaterial(surface));
  m.receiveShadow = true;
  m.renderOrder = -2;
  return m;
}

/** The soft pool of lamplight on the ground, made once. */
let pool: THREE.CanvasTexture | undefined;

export interface Landscape {
  group: THREE.Group;
  /** Street lamps: 0 by day, 1 at night. */
  setNight(k: number): void;
}

export function buildLandscape(rooms: readonly Room[], b: Box, door: Item | undefined, furniture: { bench: BenchModel; lamp: LampModel }): Landscape {
  const group = new THREE.Group();
  const rand = seeded(Math.round((b.maxX - b.minX) * 97 + (b.maxZ - b.minZ) * 13 + (door ? door.x * 7 + door.z * 3 : 0)));
  const wall = door ? wallOf(door, rooms) : undefined;
  // Out of the door, and along the street.
  const out = wall ? new THREE.Vector2(-wall.inward.x, -wall.inward.z) : new THREE.Vector2(0, 1);
  const side = new THREE.Vector2(-out.y, out.x);
  const origin = door && wall ? new THREE.Vector2(door.x, door.z).addScaledVector(out, WALL_T / 2) : new THREE.Vector2((b.minX + b.maxX) / 2, out.y > 0 ? b.maxZ : b.minZ);
  const at = (o: number, s: number) => origin.clone().addScaledVector(out, o).addScaledVector(side, s);
  /** A point's place relative to the door: how far out, and how far along the street. */
  const local = (x: number, z: number) => {
    const d = new THREE.Vector2(x, z).sub(origin);
    return { o: d.dot(out), s: d.dot(side) };
  };
  const reach = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + FADE;
  const pools: THREE.MeshBasicMaterial[] = [];

  // ---- the street: pavement, road with its markings, the far pavement.
  const band = (from: number, to: number, surface: Surface, y: number) =>
    group.add(ribbon([at((from + to) / 2, -reach), at((from + to) / 2, reach)], to - from, surface, y));
  band(WALK.from, WALK.to, 'brick', GROUND_Y + 0.04);
  band(ROAD.from, ROAD.to, 'asphalt', GROUND_Y + 0.002);
  band(FAR.from, FAR.to, 'brick', GROUND_Y + 0.04);
  // Kerbs: the pavement's edge standing up from the road.
  const kerbMat = wetten(fadeOut(new THREE.MeshStandardMaterial({ color: '#b7b3ab', roughness: 0.85 })), 0.3);
  for (const o of [WALK.to, FAR.from]) {
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, reach * 2), kerbMat);
    const p = at(o, 0);
    kerb.position.set(p.x, GROUND_Y + 0.03, p.y);
    kerb.rotation.y = Math.atan2(side.x, side.y);
    kerb.receiveShadow = true;
    group.add(kerb);
  }
  // Dashed centre line.
  const paint = wetten(fadeOut(new THREE.MeshStandardMaterial({ color: '#e9e6dc', roughness: 0.6 })), 0.15, 0.15);
  const dash = new THREE.PlaneGeometry(0.14, 2.2).rotateX(-Math.PI / 2);
  const mid = (ROAD.from + ROAD.to) / 2;
  const dashes = new THREE.InstancedMesh(dash, paint, Math.ceil((reach * 2) / 5));
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(side.x, side.y));
  for (let i = 0; i < dashes.count; i++) {
    const p = at(mid, -reach + i * 5);
    dashes.setMatrixAt(i, m4.compose(new THREE.Vector3(p.x, GROUND_Y + 0.006, p.y), q, new THREE.Vector3(1, 1, 1)));
  }
  dashes.receiveShadow = true;
  group.add(dashes);
  // A solid line along each edge of the road, just in from the kerb.
  for (const o of [ROAD.from + 0.35, ROAD.to - 0.35]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.12, reach * 2).rotateX(-Math.PI / 2), paint);
    const p = at(o, 0);
    line.position.set(p.x, GROUND_Y + 0.006, p.y);
    line.rotation.y = Math.atan2(side.x, side.y);
    line.receiveShadow = true;
    group.add(line);
  }

  // ---- the way in: a paved landing at the door and a brick path straight out to the pavement.
  const pathPts = door ? Array.from({ length: 12 }, (_, i) => at(1.2 + ((WALK.from + 0.2 - 1.2) * i) / 11, 0)) : [];
  if (door) {
    group.add(ribbon([at(0.1, 0), at(2.4, 0)], 3.6, 'brick', GROUND_Y + 0.006));
    group.add(ribbon(pathPts, 1.7, 'brick', GROUND_Y + 0.005));
  }
  const fromPath = (x: number, z: number) => (pathPts.length ? Math.min(...pathPts.map((p) => Math.hypot(p.x - x, p.y - z))) : 99);

  // ---- benches, one either side of the path, facing it.
  const benches = () => {
    if (!door) return;
    for (const [o, s] of [
      [3.4, -2.1],
      [4.9, 2.1],
    ]) {
      const bench = benchObject(furniture.bench);
      if (!bench) return;
      const p = at(o, s);
      const toPath = at(o, 0).sub(p);
      bench.position.set(p.x, GROUND_Y, p.y);
      bench.rotation.y = Math.atan2(toPath.x, toPath.y);
      group.add(bench);
    }
  };

  // ---- street lamps along the pavement, and their pools of light at night.
  pool ??= new THREE.CanvasTexture(
    (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, 'rgba(255,214,150,1)');
      grad.addColorStop(0.45, 'rgba(255,200,130,0.35)');
      grad.addColorStop(1, 'rgba(255,190,120,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      return c;
    })(),
  );
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 14;
  const lampPosts = () => {
    for (let s = -span; s <= span; s += 11) {
      if (door && Math.abs(s) < 1.5) continue;
      const made = lampObject(furniture.lamp);
      if (!made) return;
      const p = at(WALK.from + 0.45, s);
      made.obj.position.set(p.x, GROUND_Y + 0.04, p.y);
      // The arm reaches out over the road.
      made.obj.rotation.y = Math.atan2(out.x, out.y);
      group.add(made.obj);
      const poolMat = new THREE.MeshBasicMaterial({ map: pool!, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      pools.push(poolMat);
      const light = new THREE.Mesh(new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2), poolMat);
      const lp = at(WALK.from + 0.45 + made.reach, s);
      light.position.set(lp.x, GROUND_Y + 0.06, lp.y);
      light.renderOrder = 1;
      group.add(light);
    }
  };
  // The bench and lamp models load once; the first garden waits for them.
  void loadStreet().then(() => {
    benches();
    lampPosts();
    setNight(night);
  });

  // ---- trees, bushes and flowers: wherever there's room and nobody walks.
  type Spot = { x: number; z: number };
  const trees: Spot[] = [];
  const bushes: Spot[] = [];
  const onStreet = (o: number) => o > WALK.from - 0.3 && o < FAR.to + 0.3;
  const clearOf = (x: number, z: number, near: number) => {
    const d = fromBuilding(b, x, z);
    if (d < near) return false;
    const { o, s } = local(x, z);
    // The street (with a margin), and where people come and go in front of the door.
    if (o > WALK.from - 1.6 && o < FAR.to + 1.2) return false;
    if (door && o > -1 && o < WALK.from && Math.abs(s) < 15) return false;
    if (fromPath(x, z) < 2.4) return false;
    return true;
  };
  const tooClose = (list: Spot[], x: number, z: number, gap: number) => list.some((t) => Math.hypot(t.x - x, t.z - z) < gap);
  const ring = 30;
  for (let i = 0; i < 900 && trees.length < 30; i++) {
    const x = b.minX - ring + rand() * (b.maxX - b.minX + ring * 2);
    const z = b.minZ - ring + rand() * (b.maxZ - b.minZ + ring * 2);
    const d = fromBuilding(b, x, z);
    if (d > 27 || !clearOf(x, z, 7.5) || tooClose(trees, x, z, 5.5)) continue;
    // Thicker towards the back and sides: a garden, not a forest.
    if (rand() < 0.25) continue;
    trees.push({ x, z });
  }
  // Bushes along the walls (clear of the walk round the building) and by the path.
  for (let i = 0; i < 700 && bushes.length < 22; i++) {
    const x = b.minX - 6 + rand() * (b.maxX - b.minX + 12);
    const z = b.minZ - 6 + rand() * (b.maxZ - b.minZ + 12);
    const d = fromBuilding(b, x, z);
    if (d < 2.4 || d > 4.5 || !clearOf(x, z, 2.4) || tooClose(bushes, x, z, 1.7)) continue;
    bushes.push({ x, z });
  }
  // A few big shrubs and a stretch of hedge further out, between the trees.
  const big: Spot[] = [];
  const hedges: Spot[] = [];
  for (let i = 0; i < 600 && big.length + hedges.length < 9; i++) {
    const x = b.minX - 14 + rand() * (b.maxX - b.minX + 28);
    const z = b.minZ - 14 + rand() * (b.maxZ - b.minZ + 28);
    const d = fromBuilding(b, x, z);
    if (d < 5.5 || d > 13 || !clearOf(x, z, 5.5) || tooClose([...trees, ...big, ...hedges], x, z, 4)) continue;
    (rand() < 0.4 ? hedges : big).push({ x, z });
  }

  // The lawn underfoot: tufts of long grass, clover and daisies, thickest near the walls and
  // thinning out to bare lawn where the ground melts into the backdrop.
  const landing = (x: number, z: number) => {
    const { o, s } = local(x, z);
    return door !== undefined && o > -0.5 && o < 2.8 && Math.abs(s) < 2.2;
  };
  const lawnFree = (x: number, z: number, near: number) => {
    const d = fromBuilding(b, x, z);
    if (d < near || onStreet(local(x, z).o) || landing(x, z) || fromPath(x, z) < 1.1) return false;
    // Fewer and fewer further out.
    return rand() < 1 - smooth(6, 14, d);
  };
  const scatter = (count: number, near: number) => {
    const out: Spot[] = [];
    const r = 15;
    for (let i = 0; i < count * 4 && out.length < count; i++) {
      const x = b.minX - r + rand() * (b.maxX - b.minX + r * 2);
      const z = b.minZ - r + rand() * (b.maxZ - b.minZ + r * 2);
      if (lawnFree(x, z, near)) out.push({ x, z });
    }
    return out;
  };
  // Long grass grows in clumps: thick where it's taken, the lawn mown short in between.
  const tufts: Spot[] = [];
  for (const c of scatter(520, 0.6)) {
    const n = 6 + Math.floor(rand() * 14);
    const r = 0.35 + rand() * 0.6;
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const k = Math.sqrt(rand()) * r;
      const x = c.x + Math.cos(a) * k;
      const z = c.z + Math.sin(a) * k;
      if (fromBuilding(b, x, z) > 0.45 && !onStreet(local(x, z).o) && fromPath(x, z) > 1) tufts.push({ x, z });
    }
  }
  const clover = scatter(170, 0.9);
  // Daisies come in drifts: a few centres, each patch near one of them.
  const drifts = scatter(9, 3);
  const daisies = scatter(900, 1).filter((p) => drifts.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 3 + rand() * 2.5)).slice(0, 60);

  void loadFlora().then((kit) => {
    /** Spread a list over some of the kit's plants, each copy turned and sized its own way. */
    const sow = (names: readonly string[], spots: Spot[], size: () => number, shadows: boolean, autumn = 0) => {
      const by = new Map<string, Planting[]>();
      for (const t of spots) {
        const name = names[Math.floor(rand() * names.length)];
        const list = by.get(name) ?? [];
        list.push({ x: t.x, y: GROUND_Y, z: t.z, yaw: rand() * Math.PI * 2, scale: size(), bright: 0.88 + rand() * 0.2, autumn: rand() < autumn ? 0.55 + rand() * 0.45 : rand() * 0.12 });
        by.set(name, list);
      }
      for (const [name, list] of by) {
        const p = kit.get(name);
        if (p) plant(group, p, list, shadows);
      }
    };
    sow(FLORA.trees, trees, () => 0.75 + rand() * 0.3, true, 0.22);
    sow([...FLORA.bushes, ...FLORA.flowering], bushes, () => 0.8 + rand() * 0.45, true, 0.1);
    sow([FLORA.bigBush], big, () => 0.7 + rand() * 0.3, true, 0.15);
    sow([FLORA.hedge], hedges, () => 0.85 + rand() * 0.25, true);
    sow(FLORA.grass, tufts, () => 0.09 + rand() * 0.08, false, 0.05);
    sow(FLORA.clover, clover, () => 0.45 + rand() * 0.35, false);
    sow(FLORA.daisies, daisies, () => 0.27 + rand() * 0.14, false);
  });

  let night = 0;
  function setNight(k: number): void {
    night = k;
    streetNight(k);
    for (const m of pools) m.opacity = 0.55 * k;
  }
  return { group, setNight };
}
