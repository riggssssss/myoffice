import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FLOOR, WINDOWS, type DeskStyle, type FloorKind, type Item, type WallKind } from '../sim/layout';
import { floorTexture, WALL_PAINT, wallTexture } from './floors';
import { buildItem, type Assets, type MatFn } from './furniture';
import { Materials, type ScenePalette } from './palette';
import { groundShadow } from './textures';

/** Wall thickness and height. The floor is exactly as thick as the walls. */
const WALL_T = 0.2;
const WALL_H = 2.8;
const SLAB_BOTTOM = -WALL_T;
/** The floor finish is a thin board set into the slab, its edge showing along the open sides. */
const BOARD = 0.04;

/** Axis-aligned box from min/max corners, as geometry ready to merge. */
function slab(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Free what one object owns; shared model geometry and palette materials stay. */
function dispose(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (!o.userData.shared) o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (!m.userData.shared) m.dispose();
  });
}

interface Placed {
  /** Rebuild when this changes: kind, desk decor or style, or a model finished loading. */
  sig: string;
  root: THREE.Group;
  screen?: THREE.MeshStandardMaterial;
  lamp?: THREE.PointLight;
}

/** The room shell (floor, walls, windows) plus every object in the layout. */
export class Office {
  readonly group = new THREE.Group();
  /** Movable objects only: what the room editor picks from. */
  readonly items = new THREE.Group();
  private placed = new Map<string, Placed>();
  private screens = new Map<number, THREE.MeshStandardMaterial>();
  private assets: Assets = { computer: null, desks: null, plants: null, decor: null };
  private assetsRev = 0;
  private lampIntensity = 0;
  private windows: THREE.MeshStandardMaterial;
  private shadow: THREE.Mesh;
  private floorMat: THREE.MeshStandardMaterial;
  private floorKind: FloorKind = 'plain';
  private night = false;
  /** Finish on the inside faces of the walls; hidden for the plain wall. */
  private cladding: THREE.Mesh[] = [];
  private wallMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  private wallKind: WallKind = 'plain';
  private palette: ScenePalette;
  private m: MatFn;

  constructor(mats: Materials, palette: ScenePalette) {
    this.palette = palette;
    this.m = (slot, extra) => mats.get(slot, palette, extra);
    const m = this.m;
    const { minX, maxX, minZ, maxZ } = FLOOR;

    // One shell: slab under the floor plus the two cut-away walls (back + left, so the camera
    // always sees in). The pieces meet edge to edge without overlapping and share one
    // material, so the room reads as a single cast piece with no seams or doubled layers.
    const shellGeo = mergeGeometries([
      slab(minX - WALL_T, maxX, SLAB_BOTTOM, -BOARD, minZ - WALL_T, maxZ),
      slab(minX - WALL_T, maxX, -BOARD, WALL_H, minZ - WALL_T, minZ),
      slab(minX - WALL_T, minX, -BOARD, WALL_H, minZ, maxZ),
    ]);
    const shell = new THREE.Mesh(shellGeo, m('wall'));
    shell.castShadow = true;
    shell.receiveShadow = true;
    this.group.add(shell);

    // Wall finish: a skin on the two inner faces, with UVs in metres so textures keep their
    // real scale on walls of any length.
    const skin = (w: number, h: number) => {
      const g = new THREE.PlaneGeometry(w, h);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
      const mesh = new THREE.Mesh(g, this.wallMat);
      mesh.receiveShadow = true;
      mesh.visible = false;
      return mesh;
    };
    const back = skin(maxX - minX, WALL_H);
    back.position.set((minX + maxX) / 2, WALL_H / 2, minZ + 0.002);
    const left = skin(maxZ - minZ, WALL_H);
    left.rotation.y = Math.PI / 2;
    left.position.set(minX + 0.002, WALL_H / 2, (minZ + maxZ) / 2);
    this.cladding = [back, left];
    this.group.add(back, left);

    this.floorMat = new THREE.MeshStandardMaterial({ color: palette.floor, roughness: 0.85 });
    const floor = box(maxX - minX, BOARD, maxZ - minZ, this.floorMat, (minX + maxX) / 2, -BOARD / 2, (minZ + maxZ) / 2);
    floor.castShadow = false;
    this.group.add(floor);

    // The backdrop is the table the model stands on: paint the shadow the shell really casts
    // on it, lit from the left so it falls to the right on screen (+x, −z in the default view).
    const H = WALL_H - SLAB_BOTTOM;
    const blocks = [
      { x0: minX - WALL_T, x1: maxX, z0: minZ - WALL_T, z1: maxZ, h: WALL_T },
      { x0: minX - WALL_T, x1: maxX, z0: minZ - WALL_T, z1: minZ, h: H },
      { x0: minX - WALL_T, x1: minX, z0: minZ, z1: maxZ, h: H },
    ];
    const pad = 2.2;
    const bounds = { x0: minX - WALL_T - pad, x1: maxX + pad, z0: minZ - WALL_T - pad, z1: maxZ + pad };
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0),
      new THREE.MeshBasicMaterial({
        map: groundShadow(blocks, bounds, { x: 0.27, z: -0.27 }),
        color: '#000000',
        transparent: true,
        depthWrite: false,
        opacity: 0.55,
      }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.set((bounds.x0 + bounds.x1) / 2, SLAB_BOTTOM - 0.002, (bounds.z0 + bounds.z1) / 2);
    this.shadow.renderOrder = -1;
    this.group.add(this.shadow);

    this.windows = new THREE.MeshStandardMaterial({ color: palette.window, roughness: 0.3, emissive: '#000000' });
    for (const { x, w: ww } of WINDOWS) {
      const frame = box(ww, 1.3, 0.04, m('wallTrim'), x, 1.65, FLOOR.minZ + 0.01);
      const glass = box(ww - 0.2, 1.1, 0.04, this.windows, x, 1.65, FLOOR.minZ + 0.03);
      glass.castShadow = false;
      this.group.add(frame, glass);
    }
    this.group.add(this.items);
  }

