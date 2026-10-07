import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { ROLES } from '../sim/seed';
import type { SimState } from '../sim/types';
import { Avatar } from './avatar';
import { TotoroAvatar, totoroTemplate } from './totoro';

type Figure = Avatar | TotoroAvatar;
type SimWorker = SimState['workers'][number];
import { deskStyle, floorKind, layoutItems, layoutRevision, wallKind } from '../sim/layout';
import { isEditing } from '../ui/roomState';
import { Labels } from './labels';
import { Links } from './links';
import { spotFor } from './navigation';
import { loadComputer } from './computer';
import { loadDecor, loadDesks, loadPlants } from './plants';
import { Office } from './office';
import { DARK, LIGHT, Materials, type ScenePalette } from './palette';
import { RoomEditor } from './roomEditor';

const HOME_TARGET = new THREE.Vector3(0.2, 0.4, 0);
const CAMERA_DIR = new THREE.Vector3(1, 0.92, 1).normalize();
/** Narrow lens: real perspective (so rotating reads correctly) but still a calm, model-like view. */
const FOV = 26;
const FOCUS_ZOOM = 1.85;
const BLOCKED = new THREE.Color('#d0452f');

export class OfficeScene {
  private renderer: THREE.WebGLRenderer;
  private labelRenderer = new CSS2DRenderer();
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 400);
  private controls: OrbitControls;
  private hemi = new THREE.HemisphereLight();
  private sun = new THREE.DirectionalLight('#fff4e2');
  private mats = new Materials();
  private palette: ScenePalette = LIGHT;
  private office: Office;
  private avatars = new Map<string, Figure>();
  /** Set once the Totoro model has loaded; until then everyone shows as a toy figure. */
  private totoro: THREE.Object3D | null = null;
  private labels: Labels;
  private links = new Links();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private downAt: { x: number; y: number } | null = null;
  private hoveredId: string | null = null;
  private selectedId: string | null = null;
  /** Camera follows this goal until the user grabs the controls. */
  private focus: { followId: string | null; dist: number } | null = null;
  /** Camera distance that frames the whole office for the current aspect. */
  private fitDist = 0;
  private first = true;
  private roomEditor: RoomEditor;
  /** Layout revision + model loads the office was last built for. */
  private builtFor = '';
  private editing = false;
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  reducedMotion = false;

  constructor(
    private container: HTMLElement,
    state: SimState,
    private onSelect: (id: string | null) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    container.prepend(this.renderer.domElement);

    this.labelRenderer.domElement.className = 'labels-layer';
    container.append(this.labelRenderer.domElement);


    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(HOME_TARGET);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = 0.72;
    this.controls.maxPolarAngle = 1.12;
    this.controls.minAzimuthAngle = Math.PI / 4 - 0.75;
    this.controls.maxAzimuthAngle = Math.PI / 4 + 0.75;
    this.controls.addEventListener('start', () => (this.focus = null));

    this.scene.add(this.hemi);
    this.sun.position.set(7, 14, 9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 40 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun);

    this.office = new Office(this.mats, this.palette);
    this.scene.add(this.office.group);
    this.syncOffice();
    loadComputer()
      .then((t) => this.office.setAsset('computer', t))
      .catch((e) => console.warn('iMac model failed to load; keeping placeholder monitors.', e));
    loadDesks()
      .then((t) => this.office.setAsset('desks', t))
      .catch((e) => console.warn('Desk models failed to load; Ogi desks show as the classic one.', e));
    loadPlants()
      .then((t) => this.office.setAsset('plants', t))
      .catch((e) => console.warn('Plant model failed to load; keeping placeholder plants.', e));
    loadDecor()
      .then((t) => this.office.setAsset('decor', t))
      .catch((e) => console.warn('Decor models failed to load; keeping placeholder plants.', e));

    state.workers.forEach((w, i) => {
      const a = this.makeFigure(w, i);
      this.avatars.set(w.id, a);
      this.scene.add(a.root);
    });

    totoroTemplate()
      .then((t) => (this.totoro = t))
      .catch((e) => console.warn('Totoro model failed to load; keeping toy figures.', e));

    this.labels = new Labels(state.workers, (id) => this.onSelect(id));
    for (const obj of this.labels.objects()) this.scene.add(obj);
    this.scene.add(this.links.group);

    const el = this.renderer.domElement;
    this.roomEditor = new RoomEditor(this.scene, this.camera, el, this.controls, this.office);
    el.addEventListener('pointerdown', (e) => (this.downAt = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => this.onPointerUp(e));
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    el.addEventListener('pointerleave', () => this.hover(null));

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  setTheme(dark: boolean): void {
    this.palette = dark ? DARK : LIGHT;
    const p = this.palette;
    this.scene.background = new THREE.Color(p.background);
    this.mats.apply(p);
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.sun.intensity = p.sunIntensity;
    this.office.setNight(dark, p);
  }

  setSelected(id: string | null): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    for (const [wid, a] of this.avatars) a.setSelected(wid === id);
    const current = this.camera.position.distanceTo(this.controls.target);
    this.focus = id
      ? { followId: id, dist: Math.min(current, this.fitDist / FOCUS_ZOOM) }
      : { followId: null, dist: this.fitDist };
  }

  refreshLabels(state: SimState): void {
    this.labels.refresh(state, this.selectedId);
  }

  /** Room editor on/off: figures snap to their seats, tags and links step aside, camera may look straight down. */
  setEditing(on: boolean): void {
    if (this.editing === on) return;
    this.editing = on;
    this.hover(null);
    this.labels.setVisible(!on);
    this.links.group.visible = !on;
    this.controls.minPolarAngle = on ? 0.12 : 0.72;
    if (on) this.setSelected(null);
  }

  /**
   * A screen direction (right = +x, up = +y) as a floor direction along the room axis
   * closest to it, so arrow keys move objects the way they look on screen.
   */
  screenToFloor(sx: number, sy: number): { x: number; z: number } {
    const fwd = this.tmpA.subVectors(this.controls.target, this.camera.position).setY(0).normalize();
    const right = this.tmpB.set(-fwd.z, 0, fwd.x);
    const x = right.x * sx + fwd.x * sy;
    const z = right.z * sx + fwd.z * sy;
    return Math.abs(x) >= Math.abs(z) ? { x: Math.sign(x), z: 0 } : { x: 0, z: Math.sign(z) };
  }

  /** Where the camera is looking, on the floor: new objects go near here. */
  focusPoint(): { x: number; z: number } {
    return { x: this.controls.target.x, z: this.controls.target.z };
  }

  private syncOffice(): void {
    const key = `${layoutRevision()}|${this.office.assetsVersion}`;
    if (key === this.builtFor) return;
    this.builtFor = key;
    this.office.sync(layoutItems(), deskStyle());
    this.office.setFloor(floorKind());
    this.office.setWalls(wallKind());
  }

  frame(dt: number, time: number, state: SimState): void {
    this.syncOffice();
    const walkMul = Math.max(1, Math.sqrt(state.speed || 1));
    // While furnishing, people jump straight to their (possibly moved) seats.
    const instant = this.first || this.reducedMotion || this.editing;

    state.workers.forEach((w, i) => {
      let a = this.avatars.get(w.id);
      if (!a) return;
      if (a.look !== w.look || (a instanceof Avatar && this.wantsTotoro(w))) a = this.rebuild(a, w, i);
      a.setRole(ROLES[w.role].color);
      a.goTo(spotFor(w, i, state.workers), instant);
      a.update(dt, time, w.activity, w.role, walkMul);
      const p = a.root.position;
      // Guests sit right next to their host: lift their tag so the two don't overlap.
      this.labels.place(w.id, p.x, a.headTop + (a.pose === 'stool' ? 1.15 : 0.28), p.z);
    });
    this.first = false;

    this.updateScreens(state);
    this.updateLinks(state, time, dt);
    this.roomEditor.update(layoutRevision());
    this.updateCamera(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  /** Appearance changed: swap in a freshly built figure at the same spot. */
  private wantsTotoro(w: SimWorker): boolean {
    return w.look.model === 'totoro' && !!this.totoro;
  }

  private makeFigure(w: SimWorker, index: number): Figure {
    return this.wantsTotoro(w)
      ? new TotoroAvatar(w.id, w.look, index, this.totoro!, ROLES[w.role].color)
      : new Avatar(w.id, w, index);
  }

  private rebuild(old: Figure, w: SimWorker, index: number): Figure {
    const next = this.makeFigure(w, index);
    next.adopt(old);
    this.scene.remove(old.root);
    old.dispose();
    this.scene.add(next.root);
    this.avatars.set(w.id, next);
    if (this.hoveredId === w.id) next.setHover(true);
    return next;
  }

  private updateScreens(state: SimState): void {
    const glow = this.palette.screenGlow;
    for (const w of state.workers) {
      const screen = this.office.screenFor(w.desk);
      if (!screen) continue;
      const guest = state.workers.some((o) => o.pairWith === w.id && o.activity === 'pairing');
      const role = new THREE.Color(ROLES[w.role].color);
      let intensity = 0.08;
      let color = role;
      switch (w.activity) {
        case 'working':
        case 'reviewing':
          intensity = guest ? 1.25 : 1;
          break;
        case 'blocked':
          color = BLOCKED;
          intensity = 1;
          break;
        case 'meeting':
        case 'coffee':
          intensity = 0.25;
          break;
        case 'pairing':
        case 'idle':
          intensity = 0.08;
          break;
      }
      screen.color.set(this.palette.screenOff);
      screen.emissive.copy(color);
      screen.emissiveIntensity = intensity * glow;
    }
  }

  private updateLinks(state: SimState, time: number, dt: number): void {
    const pairs = new Map<string, { a: THREE.Vector3; b: THREE.Vector3; color: string; visible: boolean }>();
    for (const w of state.workers) {
      const a = this.avatars.get(w.id);
      const partner = state.workers.find((o) => o.id === w.pairWith);
      const b = partner && this.avatars.get(partner.id);
      if (!a) continue;
      const from = a.root.position.clone().setY(a.headTop - 0.1);
      const to = b ? b.root.position.clone().setY(b.headTop - 0.1) : from.clone();
      pairs.set(w.id, {
        a: from,
        b: to,
        color: ROLES[w.role].color,
        visible: !!b && w.activity === 'pairing',
      });
    }
    this.links.update(pairs, time, dt, !this.reducedMotion);
  }

  private updateCamera(dt: number): void {
    if (!this.focus) return;
    const goal = this.tmpA;
    const followed = this.focus.followId ? this.avatars.get(this.focus.followId) : null;
    if (followed) goal.copy(followed.root.position).setY(0.8);
    else goal.copy(HOME_TARGET);

    const k = this.reducedMotion ? 1 : 1 - Math.exp(-5 * dt);
    const offset = this.tmpB.copy(this.camera.position).sub(this.controls.target);
    const dist = offset.length();
    const nextDist = dist + (this.focus.dist - dist) * k;
    this.controls.target.lerp(goal, k);
    this.camera.position.copy(this.controls.target).addScaledVector(offset.normalize(), nextDist);

    // Overview tween ends once we're home; following a person continues until the user drags.
    if (!followed && this.controls.target.distanceTo(goal) < 0.01 && Math.abs(nextDist - this.focus.dist) < 0.01) {
      this.focus = null;
    }
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    const aspect = w / h;
    // Height of the view at the target plane that keeps the whole floor in frame.
    const viewH = Math.max(13, (aspect < 1 ? 19 : 21.5) / aspect);
    const fit = viewH / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    if (!this.fitDist) {
      this.camera.position.copy(HOME_TARGET).addScaledVector(CAMERA_DIR, fit);
      this.camera.lookAt(HOME_TARGET);
    } else {
      // Keep the user's relative framing when the viewport changes.
      const offset = this.camera.position.clone().sub(this.controls.target).multiplyScalar(fit / this.fitDist);
      this.camera.position.copy(this.controls.target).add(offset);
      if (this.focus) this.focus.dist *= fit / this.fitDist;
    }
    this.fitDist = fit;
    this.controls.minDistance = fit * 0.32;
    this.controls.maxDistance = fit * 1.3;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
  }

  private pick(e: PointerEvent): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const roots = [...this.avatars.values()].map((a) => a.root);
    const hit = this.raycaster.intersectObjects(roots, true).find((h) => h.object.visible && h.object.userData.workerId);
    return hit ? (hit.object.userData.workerId as string) : null;
  }

  private hover(id: string | null): void {
    if (id === this.hoveredId) return;
    if (this.hoveredId) this.avatars.get(this.hoveredId)?.setHover(false);
    this.hoveredId = id;
    if (id) this.avatars.get(id)?.setHover(true);
    this.renderer.domElement.style.cursor = id ? 'pointer' : '';
  }

  private onPointerMove(e: PointerEvent): void {
    if (e.pointerType !== 'mouse' || e.buttons || isEditing()) return;
    this.hover(this.pick(e));
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.downAt) return;
    const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
    this.downAt = null;
    if (moved > 6 || isEditing()) return;
    this.onSelect(this.pick(e));
  }
}
