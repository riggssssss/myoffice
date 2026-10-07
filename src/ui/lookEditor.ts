import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Avatar } from '../scene/avatar';
import { TotoroAvatar, totoroTemplate } from '../scene/totoro';
import {
  CLOTH_COLORS,
  FACIAL_HAIR,
  GLASSES,
  HAIR_COLORS,
  HAIR_STYLES,
  HEADWEAR,
  MODELS,
  PANTS_COLORS,
  randomLook,
  SEED_LOOKS,
  DEFAULT_LOOK,
  SHOE_COLORS,
  SKINS,
  TOPS,
  type Look,
  type Option,
  type Swatch,
} from '../sim/look';
import { ROLES } from '../sim/seed';
import { updateLook, worker } from '../sim/store';
import { esc } from './dom';
import { icon } from './icons';

type Key = keyof Look;

/** Live 3D turntable of one worker, shown while the editor is open. */
class Preview {
  private renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  private controls: OrbitControls;
  private avatar: Avatar | TotoroAvatar | null = null;
  private version = 0;
  private raf = 0;
  private last = performance.now();
  private resizeObs: ResizeObserver;
  private framed = false;
  private destroyed = false;

  constructor(private host: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    host.append(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight('#fff6ea', '#b9a98f', 1.6));
    const key = new THREE.DirectionalLight('#fff3e0', 2.4);
    key.position.set(2, 4, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const rim = new THREE.DirectionalLight('#dfe8ff', 0.9);
    rim.position.set(-3, 2, -2);
    this.scene.add(key, rim);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.7, 48), new THREE.ShadowMaterial({ opacity: 0.18 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.camera.position.set(0, 1.1, 3.6);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.88, 0);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.minDistance = 1.4;
    this.controls.maxDistance = 4.5;
    this.controls.minPolarAngle = 0.9;
    this.controls.maxPolarAngle = 1.75;
    this.controls.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.controls.autoRotateSpeed = 1.6;
    this.controls.addEventListener('start', () => (this.controls.autoRotate = false));

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.resize();
    this.loop(performance.now());
  }

  async show(workerId: string): Promise<void> {
    if (this.destroyed) return;
    const w = worker(workerId);
    if (!w) return;
    const version = ++this.version;
    const template = w.look.model === 'totoro' ? await totoroTemplate().catch(() => null) : null;
    // A newer change arrived while the model was loading.
    if (version !== this.version) return;
    if (this.avatar) {
      this.scene.remove(this.avatar.root);
      this.avatar.dispose();
    }
    const color = ROLES[w.role].color;
    this.avatar = template ? new TotoroAvatar(w.id, w.look, 0, template, color) : new Avatar(w.id, w, 0);
    this.avatar.setRole(color);
    this.avatar.goTo({ key: 'preview', x: 0, z: 0, rotY: 0, pose: 'stand' }, true);
    this.controls.target.y = template ? 0.55 : 0.88;
    this.avatar.root.traverse((o) => (o.castShadow = true));
    this.scene.add(this.avatar.root);
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Short, wide stage (phone layout) needs to back off to keep head-to-toe in frame.
    if (!this.framed) {
      this.framed = true;
      const dist = w / h > 0.9 ? 4.4 : 3.6;
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    }
  }

  private loop = (now: number) => {
    // rAF timestamps can predate performance.now() taken at construction: never step backwards.
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.avatar?.update(dt, now / 1000, 'idle', 'research', 1);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  };

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.avatar?.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function chips<T extends string>(key: Key, options: Option<T>[], current: string, disabled: (id: T) => string | null = () => null) {
  return `<div class="chips" role="group">${options
    .map((o) => {
      const why = disabled(o.id);
      return `<button type="button" class="chip" data-look="${key}" data-value="${o.id}" aria-pressed="${o.id === current}" ${
        why ? `disabled title="${esc(why)}"` : ''
      }>${o.label}</button>`;
    })
    .join('')}</div>`;
}

function swatches(key: Key, list: Swatch[], current: string | null, extra = '') {
  return `<div class="swatches" role="group">${extra}${list
    .map(
      (s) =>
        `<button type="button" class="swatch" style="--swatch:${s.color}" data-look="${key}" data-value="${s.color}" aria-pressed="${
          s.color === current
        }" aria-label="${esc(s.label)}" title="${esc(s.label)}"></button>`,
    )
    .join('')}</div>`;
}

const field = (label: string, body: string) => `<fieldset class="look-field"><legend>${label}</legend>${body}</fieldset>`;

function renderControls(id: string): string {
  const w = worker(id)!;
  const L = w.look;
  const roleColor = ROLES[w.role].color;
  const hatColor = L.headwear === 'beanie' || L.headwear === 'cap' || L.headwear === 'hat';
  const model = field('Modelo', chips('model', MODELS, L.model));
  if (L.model === 'totoro') {
    return `${model}<p class="section-note">Totoro no se viste: la hoja de la cabeza lleva el color del rol (${ROLES[w.role].label}). Elige «Muñeco» para cambiar piel, pelo, barba, gorro, gafas y ropa.</p>`;
  }
  return `
    ${model}
    ${field('Piel', swatches('skin', SKINS, L.skin))}
    ${field('Peinado', chips('hairStyle', HAIR_STYLES, L.hairStyle))}
    ${field('Color de pelo', swatches('hairColor', HAIR_COLORS, L.hairColor))}
    ${field('Barba y bigote', chips('facialHair', FACIAL_HAIR, L.facialHair))}
    ${field(
      'En la cabeza',
      chips('headwear', HEADWEAR, L.headwear, (h) => (h === 'hood' && L.top !== 'hoodie' ? 'Solo con sudadera' : null)) +
        (hatColor ? swatches('headwearColor', CLOTH_COLORS, L.headwearColor) : ''),
    )}
    ${field('Gafas', chips('glasses', GLASSES, L.glasses))}
    ${field(
      'Ropa',
      chips('top', TOPS, L.top) +
        swatches(
          'topColor',
          CLOTH_COLORS,
          L.topColor,
          `<button type="button" class="swatch swatch-role" style="--swatch:${roleColor}" data-look="topColor" data-value="role" aria-pressed="${
            L.topColor === null
          }" aria-label="Color del rol (${ROLES[w.role].label})" title="Color del rol (${ROLES[w.role].label})"></button>`,
        ),
    )}
    ${field('Pantalón', swatches('pantsColor', PANTS_COLORS, L.pantsColor))}
    ${field('Zapatillas', swatches('shoeColor', SHOE_COLORS, L.shoeColor))}`;
}

export function openLookEditor(workerId: string): void {
  const w = worker(workerId);
  if (!w) return;
  const d = document.getElementById('look-dialog') as HTMLDialogElement;
  d.innerHTML = `
    <div class="look">
      <div class="look-stage">
        <p class="look-hint">Arrastra para girar</p>
      </div>
      <div class="look-side">
        <header class="dialog-head">
          <h2>Aspecto de ${esc(w.name)}</h2>
          <button class="btn btn-icon" type="button" data-close aria-label="Cerrar">${icon.close(16)}</button>
        </header>
        <div class="look-controls"></div>
        <footer class="dialog-foot look-foot">
          <button class="btn btn-ghost" type="button" data-reset>Volver al original</button>
          <button class="btn" type="button" data-random>${icon.shuffle(15)}Muñeco aleatorio</button>
          <button class="btn btn-primary" type="button" data-close>Listo</button>
        </footer>
      </div>
    </div>`;

  const controls = d.querySelector<HTMLElement>('.look-controls')!;
  const preview = new Preview(d.querySelector<HTMLElement>('.look-stage')!);
  const refresh = () => {
    const scroll = controls.scrollTop;
    controls.innerHTML = renderControls(workerId);
    controls.scrollTop = scroll;
    void preview.show(workerId);
  };
  const apply = (patch: Partial<Look>) => {
    updateLook(workerId, patch);
    refresh();
  };

  d.onclick = (e) => {
    const t = e.target as HTMLElement;
    if (t === d || t.closest('[data-close]')) return d.close();
    if (t.closest('[data-random]')) return apply(randomLook());
    if (t.closest('[data-reset]')) return apply({ ...(SEED_LOOKS[workerId] ?? DEFAULT_LOOK) });
    const b = t.closest<HTMLButtonElement>('[data-look]');
    if (!b || b.disabled) return;
    const key = b.dataset.look as Key;
    const raw = b.dataset.value!;
    apply({ [key]: key === 'topColor' && raw === 'role' ? null : raw } as Partial<Look>);
    // Keep keyboard focus on the option just chosen.
    controls.querySelector<HTMLElement>(`[data-look="${key}"][data-value="${CSS.escape(raw)}"]`)?.focus();
  };
  d.onclose = () => preview.destroy();

  refresh();
  d.showModal();
}
