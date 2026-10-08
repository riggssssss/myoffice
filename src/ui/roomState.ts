import {
  addItem,
  addRoom,
  duplicateItem,
  KINDS,
  layoutItem,
  layoutItems,
  layoutRoom,
  layoutRooms,
  PARCEL,
  placementProblem,
  removeItem,
  removeRoom,
  resetLayout,
  restoreLayout,
  roomItems,
  ROOM_GRID,
  snapshotLayout,
  updateItem,
  updateRoom,
  setDeskStyle,
  setChairStyle,
  setWindowStyle,
  setOutdoor,
  type OutdoorStyle,
  type ChairPack,
  type ChairStyle,
  type FloorKind,
  type WallKind,
  type DeskDecor,
  type DeskStyle,
  type LayoutSnapshot,
  type Item,
  type ItemKind,
  type P,
  type RoomRect,
  type Side,
  type WindowStyle,
} from '../sim/layout';
import { getState } from '../sim/store';

/**
 * Room editor session: what is selected (an object or a room), the undo history, and every
 * edit as an action that checks the result fits before it lands.
 */
let active = false;
let selectedId: string | null = null;
let selectedRoom: string | null = null;
/** Last thing that didn't work ("Choca con…"), shown in the panel until the next action. */
let message: string | null = null;
/** Room resizing: half-metre steps, or whole parcels. */
let parcelSnap = false;
const undo: LayoutSnapshot[] = [];
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((fn) => fn());

export const isEditing = () => active;
export const editSelection = () => selectedId;
export const editRoom = () => selectedRoom;
export const editMessage = () => message;
export const canUndo = () => undo.length > 0;
export const snapsToParcels = () => parcelSnap;

export function onEditChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setEditing(on: boolean): void {
  if (active === on) return;
  active = on;
  selectedId = null;
  selectedRoom = null;
  message = null;
  undo.length = 0;
  emit();
}

export function selectItem(id: string | null): void {
  if (selectedId === id && !selectedRoom && !message) return;
  selectedId = id;
  selectedRoom = null;
  message = null;
  emit();
}

export function selectRoom(id: string | null): void {
  if (selectedRoom === id && !selectedId && !message) return;
  selectedRoom = id;
  selectedId = null;
  message = null;
  emit();
}

export function setParcelSnap(on: boolean): void {
  parcelSnap = on;
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
  const problem = placementProblem({ ...item, ...to }, layoutItems());
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
    fail(KINDS[kind].wall ? 'No queda pared libre para colgarla' : 'No queda sitio libre en la oficina');
    return;
  }
  selectedId = item.id;
  selectedRoom = null;
  message = null;
  emit();
}

