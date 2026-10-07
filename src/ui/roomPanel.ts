import {
  CHAIR_FABRICS,
  CHAIR_FRAMES,
  CHAIR_MODELS,
  chairStyle,
  DESK_DECOR,
  DESK_FRAMES,
  DESK_MODELS,
  DESK_TOPS,
  deskStyle,
  FLOORS,
  KIND_ORDER,
  KINDS,
  layoutItem,
  layoutItems,
  layoutRoom,
  layoutRooms,
  PARCEL,
  roomItems,
  WALLS,
  WINDOW_FRAMES,
  WINDOW_MODELS,
  windowStyle,
  type Category,
  type ChairPack,
  type ChairStyle,
  type DeskDecor,
  type DeskStyle,
  type FloorKind,
  type ItemKind,
  type P,
  type Room,
  type WallKind,
  type WindowStyle,
} from '../sim/layout';
import { getState, setDesk } from '../sim/store';
import { floorThumb, WALL_PAINT, wallThumb } from '../scene/floors';
import { thumb, type ThumbSpec } from '../scene/thumbs';
import { esc } from './dom';
import { icon } from './icons';
import {
  addKind,
  canUndo,
  deskOwner,
  dropRoom,
  duplicate,
  editMessage,
  editRoom,
  editSelection,
  floorFinish,
  remove,
  removeBlocker,
  renameRoom,
  roomRemoveBlocker,
  rotateItem,
  selectRoom,
  setDecor,
  setParcelSnap,
  snapsToParcels,
  stepRoom,
  styleChairs,
  styleDesks,
  styleWindows,
  wallFinish,
} from './roomState';

const CATEGORIES: Category[] = ['Mobiliario', 'Plantas', 'Pared'];
const STEP = Math.PI / 12;

const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ','));

/** A picture of the real model (or a quiet placeholder while it renders), with its name. */
function card(spec: ThumbSpec, name: string, attrs: string, extra = ''): string {
  const url = thumb(spec);
  return `<button type="button" class="model-card" ${attrs}>
      <span class="model-img">${url ? `<img src="${url}" alt="" draggable="false">` : '<span class="model-wait" aria-hidden="true"></span>'}</span>
      <span class="model-name">${esc(name)}</span>${extra}
    </button>`;
}

function swatches(list: { id: string; label: string; color: string }[], current: string, attrs: (id: string) => string): string {
  return `<div class="swatches" role="group">${list
    .map(
      (o) =>
        `<button type="button" class="swatch" style="--swatch:${o.color}" ${attrs(o.id)} aria-pressed="${current === o.id}" aria-label="${esc(o.label)}" title="${esc(o.label)}"></button>`,
    )
    .join('')}</div>`;
}

// ---------------------------------------------------------------- selection

