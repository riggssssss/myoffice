import {
  addItem,
  duplicateItem,
  KINDS,
  layoutItem,
  layoutItems,
  placementProblem,
  removeItem,
  resetLayout,
  restoreLayout,
  snapshotLayout,
  updateItem,
  setDeskStyle,
  setFloor,
  setWalls,
  type FloorKind,
  type WallKind,
  type DeskDecor,
  type DeskStyle,
  type LayoutSnapshot,
  type Item,
  type ItemKind,
  type P,
} from '../sim/layout';
import { getState } from '../sim/store';

/**
 * Room editor session: which object is selected, the undo history, and every edit as an
 * action that checks the result fits before it lands.
 */
let active = false;
let selectedId: string | null = null;
/** Last thing that didn't work ("Choca con…"), shown in the panel until the next action. */
let message: string | null = null;
const undo: LayoutSnapshot[] = [];
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((fn) => fn());

export const isEditing = () => active;
export const editSelection = () => selectedId;
export const editMessage = () => message;
export const canUndo = () => undo.length > 0;

export function onEditChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setEditing(on: boolean): void {
  if (active === on) return;
  active = on;
  selectedId = null;
  message = null;
  undo.length = 0;
  emit();
}

export function selectItem(id: string | null): void {
  if (selectedId === id && !message) return;
  selectedId = id;
  message = null;
  emit();
}

function remember(): void {
  undo.push(snapshotLayout());
  if (undo.length > 60) undo.shift();
}

function fail(text: string): false {
  message = text;
  emit();
  return false;
}

/** Move and/or turn an object. Refuses (and says why) when it wouldn't fit. */
export function placeItem(id: string, to: { x: number; z: number; rot: number }): boolean {
  const item = layoutItem(id);
  if (!item) return false;
  if (item.x === to.x && item.z === to.z && item.rot === to.rot) return true;
  const problem = placementProblem({ ...item, ...to }, layoutItems() as Item[]);
  if (problem) return fail(problem);
  remember();
  message = null;
  updateItem(id, to);
  emit();
  return true;
}

const TAU = Math.PI * 2;
const norm = (a: number) => ((a % TAU) + TAU) % TAU;

export function rotateItem(id: string, by: number): boolean {
  const item = layoutItem(id);
  if (!item || KINDS[item.kind].wall) return false;
  const rot = Math.round(norm(item.rot + by) / (Math.PI / 12)) * (Math.PI / 12);
  return placeItem(id, { x: item.x, z: item.z, rot: norm(rot) }) || fail('No cabe girado aquí: muévelo a un sitio más despejado');
}

export function nudgeItem(id: string, dx: number, dz: number): boolean {
  const item = layoutItem(id);
  if (!item || KINDS[item.kind].wall) return false;
  return placeItem(id, { x: +(item.x + dx).toFixed(3), z: +(item.z + dz).toFixed(3), rot: item.rot });
}

export function addKind(kind: ItemKind, near: P): void {
  remember();
  const item = addItem(kind, near);
  if (!item) {
    undo.pop();
    fail('No queda sitio libre en la sala');
    return;
  }
  selectedId = item.id;
  message = null;
  emit();
}

export function duplicate(id: string): void {
  remember();
  const copy = duplicateItem(id);
  if (!copy) {
    undo.pop();
    fail('No queda sitio libre para la copia');
    return;
  }
  selectedId = copy.id;
  message = null;
  emit();
}

/** Who sits at this desk, if anyone. */
export const deskOwner = (item: Item | undefined) =>
  item?.kind === 'desk' ? getState().workers.find((w) => w.desk === item.slot) : undefined;

/** Why an object can't be removed, or null. */
export function removeBlocker(item: Item): string | null {
  if (KINDS[item.kind].unique) return 'La oficina necesita una: puedes moverla, pero no quitarla';
  const owner = deskOwner(item);
  if (owner) return `Es el puesto de ${owner.name}: asígnale otro antes de quitarlo`;
  return null;
}

export function remove(id: string): void {
  const item = layoutItem(id);
  if (!item) return;
  const why = removeBlocker(item);
  if (why) {
    fail(why);
    return;
  }
  remember();
  removeItem(id);
  selectedId = null;
  message = null;
  emit();
}

export function setDecor(id: string, decor: DeskDecor): void {
  remember();
  updateItem(id, { decor });
  emit();
}

export function styleDesks(patch: Partial<DeskStyle>): void {
  remember();
  setDeskStyle(patch);
  emit();
}

export function floorFinish(floor: FloorKind): void {
  remember();
  setFloor(floor);
  emit();
}

export function wallFinish(walls: WallKind): void {
  remember();
  setWalls(walls);
  emit();
}

export function undoLast(): void {
  const prev = undo.pop();
  if (!prev) return;
  restoreLayout(prev);
  if (selectedId && !layoutItem(selectedId)) selectedId = null;
  message = null;
  emit();
}

export function resetRoom(): void {
  remember();
  resetLayout();
  selectedId = null;
  message = null;
  emit();
}
