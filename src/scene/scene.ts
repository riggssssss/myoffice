import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { paintCalendar } from './calendarBoard';

import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { ROLES } from '../sim/seed';
import type { SimState } from '../sim/types';
import { Avatar } from './avatar';
import { TotoroAvatar, totoroTemplate } from './totoro';

type Figure = Avatar | TotoroAvatar;
type SimWorker = SimState['workers'][number];
import { chairStyle, deskStyle, layoutGeometry, layoutItems, layoutRevision, layoutRooms, outdoorStyle, WALL_T, windowStyle, type SkyKind } from '../sim/layout';
import { ambience } from './ambience';
import { cloudify, sunThrough, updateClouds } from './clouds';
import { GROUND_Y, setGroundSheen, setGroundWeather, setPlainColor } from './ground';
import { PuddleMirror } from './puddleMirror';
import { setFoliageWind } from './flora';
import { Rain } from './rain';
import { SkyLight } from './sky';
import { Lightning, Weather, type WeatherMix } from './weather';
import { isEditing } from '../ui/roomState';
import { Labels, type Bubble } from './labels';
import { Links } from './links';
import { entranceSpots, exitSpot, greetSpots, isOutside, patrolSpots, roamStops, spotFor, type Spot } from './navigation';
import { deskOwners, isRequired } from '../sim/ops';
import { icon } from '../ui/icons';
import { loadComputer } from './computer';
import { setWindowGlow } from './furniture';
import { loadChairs, loadDecor, loadDesks, loadLamps, loadPlants, loadSofas, loadWindows } from './plants';
import { setThumbVersion, ThumbRenderer } from './thumbs';
import { Office } from './office';
import { LIGHT, Materials, mixPalette, type ScenePalette } from './palette';
import { sunPosition, sunVector } from './sun';
import { contactShadow } from './textures';
import { RoomEditor } from './roomEditor';

/** Most pixels the 3D view draws at once (about a 2560 × 1440 screen). */
const MAX_PIXELS = 3_700_000;

const CAMERA_DIR = new THREE.Vector3(1, 0.92, 1).normalize();
/** Narrow lens: real perspective (so rotating reads correctly) but still a calm, model-like view. */
const FOV = 26;
const FOCUS_ZOOM = 1.85;
const BLOCKED = new THREE.Color('#d0452f');
/** How far from the middle of the office the light sits (only its direction matters). */
const SUN_DIST = 18.4;
/**
 * The sky as light: a real outdoor HDR (its sun taken out: ours is where the real one is now)
 * fills the shade with sky blue and gives every surface its reflections. It does most of what
 * the flat hemisphere light did, which stays only as a touch of colour.
 */
const ENV_INTENSITY = 0.45;
const HEMI_WITH_SKY = 0.65;
/**
 * Under the weather: the direct sun fades fast as the sky greys (no crisp shadows in the rain),
 * while the sky's own light grows (a bright overcast) and then dims with heavy rain.
 */
const GREY_SKY = 0.25;
const RAIN_SKY = 0.45;
/** Development only: `?sky=rain` (etc.) tries a sky without saving it. */
const DEBUG_SKY = import.meta.env.DEV ? (new URLSearchParams(location.search).get('sky') as SkyKind | null) : null;
/** A grey sky's backdrop, and a lightning flash's tint. */
const STORM_BG = new THREE.Color('#8e959c');
const FLASH_BG = new THREE.Color('#e4eaf6');
/** Moonlight comes from high up, at a fixed angle that reads well. */
const MOON = new THREE.Vector3(7, 14, 9).normalize();
const MOONLIGHT = new THREE.Color('#c3cad6');
const NOON_SUN = new THREE.Color('#fff4e2');
const LOW_SUN = new THREE.Color('#ffb36b');
/**
 * What a white surface looks like outdoors at each sun elevation (degrees): warm white by
 * day, peach in the golden hour, mauve just after sunset, then the blue of the night sky.
 * Never brown: dusk and night light are blue, not dirty.
 */
const GROUND_BY_SUN: [number, string][] = [
  [-18, '#0d0f14'],
  [-10, '#12161f'],
  [-6, '#232b3b'],
  [-3, '#4a6394'],
  [-0.5, '#8a86a8'],
  [2, '#d6a790'],
  [6, '#ecc6a4'],
  [12, '#f2dcc2'],
  [22, '#f3e9da'],
  [40, '#f4efe7'],
  [90, '#f5f2ec'],
];
const ROOM_BOUNCE = new THREE.Color('#f6e2c6');
const ROOM_BOUNCE_GROUND = new THREE.Color('#9a8f80');
const groundA = new THREE.Color();
const groundB = new THREE.Color();