/** Puts a new agent's desk in its default spot (or near where you're looking), ready to drag elsewhere. */
export function placeDesk(slot: number, near: P): void {
  remember();
  const item = addItem('desk', near, slot);
  if (!item) {
    undo.pop();
    fail('No queda sitio libre en la oficina para otra mesa');
    return;
  }
  selectedId = item.id;
  selectedRoom = null;
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
  if (KINDS[item.kind].perWorker) {
    const owner = deskOwner(item);
    return `Es el puesto de ${owner?.name ?? 'un agente'}: se va cuando quitas a esa persona del organigrama`;
  }
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

export function styleWindows(patch: Partial<WindowStyle>): void {
  remember();
  setWindowStyle(patch);
  emit();
}

export function styleOutdoor(patch: Partial<OutdoorStyle>): void {
  remember();
  setOutdoor(patch);
  emit();
}

export function styleChairs(pack: ChairPack, patch: Partial<ChairStyle>): void {
  remember();
  setChairStyle(pack, patch);
  emit();
}

// ---------------------------------------------------------------- rooms

export function floorFinish(roomId: string, floor: FloorKind): void {
  remember();
  updateRoom(roomId, { floor });
  emit();
}

export function wallFinish(roomId: string, walls: WallKind): void {
  remember();
  updateRoom(roomId, { walls });
  emit();
}

export function renameRoom(roomId: string, name: string): void {
  const clean = name.trim().slice(0, 40);
  if (!clean || layoutRoom(roomId)?.name === clean) return;
  remember();
  updateRoom(roomId, { name: clean });
  emit();
}

/** Why a room can't go, or null. */
export function roomRemoveBlocker(roomId: string): string | null {
  if (layoutRooms().length < 2) return 'La oficina necesita al menos una sala';
  const inside = roomItems(roomId);
  const owned = inside.map(deskOwner).find(Boolean);
  if (owned) return `Aquí está el puesto de ${owned.name}: muévelo a otra sala antes`;
  if (inside.some((i) => KINDS[i.kind].unique)) return 'Aquí está la mesa de reuniones: muévela a otra sala antes';
  return null;
}

export function dropRoom(roomId: string): void {
  const why = roomRemoveBlocker(roomId);
  if (why) {
    fail(why);
    return;
  }
  remember();
  const problem = removeRoom(roomId);
  if (problem) {
    undo.pop();
    fail(problem);
    return;
  }
  selectedRoom = null;
  message = null;
  emit();
}

export function addRoomBeside(roomId: string, side: Side): void {
  remember();
  const r = addRoom(roomId, side);
  if (typeof r === 'string') {
    undo.pop();
    fail(r);
    return;
  }
  selectedRoom = r.id;
  selectedId = null;
  message = null;
  emit();
}

/** Grid a dragged room edge snaps to: half metres, or whole parcels counted from the opposite edge. */
export function snapEdge(value: number, opposite: number): number {
  if (!parcelSnap) return Math.round(value / ROOM_GRID) * ROOM_GRID;
  const n = Math.max(1, Math.round(Math.abs(value - opposite) / PARCEL));
  return opposite + Math.sign(value - opposite || 1) * n * PARCEL;
}

let resizing: { id: string; changed: boolean } | null = null;

/** Start dragging a room edge: one undo step for the whole drag. */
export function beginResize(roomId: string): void {
  remember();
  resizing = { id: roomId, changed: false };
  message = null;
}

/** Live resize while dragging; refuses (keeping the last good size) when it wouldn't fit. */
export function resizeTo(roomId: string, rect: RoomRect): boolean {
  const r = layoutRoom(roomId);
  if (!r) return false;
  if (r.x0 === rect.x0 && r.x1 === rect.x1 && r.z0 === rect.z0 && r.z1 === rect.z1) return true;
  const problem = updateRoom(roomId, rect);
  if (problem) {
    if (message !== problem) fail(problem);
    return false;
  }
  if (resizing?.id === roomId) resizing.changed = true;
  if (message) {
    message = null;
    emit();
  }
  return true;
}

export function endResize(): void {
  if (resizing && !resizing.changed) undo.pop();
  resizing = null;
  emit();
}

/** Panel steppers: grow or shrink a room along one axis (from its far edge, else its near edge). */
export function stepRoom(roomId: string, axis: 'x' | 'z', dir: 1 | -1): void {
  const r = layoutRoom(roomId);
  if (!r) return;
  const step = parcelSnap ? PARCEL : 1;
  const tries: RoomRect[] =
    axis === 'x'
      ? [
          { ...r, x1: r.x1 + dir * step },
          { ...r, x0: r.x0 - dir * step },
        ]
      : [
          { ...r, z1: r.z1 + dir * step },
          { ...r, z0: r.z0 - dir * step },
        ];
  remember();
  let problem: string | null = null;
  for (const t of tries) {
    problem = updateRoom(roomId, { x0: t.x0, x1: t.x1, z0: t.z0, z1: t.z1 });
    if (!problem) break;
  }
  if (problem) {
    undo.pop();
    fail(problem);
    return;
  }
  message = null;
  emit();
}

export function undoLast(): void {
  const prev = undo.pop();
  if (!prev) return;
  restoreLayout(prev);
  if (selectedId && !layoutItem(selectedId)) selectedId = null;
  if (selectedRoom && !layoutRoom(selectedRoom)) selectedRoom = null;
  message = null;
  emit();
}

export function resetRoom(slots: number[]): void {
  remember();
  resetLayout(slots);
  selectedId = null;
  selectedRoom = null;
  message = null;
  emit();
}
