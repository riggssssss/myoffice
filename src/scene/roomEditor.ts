import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { icon } from '../ui/icons';
import { findFreeSpot, KINDS, layoutItem, layoutItems, placementProblem, snap, snapToWall, type Item, type Rect } from '../sim/layout';
import { editSelection, isEditing, placeItem, remove, removeBlocker, selectItem } from '../ui/roomState';
import type { Office } from './office';

const OK = new THREE.Color('#2f7a5b');
const BAD = new THREE.Color('#d0452f');
const FAINT = new THREE.Color('#8a7f70');

/** Outline + light fill of a rect, lying on the floor in an object's own frame. */
function footprintMesh(r: Rect, color: THREE.Color, fillOpacity: number): THREE.Group {
  const g = new THREE.Group();
  const cx = r.cx ?? 0;
  const cz = r.cz ?? 0;
  const pts = [
    [-r.w / 2, -r.d / 2],
    [r.w / 2, -r.d / 2],
    [r.w / 2, r.d / 2],
    [-r.w / 2, r.d / 2],
  ].map(([x, z]) => new THREE.Vector3(x + cx, 0.02, z + cz));
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false }),
  );
  line.renderOrder = 10;
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(r.w, r.d),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: fillOpacity, depthWrite: false }),
  );
  fill.rotation.x = -Math.PI / 2;
  fill.position.set(cx, 0.015, cz);
  g.add(fill, line);
  return g;
}

function disposeTree(o: THREE.Object3D): void {
  o.traverse((c) => {
    if (c instanceof THREE.Mesh || c instanceof THREE.Line) {
      c.geometry.dispose();
      (c.material as THREE.Material).dispose();
    }
  });
}

function tint(g: THREE.Object3D, color: THREE.Color, fillOpacity: number): void {
  g.traverse((c) => {
    if (c instanceof THREE.Mesh) {
      const m = c.material as THREE.MeshBasicMaterial;
      m.color.copy(color);
      m.opacity = fillOpacity;
    } else if (c instanceof THREE.Line) (c.material as THREE.LineBasicMaterial).color.copy(color);
  });
}

/**
 * Pointer handling while the room editor is open: click an object to select it, then drag
 * it to move it over the floor (snapped to a 25 cm grid; Alt for free placement). Wall objects
 * slide along the walls. A drop that collides is refused and the object springs back.
 */