function groundColor(elevation: number): THREE.Color {
  const pts = GROUND_BY_SUN;
  if (elevation <= pts[0][0]) return new THREE.Color(pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const [e1, c1] = pts[i];
    if (elevation <= e1) {
      const [e0, c0] = pts[i - 1];
      // Blend in linear light (Color works in linear), so the midpoints don't go muddy.
      return groundA.set(c0).clone().lerp(groundB.set(c1), (elevation - e0) / (e1 - e0));
    }
  }
  return new THREE.Color(pts[pts.length - 1][1]);
}
/** The soft shade on the floor under someone, where the light can't reach (its own: figures free all they hold). */
const feetShadow = () => contactShadow(0.42, 0.42, 'disc', 0.32, 0.005, true);

/** People go through the entrance one at a time, this far apart. */
const DOOR_GAP_MS = 2400;
/** A slid view glides back to the middle this long after the last drag. */
const PAN_RETURN_MS = 3500;
/** How far past the office's edge the view may be slid. */
const PAN_MARGIN = 2;

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
  private sunDir = MOON.clone();
  /** Where the sun is, for the rooms' light (see applyInterior). */
  private sky = { day: 1, elevation: 45 };
  /** Ceiling lights switched on (1) or off (0), fading between. */
  private lightsOn = 1;
  private skyLight: SkyLight;
  private weather = new Weather();
  private lightning = new Lightning();
  private rain = new Rain();
  private mirror = new PuddleMirror(GROUND_Y);
  /** How dark the weather makes the day (0 clear … 1 storm): lights come on with it. */
  private gloom = 0;
  /** Seconds of weather so far (drives the rain and the ripples). */
  private wxTime = 0;
  /** The light before the weather: set by the time of day, scaled by clouds, rain and lightning. */
  private base = { sun: 1, hemi: 1, env: 0, bg: new THREE.Color() };
  /** Seconds until the scene is checked for new materials to put under the clouds. */
  private cloudScan = 0;
  /** Who is out of the office (hidden); they come back in through the entrance. */
  private away = new Set<string>();
  /** Walks with stops (the sceptic outside, the organiser among the desks): next stop, time left there. */
  private rounds = new Map<string, { stop: number; wait: number }>();
  /** A newcomer's welcome: when they and the interviewer met in reception (0 = not yet). */
  private welcome = { id: '', metAt: 0 };
  /** Queue at the door: when each person coming or going gets their turn (ms). */
  private turns = new Map<string, number>();
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
  /** Middle of the office (camera's resting target) and the extent it frames. */
  private home = new THREE.Vector3(0, 0.4, 0);
  private span = { w: 16, d: 11 };
  private boundsKey = '';
  private thumbs: ThumbRenderer;
  /** When to glide a slid view back (0: not pending). */
  private returnAt = 0;
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
    // Film-like response that keeps the colours as they are and rolls off the highlights.
    // (AgX was tried: it greys out this palette of pale woods and pastels.)
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.skyLight = new SkyLight(this.renderer);
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    container.prepend(this.renderer.domElement);
    // If the browser keeps dropping the 3D view (out of graphics memory, or the GPU is too slow
    // for a frame), go light rather than lose it again and again: no shadows, 1× resolution.
    const losses: number[] = [];
    this.renderer.domElement.addEventListener('webglcontextlost', () => {
      const t = performance.now();
      losses.push(t);
      while (losses.length && t - losses[0] > 120_000) losses.shift();
      if (losses.length >= 2) this.goLight();
    });

    this.labelRenderer.domElement.className = 'labels-layer';
    container.append(this.labelRenderer.domElement);


    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    // Right button (two fingers on touch) slides the view over the floor; it drifts back after a while.
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = false;
    this.controls.panSpeed = 0.8;
    this.controls.minPolarAngle = 0.72;
    this.controls.maxPolarAngle = 1.12;
    // The wheel zooms towards whatever is under the pointer (and drifts home with the pans).
    this.controls.zoomToCursor = true;
    // All the way round: walls facing the camera drop out of the way (see Office.update).
    this.controls.addEventListener('start', () => {
      this.focus = null;
      this.returnAt = 0;
    });
    this.controls.addEventListener('end', () => (this.returnAt = performance.now() + PAN_RETURN_MS));

    this.scene.add(this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    // Soft-edged like real sunlight (the sun is a disc, not a point).
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun, this.sun.target, this.rain.mesh);

    this.office = new Office(this.mats, this.palette);
    this.office.setSun(this.sunDir.clone().negate());
    this.scene.add(this.office.group);
    this.fitBounds();
    this.controls.target.copy(this.home);
    this.syncOffice();
    this.thumbs = new ThumbRenderer(() => this.office.assetList);
    loadComputer()
      .then((t) => this.office.setAsset('computer', t))
      .catch((e) => console.warn('iMac model failed to load; keeping placeholder monitors.', e));
    loadChairs()
      .then((t) => this.office.setAsset('chairs', t))
      .catch((e) => console.warn('Chair models failed to load; chairs show as the classic one.', e));
    loadDesks()
      .then((t) => this.office.setAsset('desks', t))
      .catch((e) => console.warn('Desk models failed to load; Ogi desks show as the classic one.', e));
    loadPlants()
      .then((t) => this.office.setAsset('plants', t))
      .catch((e) => console.warn('Plant model failed to load; keeping placeholder plants.', e));
    loadDecor()
      .then((t) => this.office.setAsset('decor', t))
      .catch((e) => console.warn('Decor models failed to load; keeping placeholder plants.', e));
    loadWindows()
      .then((t) => this.office.setAsset('windows', t))
      .catch((e) => console.warn('Window models failed to load; keeping simple frames.', e));
    loadSofas()
      .then((t) => this.office.setAsset('sofas', t))
      .catch((e) => console.warn('Sofa model failed to load; keeping a simple sofa.', e));
    loadLamps()
      .then((t) => this.office.setAsset('lamps', t))
      .catch((e) => console.warn('Lamp model failed to load; keeping the simple desk lamp.', e));

    totoroTemplate()
      .then((t) => (this.totoro = t))
      .catch((e) => console.warn('Totoro model failed to load; keeping toy figures.', e));

    this.labels = new Labels((id) => this.onSelect(id));
    this.syncPeople(state);
    this.scene.add(this.links.group);
    this.scene.add(this.addButton());

    const el = this.renderer.domElement;
    this.roomEditor = new RoomEditor(this.scene, this.camera, el, this.controls, this.office);
    el.addEventListener('pointerdown', (e) => (this.downAt = e.button === 0 ? { x: e.clientX, y: e.clientY } : null));
    el.addEventListener('pointerup', (e) => this.onPointerUp(e));
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    el.addEventListener('pointerleave', () => this.hover(null));

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  /**
   * Light the office as the real sky is right now at this place: the sun's angle through the
   * windows, day fading into dusk, then lamps and moonlight.
   */
  setDaylight(ms: number, lat: number, lon: number, north: number): void {
    const pos = sunPosition(ms, lat, lon);
    // 0 below civil twilight (−6°), 1 once the sun is 10° up.
    const day = THREE.MathUtils.smoothstep(pos.elevation, -6, 10);
    const sun = sunVector({ ...pos, elevation: Math.max(pos.elevation, 4) }, north);
    this.sunDir.set(sun.x, sun.y, sun.z).lerp(MOON, 1 - day).normalize();

    this.palette = mixPalette(day);
    this.sky = { day, elevation: pos.elevation };
    this.base.bg.copy(groundColor(pos.elevation));
    setPlainColor(this.base.bg);
    this.base.sun = this.palette.sunIntensity;
    // Warm and low at sunrise and sunset, white at midday.
    this.sun.color.copy(LOW_SUN).lerp(NOON_SUN, THREE.MathUtils.smoothstep(pos.elevation, 2, 25));
    // At night it's the moon: cool and blue, not the low sun's orange.
    this.sun.color.lerp(MOONLIGHT, 1 - day);
    this.applyInterior();
    this.office.setSun(this.sunDir.clone().negate());
    this.placeSun();
  }

  /**
   * The rooms' light: daylight plus the ceiling lights, which come up as the sun drops below
   * ~14° (fully on by dusk, mixing with the sunset) while anyone is in. Under them the rooms keep
   * their own colours; with them off at night they sink into the blue dark like the outside.
   */
  private applyInterior(): void {
    const { day, elevation } = this.sky;
    const p = this.palette;
    // On at dusk, and on a dark day too: rain and storms send everyone for the switch.
    const lit = Math.max(1 - THREE.MathUtils.smoothstep(elevation, -4, 14), this.gloom) * this.lightsOn;
    this.office.setStreetLights(Math.max(1 - THREE.MathUtils.smoothstep(elevation, -4, 8), this.gloom));
    // Lights off at night it's dim, not black: the sky's blue still shows the room.
    const inside = mixPalette(Math.max(day, 0.22 + lit * 0.16));
    this.mats.apply(inside);
    // The night sky fills everything with a soft blue; the ceiling lights warm it up only a touch.
    this.hemi.color.set(p.hemiSky).lerp(ROOM_BOUNCE, lit * 0.15);
    this.hemi.groundColor.set(p.hemiGround).lerp(ROOM_BOUNCE_GROUND, lit * 0.25);
    // The night's blue light, outside and in: it shows the ground round the building. The rooms keep
    // their contrast through their own darker colours (see `inside`), not by dimming the night.
    this.base.hemi = p.hemiIntensity * (this.scene.environment ? HEMI_WITH_SKY : 1);
    // The sky's light fades with the day (at night the hemisphere's blue does it).
    this.base.env = ENV_INTENSITY * (0.06 + 0.94 * day);
    this.applyWeather(this.weather.now, 0);
    this.office.setNight(day < 0.5, inside);
    this.office.setInterior(lit);
    // Desk lamps go off with the rest when the last one leaves.
    this.office.setDeskLamps(p.lampIntensity * this.lightsOn);
  }

  /** The last one out switches the lights off; the first one in, on. Fades over a second or so. */
  private updateLightSwitch(state: SimState, dt: number): void {
    const inside = state.working || [...this.avatars.values()].some((a) => a.root.visible && !isOutside(a.root.position));
    const goal = inside ? 1 : 0;
    if (this.lightsOn === goal) return;
    this.lightsOn = this.first || this.reducedMotion ? goal : THREE.MathUtils.clamp(this.lightsOn + Math.sign(goal - this.lightsOn) * dt * 0.8, 0, 1);
    this.applyInterior();
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

  /** An empty team room offers a way to hire its first agent, right on its floor. */
  private addHint!: CSS2DObject;
  private addButton(): CSS2DObject {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'room-add';
    el.innerHTML = `${icon.plus(16)}<span>Añadir agente</span>`;
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      el.dispatchEvent(new CustomEvent('add-agent', { bubbles: true }));
    });
    this.addHint = new CSS2DObject(el);
    this.addHint.visible = false;
    return this.addHint;
  }

  private updateAddButton(state: SimState): void {
    const room = layoutRooms().find((r) => r.name === 'Zona de trabajo') ?? layoutRooms()[0];
    const empty = !state.workers.some((w) => !isRequired(w));
    this.addHint.visible = empty && !this.editing && !!room;
    if (room) this.addHint.position.set((room.x0 + room.x1) / 2, 0.6, (room.z0 + room.z1) / 2);
  }

  refreshLabels(state: SimState): void {
    this.updateAddButton(state);
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
    this.office.setOutdoor(outdoorStyle());
    this.rain.place(layoutRooms(), layoutGeometry().bounds);
    this.office.sync(layoutRooms(), layoutItems(), {
      desk: deskStyle(),
      chairs: { desk: chairStyle('desk'), meeting: chairStyle('meeting') },
      windows: windowStyle(),
    });
    setThumbVersion(this.office.assetsVersion);
    this.fitBounds();
  }

  private light = false;

  private goLight(): void {
    if (this.light) return;
    this.light = true;
    this.renderer.shadowMap.enabled = false;
    this.sun.castShadow = false;
    this.maxRatio = 1;
    this.resize();
    // Shaders were built with shadows: rebuild them without.
    this.scene.traverse((o) => {
      const mats = (o as THREE.Mesh).material;
      if (mats) for (const m of Array.isArray(mats) ? mats : [mats]) m.needsUpdate = true;
    });
    console.warn('Vista 3D en modo ligero: el navegador se quedaba sin memoria gráfica');
  }

  /** At most this pixel ratio (1 once the view has gone light). */
  private maxRatio = 2;

  /** The office grew or shrank: re-aim the sun's shadows and the framing at its new extent. */
  private fitBounds(): void {
    const b = layoutGeometry().bounds;
    const key = `${b.minX}|${b.maxX}|${b.minZ}|${b.maxZ}`;
    if (key === this.boundsKey) return;
    this.boundsKey = key;
    this.home.set((b.minX + b.maxX) / 2, 0.4, (b.minZ + b.maxZ) / 2);
    this.span = { w: b.maxX - b.minX, d: b.maxZ - b.minZ };
    this.placeSun();
    if (this.fitDist) this.resize();
  }

  /** The light sits along the sun's direction from the middle, its shadows covering the office. */
  private placeSun(): void {
    this.sun.target.position.set(this.home.x, 0, this.home.z);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, SUN_DIST);
    // Over the office and the ground round it, where the building's shadow falls.
    const r = Math.hypot(this.span.w, this.span.d) / 2 + 15;
    Object.assign(this.sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: SUN_DIST + r * 2 });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  /** People come and go as you hire them: one figure and one tag each. */
  private syncPeople(state: SimState): void {
    state.workers.forEach((w, i) => {
      if (this.avatars.has(w.id)) return;
      const a = this.makeFigure(w, i);
      this.avatars.set(w.id, a);
      a.root.add(feetShadow());
      this.scene.add(a.root, this.labels.add(w));
      // Hired just now: starts outside, and walks in when it's their turn.
      if (!this.first) this.hideFigure(w.id, a);
    });
    if (this.avatars.size === state.workers.length) return;
    for (const [id, a] of this.avatars) {
      if (state.workers.some((w) => w.id === id)) continue;
      this.scene.remove(a.root);
      a.dispose();
      this.avatars.delete(id);
      const tag = this.labels.remove(id);
      if (tag) this.scene.remove(tag);
      this.away.delete(id);
      this.turns.delete(id);
      if (this.hoveredId === id) this.hover(null);
      if (this.selectedId === id) this.setSelected(null);
    }
  }

  /** The time of day's light, under the weather (and a lightning flash, 0–1). */
  private applyWeather(w: WeatherMix, flash: number): void {
    const b = this.base;
    // The clouds' shade does the darkening (see clouds.ts); the sun itself only softens a little.
    this.sun.intensity = b.sun * (1 - 0.2 * w.dark);
    this.hemi.intensity = b.hemi * (1 + 0.25 * w.dark - 0.3 * w.rain) + flash * 1.4;
    this.scene.environmentIntensity = b.env * (1 + GREY_SKY * w.dark) * (1 - RAIN_SKY * w.rain) + flash * 1.6;
    const bg = this.scene.background instanceof THREE.Color ? this.scene.background : (this.scene.background = new THREE.Color());
    bg.copy(b.bg).lerp(STORM_BG, w.dark * 0.5 * this.sky.day).lerp(FLASH_BG, flash * 0.4);
  }

  /** The weather chosen in «Editar oficina» (or the real one): clouds, rain, wet ground, lightning. */
  private updateWeather(dt: number): void {
    this.weather.update(DEBUG_SKY ?? outdoorStyle().sky, dt);
    const w = this.weather.now;
    // What it sounds like: birds, rain, the storm. With the storm audible, each flash goes just
    // before a thunderclap in the recording; otherwise the lightning comes at random.
    ambience.update(w.rain, w.storm, this.sky.day, w.dark);
    this.lightning.external = ambience.drivesLightning();
    const clap = ambience.strikeDue(0.5 + Math.random() * 0.4);
    if (clap) this.lightning.strike(clap);
    const flash = this.lightning.update(dt, w.storm, this.reducedMotion);
    const env = this.skyLight.update(w.dark, w.rain);
    if (env) {
      const first = !this.scene.environment;
      this.scene.environment = env;
      // The hemisphere light steps back once the sky light is there.
      if (first) this.applyInterior();
    }
    // Clouds drift over (still, for reduced motion) and dim the sun through the windows with them.
    updateClouds(this.reducedMotion ? 0 : dt, this.sunDir, w, this.sky.day);
    this.office.setVeil(sunThrough(this.home.x, this.home.z));
    this.wxTime += dt;
    setGroundWeather(this.weather.wet, this.weather.puddles, this.wxTime, w.rain);
    // In bright sun the table's sheen all but goes (the sunlit ground outshines it).
    setGroundSheen(1 - 0.7 * this.sky.day * (1 - w.dark));
    this.rain.update(dt, w.rain, w.wind, 1 - this.sky.day, this.reducedMotion);
    // Trees bend more as the wind gets up (still, for reduced motion).
    setFoliageWind(this.wxTime, this.reducedMotion ? 0 : 0.35 + 0.65 * w.wind + 1.2 * w.storm);
    const gloom = THREE.MathUtils.smoothstep(w.dark, 0.5, 0.95);
    if (Math.abs(gloom - this.gloom) > 0.02) {
      this.gloom = gloom;
      this.applyInterior();
    }
    this.applyWeather(w, flash);
  }

  frame(dt: number, time: number, state: SimState): void {
    this.syncOffice();
    this.updateWeather(dt);
    if ((this.cloudScan -= dt) <= 0) {
      this.cloudScan = 1;
      cloudify(this.scene);
    }
    this.syncPeople(state);
    // While furnishing, people jump straight to their (possibly moved) seats.
    const instant = this.first || this.reducedMotion || this.editing;

    const door = entranceSpots();
    let atDoor = false;
    const n = state.workers.length;
    const welcome = this.welcomeSpots(state);

    state.workers.forEach((w, i) => {
      let a = this.avatars.get(w.id);
      if (!a) return;
      if (a.look !== w.look || (a instanceof Avatar && this.wantsTotoro(w))) a = this.rebuild(a, w, i);
      a.setRole(ROLES[w.role].color);
      // Everyone has their own way home, fanned out in front of the entrance.
      const home = exitSpot(i, n);

      const now = performance.now();
      if (w.activity === 'away') {
        // Going home, one after another: out through the entrance and off along their own
        // path, gone at its end. Until their turn they stay where they are.
        if (this.away.has(w.id)) return;
        if (instant || !home) this.hideFigure(w.id, a);
        else if (now >= this.turnAt(w.id, now)) {
          a.goTo(home, false);
          if (!a.walking) this.hideFigure(w.id, a);
        }
      } else if (this.away.has(w.id)) {
        // Coming in (or just hired), one after another: back along that same path and in.
        if (!instant && home && now < this.turnAt(w.id, now)) return;
        this.turns.delete(w.id);
        this.away.delete(w.id);
        a.root.visible = true;
        this.labels.show(w.id, true);
        if (home && !instant) a.goTo(home, true);
      } else this.turns.delete(w.id);
      if (!this.away.has(w.id)) {
        if (w.activity !== 'away') a.goTo(welcome.get(w.id) ?? this.placeFor(w, i, state, a, dt), instant);
        a.update(dt, time, w.activity, w.role, 1);
      }
      const p = a.root.position;
      // Out on the ground the feet sit lower than the office floor.
      p.y = isOutside(p) ? -WALL_T : 0;
      if (door && a.root.visible && Math.hypot(p.x - (door.inside.x + door.outside.x) / 2, p.z - (door.inside.z + door.outside.z) / 2) < 1.7) atDoor = true;
      // Guests sit right next to their host: lift their tag so the two don't overlap.
      // A guest helping at someone's desk stands right beside them: lift the guest's tag clear.
      const guest = w.activity === 'pairing' && !a.walking;
      this.labels.place(w.id, p.x, a.headTop + (guest ? 0.75 : 0.28) + p.y, p.z);
    });
    this.first = false;
    this.office.setDoorOpen(atDoor);

    this.updateScreens(state);
    this.updateLightSwitch(state, dt);
    this.updateLinks(state, time, dt);
    this.updateBubbles(state);
    paintCalendar(state.events, Date.now());
    this.roomEditor.update(layoutRevision());
    this.updateCamera(dt);
    this.controls.update();
    this.limitPan();
    this.office.update(this.camera, this.controls.target, dt, instant && !this.editing);
    if (this.editing) this.thumbs.process();
    this.renderer.render(this.scene, this.camera);
    // The ground's mirror image, while there are puddles to show it or the plain table's sheen
    // (drawn after the view, once the shadows exist; the ground shows it from the next frame).
    const outdoors = this.office.outdoors;
    const lit = this.office.interiorLight;
    this.mirror.render(this.renderer, this.scene, this.camera, outdoors ? [outdoors, this.rain.mesh] : [], !!outdoors && (this.weather.puddles > 0.02 || this.office.plainGround), (out) =>
      setWindowGlow(out ? lit : 0),
    );
    this.labelRenderer.render(this.scene, this.camera);
    // The label renderer stacks by distance; the add button always sits above the name tags.
    this.addHint.element.style.zIndex = '100000';
  }

  /** When it's someone's turn through the door: a moment after whoever went before them. */
  private turnAt(id: string, now: number): number {
    let t = this.turns.get(id);
    if (t === undefined) {
      t = this.turns.size ? Math.max(now, ...this.turns.values()) + DOOR_GAP_MS : now;
      this.turns.set(id, t);
    }
    return t;
  }

  private hideFigure(id: string, a: Figure): void {
    this.turns.delete(id);
    this.away.add(id);
    a.root.visible = false;
    this.labels.show(id, false);
    if (this.hoveredId === id) this.hover(null);
  }

  private placeFor(w: SimWorker, i: number, state: SimState, a: Figure, dt: number): Spot {
    if (w.activity === 'patrolling') return this.nextStop(w.id, a, dt, patrolSpots());
    if (w.activity === 'roaming') {
      const team = deskOwners(state.workers).filter((o) => o.role !== 'director' && o.activity !== 'away');
      return this.nextStop(w.id, a, dt, roamStops(team.map((o) => o.desk)));
    }
    return spotFor(w, i, state.workers);
  }

  /**
   * A newcomer's welcome: they and the interviewer meet face to face in reception, then walk
   * together to the meeting table (where spotFor seats them). Returns overrides by person.
   */
  private welcomeSpots(state: SimState): Map<string, Spot> {
    const out = new Map<string, Spot>();
    const guest = state.workers.find((w) => w.activity === 'interview');
    const host = state.workers.find((w) => w.activity === 'interviewing');
    const spots = greetSpots();
    if (!guest || !host || !spots || guest.interviewSince === null) return out;
    if (this.welcome.id !== guest.id) this.welcome = { id: guest.id, metAt: 0 };
    // Opening the page mid-interview: they've long since met.
    if (Date.now() - guest.interviewSince > 40_000 && !this.welcome.metAt) this.welcome.metAt = 1;
    if (!this.welcome.metAt) {
      const g = this.avatars.get(guest.id);
      const h = this.avatars.get(host.id);
      const there = (f: Figure | undefined, s: Spot) => !!f && !f.walking && Math.hypot(f.root.position.x - s.x, f.root.position.z - s.z) < 0.35;
      if (there(g, spots.guest) && there(h, spots.host)) this.welcome.metAt = performance.now();
    }
    // A short greeting once both are there, then off to the table.
    if (!this.welcome.metAt || performance.now() - this.welcome.metAt < 2500) {
      out.set(guest.id, spots.guest);
      out.set(host.id, spots.host);
    }
    return out;
  }

  /** Next stop on a walk with stops; lingers a few seconds at each before moving on. */
  private nextStop(id: string, a: Figure, dt: number, stops: Spot[]): Spot {
    let r = this.rounds.get(id);
    if (!r) {
      // Start from the stop nearest to where they are.
      const p = a.root.position;
      const near = stops.reduce((best, s, i) => (Math.hypot(s.x - p.x, s.z - p.z) < Math.hypot(stops[best].x - p.x, stops[best].z - p.z) ? i : best), 0);
      this.rounds.set(id, (r = { stop: near, wait: 3 }));
    }
    const at = stops[r.stop % stops.length];
    if (!a.walking && Math.hypot(a.root.position.x - at.x, a.root.position.z - at.z) < 0.3) {
      r.wait -= dt;
      if (r.wait <= 0) {
        r.stop = (r.stop + 1) % stops.length;
        r.wait = 4 + Math.random() * 5;
      }
    }
    return stops[r.stop % stops.length];
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
    next.root.add(feetShadow());
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
        case 'away':
          intensity = 0;
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
    // People talking: one arc per conversation, in the colour of whoever started it.
    for (const c of state.conversations) {
      const a = this.avatars.get(c.a);
      const b = this.avatars.get(c.b);
      const starter = state.workers.find((w) => w.id === c.a);
      const on = c.endedAt === null && !!a && !!b && a.root.visible && b.root.visible;
      if (!a || !b) continue;
      pairs.set(`talk-${c.id}`, {
        a: a.root.position.clone().setY(a.headTop - 0.1),
        b: b.root.position.clone().setY(b.headTop - 0.1),
        color: starter ? ROLES[starter.role].color : '#888888',
        visible: on && !a.walking && !b.walking,
      });
    }
    this.links.update(pairs, time, dt, !this.reducedMotion);
  }

  /**
   * Over each head in a conversation: their last line for as long as it takes to say it, or
   * the typing dots (and the tool they're using) while their AI works.
   */
  private updateBubbles(state: SimState): void {
    const now = Date.now();
    const out = new Map<string, Bubble>();
    for (const c of state.conversations) {
      if (c.endedAt !== null) continue;
      const last = c.lines[c.lines.length - 1];
      if (last && now - last.at < Math.min(16_000, 5000 + last.text.length * 50)) out.set(last.speaker, { convId: c.id, kind: 'say', text: last.text });
      if (c.thinking) out.set(c.thinking.who, { convId: c.id, kind: 'think', text: c.thinking.tool ?? '' });
    }
    // Round the meeting table with you: the last thing each said, or that they're thinking.
    const m = state.meeting;
    if (m) {
      const last = [...m.lines].reverse().find((l) => l.speaker !== 'owner');
      if (last && now - last.at < Math.min(18_000, 5000 + last.text.length * 50)) out.set(last.speaker, { convId: '', kind: 'say', text: last.text });
      if (m.thinking) out.set(m.thinking.who, { convId: '', kind: 'think', text: m.thinking.tool ?? '' });
    }
    // Heads-down at the desk: a quiet note of what they're on.
    for (const w of state.workers) if (w.busyWith && !out.has(w.id)) out.set(w.id, { convId: '', kind: 'think', text: w.busyWith });
    // The organiser working on one of your requests, then telling you what they did.
    const organizer = state.workers.find((w) => w.role === 'organizer');
    const req = state.requests.find((r) => r.status === 'working' || (r.status === 'done' && now - (r.doneAt ?? 0) < 12_000));
    if (organizer && req) {
      out.set(organizer.id, req.status === 'working' ? { convId: req.id, kind: 'think', text: req.tool ?? 'leyendo tu encargo' } : { convId: req.id, kind: 'say', text: req.reply ?? '' });
    }
    // The head working out who the project needs.
    const ideas = state.hireIdeas;
    if (ideas?.status === 'thinking' && ideas.by && !out.has(ideas.by)) out.set(ideas.by, { convId: '', kind: 'think', text: 'pensando a quién contratar' });
    // Telling you something (a reminder, a proposal): they say it out loud for a moment too.
    for (const msg of state.inbox) {
      if (now - msg.at > 10_000) break;
      if (!out.has(msg.from)) out.set(msg.from, { convId: '', kind: 'say', text: msg.text });
    }
    for (const id of out.keys()) {
      const a = this.avatars.get(id);
      // Only people in view get one; walking doesn't hide it (that flickered at the end of a walk).
      if (!a || !a.root.visible) out.delete(id);
    }
    this.labels.setBubbles(out);
  }

  /** Keep the slid view over the office, and send it home a few seconds after the last drag. */
  private limitPan(): void {
    const b = layoutGeometry().bounds;
    const t = this.controls.target;
    const x = THREE.MathUtils.clamp(t.x, b.minX - PAN_MARGIN, b.maxX + PAN_MARGIN);
    const z = THREE.MathUtils.clamp(t.z, b.minZ - PAN_MARGIN, b.maxZ + PAN_MARGIN);
    const dx = x - t.x;
    const dz = z - t.z;
    if (dx || dz) {
      t.x += dx;
      t.z += dz;
      this.camera.position.x += dx;
      this.camera.position.z += dz;
    }
    if (!this.returnAt || this.focus || performance.now() < this.returnAt) return;
    this.returnAt = 0;
    // Back to whoever is selected, else to the middle of the office; the zoom stays as it is.
    const dist = this.camera.position.distanceTo(t);
    const followed = this.selectedId && this.avatars.has(this.selectedId) ? this.selectedId : null;
    const goal = followed ? this.avatars.get(followed)!.root.position : this.home;
    if (Math.hypot(goal.x - t.x, goal.z - t.z) > 0.05) this.focus = { followId: followed, dist };
  }

  private updateCamera(dt: number): void {
    if (!this.focus) return;
    const goal = this.tmpA;
    const followed = this.focus.followId ? this.avatars.get(this.focus.followId) : null;
    if (followed) goal.copy(followed.root.position).setY(0.8);
    else goal.copy(this.home);

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
    // Height of the view at the target plane that keeps the whole floor in frame (from any side).
    const k = Math.hypot(this.span.w, this.span.d) / 19.4;
    const viewH = Math.max(13 * k, ((aspect < 1 ? 19 : 21.5) * k) / aspect);
    const fit = viewH / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    if (!this.fitDist) {
      this.camera.position.copy(this.home).addScaledVector(CAMERA_DIR, fit);
      this.camera.lookAt(this.home);
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
    // Sharp on Retina, but never a drawing buffer so big the browser runs out of graphics
    // memory and drops the context (a large window at 2× with antialiasing is hundreds of MB).
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.maxRatio, Math.sqrt(MAX_PIXELS / (w * h))));
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
  }

  private pick(e: PointerEvent): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const roots = [...this.avatars.values()].filter((a) => a.root.visible).map((a) => a.root);
    const hit = this.raycaster.intersectObjects(roots, true).find((h) => h.object.visible && h.object.userData.workerId);
    return hit ? (hit.object.userData.workerId as string) : null;
  }

  /** The wall planner under the pointer, if any (people in front of it come first). */
  private pickCalendar(): boolean {
    const pages: THREE.Object3D[] = [];
    this.office.group.traverseVisible((o) => {
      if (o.userData.calendar) pages.push(o);
    });
    return pages.length > 0 && this.raycaster.intersectObjects(pages, false).length > 0;
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
    const id = this.pick(e);
    this.hover(id);
    if (!id) this.renderer.domElement.style.cursor = this.pickCalendar() ? 'pointer' : '';
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.downAt) return;
    const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
    this.downAt = null;
    if (moved > 6 || isEditing()) return;
    const id = this.pick(e);
    if (!id && this.pickCalendar()) {
      this.renderer.domElement.dispatchEvent(new CustomEvent('open-calendar', { bubbles: true }));
      return;
    }
    this.onSelect(id);
  }
}