function itemInspector(): string {
  const item = layoutItem(editSelection())!;
  const info = KINDS[item.kind];
  const owner = deskOwner(item);
  const blocker = removeBlocker(item);
  const workers = getState().workers;
  const deg = Math.round((((item.rot * 180) / Math.PI) % 360 + 360) % 360);

  const desk =
    item.kind === 'desk'
      ? `
      <label class="field room-field">
        <span>Puesto de</span>
        <select data-owner data-key="owner">
          ${owner ? '' : '<option value="" selected>Nadie (libre)</option>'}
          ${workers.map((w) => `<option value="${w.id}" ${w.id === owner?.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}
        </select>
      </label>
      <fieldset class="room-field">
        <legend>Sobre la mesa</legend>
        <div class="chips" role="group">
          ${DESK_DECOR.map(
            (d) =>
              `<button type="button" class="chip" data-decor="${d.id}" data-key="decor-${d.id}" aria-pressed="${(item.decor ?? 'none') === d.id}">${d.label}</button>`,
          ).join('')}
        </div>
      </fieldset>
      <button class="btn btn-ghost room-desk-look" type="button" data-jump="room-desks" data-key="desk-look">Personalizar mesas…</button>`
      : item.kind === 'window'
        ? `<button class="btn btn-ghost room-desk-look" type="button" data-jump="room-windows" data-key="win-look">Cambiar el diseño de las ventanas…</button>`
        : '';

  const turn = info.wall
    ? `<p class="section-note">Va en una pared exterior: arrástrala a lo largo de las paredes, de cualquier sala.</p>`
    : `<div class="room-turn" role="group" aria-label="Girar">
        <button class="btn" type="button" data-rotate="-1" data-key="rot-l" title="Girar 15° a la izquierda (Q)">${icon.turnLeft(15)}15°</button>
        <button class="btn" type="button" data-rotate="1" data-key="rot-r" title="Girar 15° a la derecha (E)">${icon.turnRight(15)}15°</button>
        <button class="btn" type="button" data-rotate="6" data-key="rot-90" title="Girar 90° (R)">90°</button>
        <span class="num room-deg" aria-label="Orientación">${deg}°</span>
      </div>`;

  return `
    <div class="room-selected">
      <h3 class="room-name">${info.label}</h3>
      ${owner ? `<p class="meta">Aquí trabaja ${esc(owner.name)}</p>` : item.kind === 'desk' ? '<p class="meta">Puesto libre</p>' : ''}
      ${turn}
      ${desk}
      <div class="actions">
        ${info.unique ? '' : `<button class="btn" type="button" data-duplicate data-key="dup">${icon.copy(15)}Duplicar</button>`}
        <button class="btn btn-ghost room-remove" type="button" data-remove data-key="remove" ${blocker ? `aria-disabled="true" title="${esc(blocker)}"` : 'title="Quitar (Supr)"'}>${icon.trash(15)}Quitar</button>
      </div>
    </div>`;
}

function stepper(axis: 'x' | 'z', label: string, value: number): string {
  return `<div class="room-stepper">
      <span>${label}</span>
      <button class="btn" type="button" data-step="${axis}" data-dir="-1" data-key="step-${axis}-" aria-label="Reducir ${label.toLowerCase()}">−</button>
      <output class="num">${num(value)} m</output>
      <button class="btn" type="button" data-step="${axis}" data-dir="1" data-key="step-${axis}+" aria-label="Ampliar ${label.toLowerCase()}">+</button>
    </div>`;
}

function roomInspector(room: Room): string {
  const w = room.x1 - room.x0;
  const d = room.z1 - room.z0;
  const blocker = roomRemoveBlocker(room.id);
  const n = roomItems(room.id).length;
  const parcels = Number.isInteger(w / PARCEL) && Number.isInteger(d / PARCEL) ? ` · ${w / PARCEL} × ${d / PARCEL} parcela${w * d > PARCEL * PARCEL ? 's' : ''}` : '';
  return `
    <div class="room-selected">
      <label class="field room-field room-rename">
        <span>Sala</span>
        <input type="text" data-room-name data-key="room-name" value="${esc(room.name)}" maxlength="40" autocomplete="off">
      </label>
      <p class="meta">${num(w)} × ${num(d)} m${parcels} · ${n} ${n === 1 ? 'objeto' : 'objetos'}</p>
      <div class="room-steppers">
        ${stepper('x', 'Ancho', w)}
        ${stepper('z', 'Fondo', d)}
      </div>
      <fieldset class="room-field">
        <legend>Al redimensionar</legend>
        <div class="chips" role="group">
          <button type="button" class="chip" data-snap="fine" data-key="snap-fine" aria-pressed="${!snapsToParcels()}">De 0,5 en 0,5 m</button>
          <button type="button" class="chip" data-snap="parcel" data-key="snap-parcel" aria-pressed="${snapsToParcels()}">Por parcelas (${PARCEL} m)</button>
        </div>
      </fieldset>
      <p class="section-note">Arrastra los tiradores de los lados para cambiar el tamaño. Con <b>＋ Sala</b> añades otra pegada a ese lado.</p>
      ${floorPicker(room)}
      ${wallPicker(room)}
      <div class="actions">
        <button class="btn btn-ghost room-remove" type="button" data-drop-room data-key="drop-room" ${blocker ? `aria-disabled="true" title="${esc(blocker)}"` : 'title="Quitar la sala y lo que hay dentro"'}>${icon.trash(15)}Quitar sala</button>
      </div>
    </div>`;
}

function inspector(): string {
  if (layoutItem(editSelection())) return itemInspector();
  const room = layoutRoom(editRoom());
  if (room) return roomInspector(room);
  return `<p class="room-empty">Pulsa un objeto para seleccionarlo y arrástralo para moverlo. Pulsa el suelo de una sala para cambiar su tamaño, su suelo y sus paredes, o para añadir otra a su lado.</p>`;
}

// ---------------------------------------------------------------- finishes (per room)

function floorPicker(room: Room): string {
  return `
    <fieldset class="room-field">
      <legend>Suelo · ${esc(FLOORS.find((f) => f.id === room.floor)!.label)}</legend>
      <div class="floor-grid" role="group" aria-label="Acabado del suelo">
        ${FLOORS.map((f) => {
          const t = floorThumb(f.id);
          return `<button type="button" class="floor-opt ${t ? '' : 'floor-plain'}" data-floor="${f.id}" data-key="floor-${f.id}" aria-pressed="${
            f.id === room.floor
          }" aria-label="${esc(f.label)}" title="${esc(f.label)}" ${t ? `style="background-image:url(${t})"` : ''}></button>`;
        }).join('')}
      </div>
    </fieldset>`;
}

function wallPicker(room: Room): string {
  return `
    <fieldset class="room-field">
      <legend>Paredes · ${esc(WALLS.find((w) => w.id === room.walls)!.label)}</legend>
      <div class="floor-grid" role="group" aria-label="Acabado de las paredes">
        ${WALLS.map((w) => {
          const t = wallThumb(w.id);
          const paint = WALL_PAINT[w.id];
          const style = t ? `background-image:url(${t})` : paint ? `background:${paint}` : '';
          return `<button type="button" class="floor-opt ${t || paint ? '' : 'wall-plain'}" data-wall="${w.id}" data-key="wall-${w.id}" aria-pressed="${
            w.id === room.walls
          }" aria-label="${esc(w.label)}" title="${esc(w.label)}" ${style ? `style="${style}"` : ''}></button>`;
        }).join('')}
      </div>
    </fieldset>`;
}

// ---------------------------------------------------------------- rooms list

function roomsSection(): string {
  const current = editRoom();
  return `
    <section class="section" aria-labelledby="room-rooms-title">
      <h3 class="section-title" id="room-rooms-title">Salas</h3>
      <div class="chips" role="group" aria-label="Elegir sala">
        ${layoutRooms()
          .map(
            (r) =>
              `<button type="button" class="chip" data-pick-room="${r.id}" data-key="pick-${r.id}" aria-pressed="${r.id === current}">${esc(r.name)} <span class="num chip-meta">${num(r.x1 - r.x0)}×${num(r.z1 - r.z0)}</span></button>`,
          )
          .join('')}
      </div>
    </section>`;
}

// ---------------------------------------------------------------- catalogue

function catalog(): string {
  const items = layoutItems();
  return CATEGORIES.map((cat) => {
    const kinds = KIND_ORDER.filter((k) => KINDS[k].category === cat);
    return `
      <h4 class="room-cat">${cat}</h4>
      <div class="model-grid">
        ${kinds
          .map((k) => {
            const n = items.filter((i) => i.kind === k).length;
            const unique = KINDS[k].unique;
            const attrs = unique
              ? `aria-disabled="true" title="Solo puede haber una" data-key="add-${k}"`
              : `data-add="${k}" data-key="add-${k}" title="Añadir ${KINDS[k].label.toLowerCase()}"`;
            return card({ type: 'item', kind: k }, KINDS[k].label, attrs, `<span class="model-count num" aria-label="${n} en la oficina">${unique ? 'Única' : n}</span>`);
          })
          .join('')}
      </div>`;
  }).join('');
}

// ---------------------------------------------------------------- styles shared by all

/** One look for all desks: model, top and frame. */
function deskLook(): string {
  const st = deskStyle();
  return `
    <section class="section" id="room-desks" aria-labelledby="room-desks-title">
      <h3 class="section-title" id="room-desks-title">Mesas</h3>
      <p class="section-note">Se aplica a todos los puestos a la vez.</p>
      <div class="model-grid" role="group" aria-label="Modelo de mesa">
        ${DESK_MODELS.map((d) => card({ type: 'desk', model: d.id }, d.label, `data-desk-style="model" data-value="${d.id}" data-key="ds-model-${d.id}" aria-pressed="${st.model === d.id}" title="${esc(d.note)}"`)).join('')}
      </div>
      <fieldset class="room-field">
        <legend>Tablero · ${esc(DESK_TOPS.find((t) => t.id === st.top)!.label)}</legend>
        ${swatches(DESK_TOPS, st.top, (id) => `data-desk-style="top" data-value="${id}" data-key="ds-top-${id}"`)}
      </fieldset>
      <fieldset class="room-field">
        <legend>Estructura · ${esc(DESK_FRAMES.find((f) => f.id === st.frame)!.label)}</legend>
        ${swatches(DESK_FRAMES, st.frame, (id) => `data-desk-style="frame" data-value="${id}" data-key="ds-frame-${id}"`)}
      </fieldset>
    </section>`;
}

/** One chair pack: model, then upholstery and frame colours for that model. */
function chairPack(pack: ChairPack, title: string): string {
  const c = chairStyle(pack);
  const fabric = CHAIR_FABRICS.filter((f) => f.id !== 'theme' || c.model === 'classic');
  const frames = CHAIR_FRAMES[c.model];
  const attrs = (key: string) => (id: string) => `data-chair="${pack}" data-chair-key="${key}" data-value="${id}" data-key="ch-${pack}-${key}-${id}"`;
  return `
    <div class="room-pack">
      <h4 class="room-pack-title">${title}</h4>
      <div class="model-grid model-grid-4" role="group" aria-label="Modelo de silla">
        ${CHAIR_MODELS.map((mdl) =>
          card({ type: 'chair', pack, model: mdl.id }, mdl.label, `${attrs('model')(mdl.id)} aria-pressed="${c.model === mdl.id}" title="${esc(mdl.note)}"`),
        ).join('')}
      </div>
      <fieldset class="room-field">
        <legend>Tapizado · ${esc(CHAIR_FABRICS.find((f) => f.id === c.fabric)!.label)}</legend>
        ${swatches(fabric, c.fabric, attrs('fabric'))}
      </fieldset>
      <fieldset class="room-field">
        <legend>${c.model === 'roundish' ? 'Madera' : 'Estructura'} · ${esc(frames.find((f) => f.id === c.frame)!.label)}</legend>
        ${swatches(frames, c.frame, attrs('frame'))}
      </fieldset>
    </div>`;
}

function chairPicker(): string {
  return `
    <section class="section" aria-labelledby="room-chairs-title">
      <h3 class="section-title" id="room-chairs-title">Sillas</h3>
      <p class="section-note">Cada grupo cambia entero: todas las de los puestos o todas las de reuniones.</p>
      ${chairPack('desk', 'Puestos de trabajo')}
      ${chairPack('meeting', 'Mesa de reuniones')}
    </section>`;
}

/** Every window shares one design; where each one goes is up to you. */
function windowLook(): string {
  const st = windowStyle();
  return `
    <section class="section" id="room-windows" aria-labelledby="room-windows-title">
      <h3 class="section-title" id="room-windows-title">Ventanas</h3>
      <p class="section-note">El diseño es el mismo para todas. Añádelas desde «Pared» y colócalas donde quieras: la luz entra según hacia dónde mire cada una.</p>
      <div class="model-grid" role="group" aria-label="Modelo de ventana">
        ${WINDOW_MODELS.map((w) => card({ type: 'window', model: w.id }, w.label, `data-win-style="model" data-value="${w.id}" data-key="ws-model-${w.id}" aria-pressed="${st.model === w.id}" title="${esc(w.note)}"`)).join('')}
      </div>
      <fieldset class="room-field">
        <legend>Marco · ${esc(WINDOW_FRAMES.find((f) => f.id === st.frame)!.label)}</legend>
        ${swatches(WINDOW_FRAMES, st.frame, (id) => `data-win-style="frame" data-value="${id}" data-key="ws-frame-${id}"`)}
      </fieldset>
    </section>`;
}

export function renderRoom(): string {
  const msg = editMessage();
  return `
    <div class="room">
      <header class="room-head">
        <h2>Editar oficina</h2>
        <p class="section-note">La simulación queda en pausa mientras amueblas. Cada persona sigue a su puesto allá donde lo pongas. Gira la vista a tu gusto: las paredes que tapan se apartan.</p>
      </header>
      <section class="section room-inspect" aria-label="Selección">
        ${inspector()}
        <p class="room-msg ${msg ? 'is-shown' : ''}" role="status" aria-live="polite">${msg ? `${icon.alert(14)}${esc(msg)}` : ''}</p>
      </section>
      ${roomsSection()}
      <section class="section" aria-label="Añadir objetos">
        <h3 class="section-title">Añadir</h3>
        ${catalog()}
      </section>
      ${deskLook()}
      ${chairPicker()}
      ${windowLook()}
      <p class="room-keys section-note"><kbd>R</kbd> gira 90° · <kbd>Q</kbd>/<kbd>E</kbd> giran 15° · flechas mueven · <kbd>Alt</kbd> al arrastrar quita la rejilla · <kbd>Supr</kbd> quita · <kbd>⌘Z</kbd> deshace</p>
    </div>`;
}

export function roomFooter(): string {
  return `
    <button class="btn btn-ghost" type="button" data-undo ${canUndo() ? '' : 'disabled'}>${icon.undo(15)}Deshacer</button>
    <button class="btn btn-ghost" type="button" data-reset-room>Distribución original</button>
    <button class="btn btn-primary" type="button" data-done>Listo</button>`;
}

export function bindRoom(el: HTMLElement, near: () => P): void {
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const id = editSelection();
    const room = editRoom();
    const add = t.closest<HTMLElement>('[data-add]');
    if (add) return addKind(add.dataset.add as ItemKind, near());
    const pick = t.closest<HTMLElement>('[data-pick-room]');
    if (pick) return selectRoom(pick.dataset.pickRoom!);
    const ch = t.closest<HTMLElement>('[data-chair]');
    if (ch) return styleChairs(ch.dataset.chair as ChairPack, { [ch.dataset.chairKey as keyof ChairStyle]: ch.dataset.value } as Partial<ChairStyle>);
    const ds = t.closest<HTMLElement>('[data-desk-style]');
    if (ds) return styleDesks({ [ds.dataset.deskStyle as keyof DeskStyle]: ds.dataset.value } as Partial<DeskStyle>);
    const ws = t.closest<HTMLElement>('[data-win-style]');
    if (ws) return styleWindows({ [ws.dataset.winStyle as keyof WindowStyle]: ws.dataset.value } as Partial<WindowStyle>);
    const jump = t.closest<HTMLElement>('[data-jump]');
    if (jump) return document.getElementById(jump.dataset.jump!)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (room) {
      const wl = t.closest<HTMLElement>('[data-wall]');
      if (wl) return wallFinish(room, wl.dataset.wall as WallKind);
      const fl = t.closest<HTMLElement>('[data-floor]');
      if (fl) return floorFinish(room, fl.dataset.floor as FloorKind);
      const st = t.closest<HTMLElement>('[data-step]');
      if (st) return stepRoom(room, st.dataset.step as 'x' | 'z', Number(st.dataset.dir) as 1 | -1);
      const sn = t.closest<HTMLElement>('[data-snap]');
      if (sn) return setParcelSnap(sn.dataset.snap === 'parcel');
      if (t.closest('[data-drop-room]')) return dropRoom(room);
    }
    if (!id) return;
    const rot = t.closest<HTMLElement>('[data-rotate]');
    if (rot) return void rotateItem(id, Number(rot.dataset.rotate) * STEP);
    if (t.closest('[data-duplicate]')) return duplicate(id);
    if (t.closest('[data-remove]')) return remove(id);
    const decor = t.closest<HTMLElement>('[data-decor]');
    if (decor) return setDecor(id, decor.dataset.decor as DeskDecor);
  });
  el.addEventListener('change', (e) => {
    const s = e.target as HTMLSelectElement | HTMLInputElement;
    const item = layoutItem(editSelection());
    if (s.matches('[data-owner]') && item?.slot !== undefined && s.value) setDesk(s.value, item.slot);
    const room = editRoom();
    if (s.matches('[data-room-name]') && room) renameRoom(room, s.value);
  });
  el.addEventListener('keydown', (e) => {
    const s = e.target as HTMLElement;
    if (s.matches('[data-room-name]') && e.key === 'Enter') (s as HTMLInputElement).blur();
  });
}