export class RoomEditor {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hit = new THREE.Vector3();
  private drag: { id: string; dx: number; dz: number; start: { x: number; y: number }; moved: boolean; to: Item } | null = null;
  private downOn: { id: string | null; x: number; y: number } | null = null;
  /** Selected object's footprint (green, red while a drop would be refused). */
  private outline: THREE.Group | null = null;
  private outlineFor: string | null = null;
  /** Faint footprints of everything else, so free floor is easy to read. */
  private ghosts = new THREE.Group();
  private ghostRev = -1;
  /** Floating trash / tick over the selected object: remove it, or keep it where it is. */
  private bar: CSS2DObject;
  private barEl: HTMLElement;
  private barFor: string | null = null;
  private barHeight = 1;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private dom: HTMLElement,
    private controls: OrbitControls,
    private office: Office,
  ) {
    scene.add(this.ghosts);

    this.barEl = document.createElement('div');
    this.barEl.className = 'item-bar';
    this.barEl.innerHTML = `
      <button type="button" class="item-bar-btn item-bar-trash" data-bar="trash">${icon.trash(16)}</button>
      <button type="button" class="item-bar-btn item-bar-tick" data-bar="tick" aria-label="Dejar aquí" title="Dejar aquí">${icon.tick(17)}</button>`;
    // Presses on the bar must not grab the object underneath or orbit the camera.
    this.barEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.barEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-bar]');
      const id = editSelection();
      if (!b || !id) return;
      if (b.dataset.bar === 'trash') remove(id);
      else selectItem(null);
    });
    this.bar = new CSS2DObject(this.barEl);
    this.bar.center.set(0.5, 1);
    this.bar.visible = false;
    scene.add(this.bar);
    // Capture phase: decide before OrbitControls whether this press grabs an object.
    dom.addEventListener('pointerdown', (e) => this.onDown(e), { capture: true });
    dom.addEventListener('pointermove', (e) => this.onMove(e));
    dom.addEventListener('pointerup', (e) => this.onUp(e));
    dom.addEventListener('pointercancel', () => this.cancel());
  }

  private ray(e: PointerEvent): void {
    const rect = this.dom.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private pickItem(e: PointerEvent): string | null {
    this.ray(e);
    for (const h of this.raycaster.intersectObjects(this.office.items.children, true)) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.itemId) o = o.parent;
      if (o) return o.userData.itemId as string;
    }
    return null;
  }

  private floorPoint(e: PointerEvent): THREE.Vector3 | null {
    this.ray(e);
    return this.raycaster.ray.intersectPlane(this.floor, this.hit);
  }

  private onDown(e: PointerEvent): void {
    if (!isEditing() || e.button !== 0) return;
    const id = this.pickItem(e);
    // Only the selected object can be dragged. Pressing anything else is a click (select it
    // on release) or the start of a camera orbit, exactly like pressing the floor.
    if (!id || id !== editSelection()) {
      this.downOn = { id, x: e.clientX, y: e.clientY };
      return;
    }
    const item = layoutItem(id)!;
    const p = this.floorPoint(e);
    this.controls.enabled = false;
    this.dom.setPointerCapture(e.pointerId);
    this.drag = {
      id,
      dx: p ? item.x - p.x : 0,
      dz: p ? item.z - p.z : 0,
      start: { x: e.clientX, y: e.clientY },
      moved: false,
      to: { ...item },
    };
    this.dom.style.cursor = 'grabbing';
  }

  private onMove(e: PointerEvent): void {
    if (!isEditing()) return;
    if (!this.drag) {
      if (e.pointerType === 'mouse' && !e.buttons) {
        const id = this.pickItem(e);
        this.dom.style.cursor = !id ? '' : id === editSelection() ? 'grab' : 'pointer';
      }
      return;
    }
    const d = this.drag;
    if (!d.moved && Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) < 4) return;
    d.moved = true;
    const p = this.floorPoint(e);
    if (!p) return;
    const item = layoutItem(d.id)!;
    const info = KINDS[item.kind];
    let x = p.x + d.dx;
    let z = p.z + d.dz;
    let rot = item.rot;
    if (!e.altKey) {
      x = snap(x);
      z = snap(z);
    }
    if (info.wall) ({ x, z, rot } = snapToWall(x, z, info.footprint.w));
    d.to = { ...item, x, z, rot };
    const root = this.office.rootOf(d.id);
    root?.position.set(x, 0, z);
    if (root) root.rotation.y = rot;
  }

  private onUp(e: PointerEvent): void {
    if (this.downOn) {
      const { id, x, y } = this.downOn;
      this.downOn = null;
      // A click (not an orbit): select what was under the pointer, or clear on empty floor.
      if (Math.hypot(e.clientX - x, e.clientY - y) < 6 && isEditing()) selectItem(id);
    }
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    this.controls.enabled = true;
    this.dom.style.cursor = '';
    if (this.dom.hasPointerCapture(e.pointerId)) this.dom.releasePointerCapture(e.pointerId);
    if (!d.moved) return;
    if (placeItem(d.id, { x: d.to.x, z: d.to.z, rot: d.to.rot })) return;
    // Dropped on something: settle into the nearest gap if it's close to where the pointer let go.
    const others = layoutItems().filter((i) => i.id !== d.id) as Item[];
    const gap = findFreeSpot(d.to, others, d.to.x, d.to.z);
    if (gap && Math.hypot(gap.x - d.to.x, gap.z - d.to.z) < 1.2 && placeItem(d.id, gap)) return;
    // Otherwise spring back to where the layout says it is.
    this.snapBack(d.id);
  }

  private cancel(): void {
    if (!this.drag) return;
    const id = this.drag.id;
    this.drag = null;
    this.controls.enabled = true;
    this.snapBack(id);
  }

  private snapBack(id: string): void {
    const item = layoutItem(id);
    const root = this.office.rootOf(id);
    if (item && root) {
      root.position.set(item.x, 0, item.z);
      root.rotation.y = item.rot;
    }
  }

  private updateBar(item: Item | undefined): void {
    const root = item ? this.office.rootOf(item.id) : undefined;
    const dragging = !!this.drag?.moved;
    this.bar.visible = !!item && !!root && !dragging;
    if (!item || !root) {
      this.barFor = null;
      return;
    }
    if (this.barFor !== item.id) {
      this.barFor = item.id;
      // Hover just above the object's top.
      const box = new THREE.Box3().setFromObject(root);
      this.barHeight = box.max.y + 0.2;
      const why = removeBlocker(item);
      const trash = this.barEl.querySelector<HTMLElement>('[data-bar="trash"]')!;
      trash.setAttribute('aria-label', why ? `No se puede quitar: ${why}` : 'Quitar de la sala');
      trash.title = why ?? 'Quitar de la sala';
      trash.toggleAttribute('aria-disabled', !!why);
    }
    this.bar.position.set(root.position.x, this.barHeight, root.position.z);
  }

  /** Per frame: keep the outline on the selected object and colour it by fit. */
  update(layoutRev: number): void {
    const on = isEditing();
    this.ghosts.visible = on;
    const id = on ? editSelection() : null;
    const item = id ? layoutItem(id) : undefined;

    if (on && layoutRev !== this.ghostRev) {
      this.ghostRev = layoutRev;
      for (const c of [...this.ghosts.children]) {
        this.ghosts.remove(c);
        disposeTree(c);
      }
      for (const it of layoutItems()) {
        if (KINDS[it.kind].wall) continue;
        const g = footprintMesh(KINDS[it.kind].footprint, FAINT, 0.05);
        g.position.set(it.x, 0, it.z);
        g.rotation.y = it.rot;
        g.userData.itemId = it.id;
        this.ghosts.add(g);
      }
    }

    if (this.outlineFor !== (item?.id ?? null) || (item && this.outline?.userData.kind !== item.kind)) {
      if (this.outline) {
        this.scene.remove(this.outline);
        disposeTree(this.outline);
        this.outline = null;
      }
      this.outlineFor = item?.id ?? null;
      if (item) {
        this.outline = footprintMesh(KINDS[item.kind].footprint, OK, 0.12);
        this.outline.userData.kind = item.kind;
        this.scene.add(this.outline);
      }
    }
    this.updateBar(item);
    if (!item || !this.outline) return;

    const root = this.office.rootOf(item.id);
    if (root) {
      this.outline.position.copy(root.position);
      this.outline.rotation.y = root.rotation.y;
    }
    const probe = this.drag?.id === item.id && this.drag.moved ? this.drag.to : item;
    const bad = !!placementProblem(probe, layoutItems() as Item[]);
    tint(this.outline, bad ? BAD : OK, bad ? 0.2 : 0.12);
    // Hide the ghost under the selection so it doesn't double up.
    for (const g of this.ghosts.children) g.visible = g.userData.itemId !== item.id;
  }
}