  /** A model finished loading: what uses it is rebuilt on the next sync. */
  setAsset<K extends keyof Assets>(key: K, value: Assets[K]): void {
    this.assets[key] = value;
    this.assetsRev++;
  }

  get assetsVersion(): number {
    return this.assetsRev;
  }

  /** Bring the 3D objects in line with the layout. */
  sync(items: readonly Item[], style: DeskStyle): void {
    const seen = new Set<string>();
    const styleKey = `${style.model}/${style.top}/${style.frame}`;
    this.screens.clear();
    for (const item of items) {
      seen.add(item.id);
      const sig = `${item.kind}|${item.decor ?? ''}|${this.assetsRev}|${item.kind === 'desk' ? styleKey : ''}`;
      let p = this.placed.get(item.id);
      if (!p || p.sig !== sig) {
        if (p) this.drop(p);
        const built = buildItem(item, this.m, this.assets, style);
        built.obj.userData.itemId = item.id;
        if (built.lamp) built.lamp.intensity = this.lampIntensity;
        p = { sig, root: built.obj, screen: built.screen, lamp: built.lamp };
        this.placed.set(item.id, p);
        this.items.add(p.root);
      }
      p.root.position.set(item.x, 0, item.z);
      p.root.rotation.y = item.rot;
      if (p.screen && item.slot !== undefined) this.screens.set(item.slot, p.screen);
    }
    for (const [id, p] of this.placed) {
      if (seen.has(id)) continue;
      this.drop(p);
      this.placed.delete(id);
    }
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

  /** Swap the floor finish; the plain floor keeps the palette colour. */
  setFloor(kind: FloorKind): void {
    if (kind === this.floorKind && this.floorMat.userData.ready) return;
    this.floorKind = kind;
    this.floorMat.userData.ready = true;
    const { minX, maxX, minZ, maxZ } = FLOOR;
    this.floorMat.map = floorTexture(kind, maxX - minX, maxZ - minZ);
    this.floorMat.needsUpdate = true;
    this.tintFloor();
  }

  /** Swap the wall finish; 'plain' shows the bare shell. */
  setWalls(kind: WallKind): void {
    if (kind === this.wallKind && this.wallMat.userData.ready) return;
    this.wallKind = kind;
    this.wallMat.userData.ready = true;
    this.wallMat.map = wallTexture(kind);
    this.wallMat.needsUpdate = true;
    for (const c of this.cladding) c.visible = kind !== 'plain';
    this.tintWalls();
  }

  private tintWalls(): void {
    const paint = WALL_PAINT[this.wallKind];
    this.wallMat.color.set(paint ?? '#ffffff');
    // Dim at night like the palette does for the bare walls.
    if (this.night) this.wallMat.color.multiplyScalar(paint ? 0.32 : 0.42);
  }

  /** Textures carry their own colour; at night they are dimmed like everything else. */
  private tintFloor(): void {
    if (this.floorKind === 'plain') this.floorMat.color.set(this.palette.floor);
    else this.floorMat.color.set(this.night ? '#6f675d' : '#ffffff');
  }

  setNight(night: boolean, p: ScenePalette): void {
    this.night = night;
    this.palette = p;
    this.tintFloor();
    this.tintWalls();
    this.windows.color.set(p.window);
    this.windows.emissive.set(night ? '#1d2a3a' : '#000000');
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = night ? 0.8 : 0.55;
    this.lampIntensity = p.lampIntensity;
    for (const placed of this.placed.values()) if (placed.lamp) placed.lamp.intensity = p.lampIntensity;
  }
}
