import {
  DESK_DECOR,
  DESK_FRAMES,
  DESK_MODELS,
  DESK_TOPS,
  deskStyle,
  floorKind,
  FLOORS,
  wallKind,
  WALLS,
  KIND_ORDER,
  KINDS,
  layoutItem,
  layoutItems,
  type Category,
  type DeskDecor,
  type DeskStyle,
  type FloorKind,
  type WallKind,
  type ItemKind,
  type P,
} from '../sim/layout';
import { getState, setDesk } from '../sim/store';
import { esc } from './dom';
import { icon } from './icons';
import {
  addKind,
  canUndo,
  deskOwner,
  duplicate,
  editMessage,
  editSelection,
  remove,
  removeBlocker,
  rotateItem,
  setDecor,
  floorFinish,
  styleDesks,
  wallFinish,
} from './roomState';
import { floorThumb, WALL_PAINT, wallThumb } from '../scene/floors';

const CATEGORIES: Category[] = ['Mobiliario', 'Plantas', 'Pared'];
const STEP = Math.PI / 12;

function inspector(): string {
  const item = layoutItem(editSelection());
  if (!item) {
    return `<p class="room-empty">Pulsa un objeto de la sala para seleccionarlo. Ya seleccionado, arrástralo para moverlo, o gíralo y quítalo desde aquí.</p>`;
  }
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
      <button class="btn btn-ghost room-desk-look" type="button" data-desk-look data-key="desk-look">Personalizar mesa…</button>`
      : '';

  const turn = info.wall
    ? `<p class="section-note">Va colgada: arrástrala por la pared del fondo o la de la izquierda.</p>`
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

/** One look for all desks: model, top and frame. */
function deskLook(): string {
  const st = deskStyle();
  const swatch = (key: keyof DeskStyle, list: { id: string; label: string; color: string }[]) =>
    `<div class="swatches" role="group">${list
      .map(
        (o) =>
          `<button type="button" class="swatch" style="--swatch:${o.color}" data-desk-style="${key}" data-value="${o.id}" data-key="ds-${key}-${o.id}" aria-pressed="${
            st[key] === o.id
          }" aria-label="${esc(o.label)}" title="${esc(o.label)}"></button>`,
      )
      .join('')}</div>`;
  return `
    <section class="section room-desks" id="room-desks" aria-labelledby="room-desks-title">
      <h3 class="section-title" id="room-desks-title">Personalizar mesas</h3>
      <p class="section-note">Se aplica a todos los puestos a la vez.</p>
      <fieldset class="room-field">
        <legend>Modelo</legend>
        <div class="chips" role="group">
          ${DESK_MODELS.map(
            (d) =>
              `<button type="button" class="chip" data-desk-style="model" data-value="${d.id}" data-key="ds-model-${d.id}" aria-pressed="${st.model === d.id}" title="${esc(d.note)}">${d.label}</button>`,
          ).join('')}
        </div>
      </fieldset>
      <fieldset class="room-field">
        <legend>Tablero · ${esc(DESK_TOPS.find((t) => t.id === st.top)!.label)}</legend>
        ${swatch('top', DESK_TOPS)}
      </fieldset>
      <fieldset class="room-field">
        <legend>Estructura · ${esc(DESK_FRAMES.find((f) => f.id === st.frame)!.label)}</legend>
        ${swatch('frame', DESK_FRAMES)}
      </fieldset>
    </section>`;
}

/** Floor finish for the whole room, picked from real previews of each texture. */
function floorPicker(): string {
  const current = floorKind();
  return `
    <section class="section" aria-labelledby="room-floor-title">
      <h3 class="section-title" id="room-floor-title">Suelo</h3>
      <p class="section-note">${esc(FLOORS.find((f) => f.id === current)!.label)}</p>
      <div class="floor-grid" role="group" aria-label="Acabado del suelo">
        ${FLOORS.map((f) => {
          const thumb = floorThumb(f.id);
          return `<button type="button" class="floor-opt ${thumb ? '' : 'floor-plain'}" data-floor="${f.id}" data-key="floor-${f.id}" aria-pressed="${
            f.id === current
          }" aria-label="${esc(f.label)}" title="${esc(f.label)}" ${thumb ? `style="background-image:url(${thumb})"` : ''}></button>`;
        }).join('')}
      </div>
    </section>`;
}

/** Finish on the inside of the walls: paints show their colour, the rest a texture preview. */
function wallPicker(): string {
  const current = wallKind();
  return `
    <section class="section" aria-labelledby="room-wall-title">
      <h3 class="section-title" id="room-wall-title">Paredes</h3>
      <p class="section-note">${esc(WALLS.find((w) => w.id === current)!.label)}</p>
      <div class="floor-grid" role="group" aria-label="Acabado de las paredes">
        ${WALLS.map((w) => {
          const thumb = wallThumb(w.id);
          const paint = WALL_PAINT[w.id];
          const style = thumb ? `background-image:url(${thumb})` : paint ? `background:${paint}` : '';
          return `<button type="button" class="floor-opt ${thumb || paint ? '' : 'wall-plain'}" data-wall="${w.id}" data-key="wall-${w.id}" aria-pressed="${
            w.id === current
          }" aria-label="${esc(w.label)}" title="${esc(w.label)}" ${style ? `style="${style}"` : ''}></button>`;
        }).join('')}
      </div>
    </section>`;
}

function catalog(): string {
  const items = layoutItems();
  return CATEGORIES.map((cat) => {
    const kinds = KIND_ORDER.filter((k) => KINDS[k].category === cat);
    return `
      <h4 class="room-cat">${cat}</h4>
      <ul class="room-catalog">
        ${kinds
          .map((k) => {
            const n = items.filter((i) => i.kind === k).length;
            const unique = KINDS[k].unique;
            return `<li>
              <span class="room-kind">${KINDS[k].label}</span>
              <span class="count" title="En la sala">${n}</span>
              ${
                unique
                  ? '<span class="meta room-only">Solo una</span>'
                  : `<button class="btn btn-ghost room-add" type="button" data-add="${k}" data-key="add-${k}" aria-label="Añadir ${KINDS[k].label.toLowerCase()}">${icon.plus(15)}Añadir</button>`
              }
            </li>`;
          })
          .join('')}
      </ul>`;
  }).join('');
}

export function renderRoom(): string {
  const msg = editMessage();
  return `
    <div class="room">
      <header class="room-head">
        <h2>Editar sala</h2>
        <p class="section-note">La simulación queda en pausa mientras amueblas. Cada persona sigue a su puesto allá donde lo pongas.</p>
      </header>
      <section class="section room-inspect" aria-label="Objeto seleccionado">
        ${inspector()}
        <p class="room-msg ${msg ? 'is-shown' : ''}" role="status" aria-live="polite">${msg ? `${icon.alert(14)}${esc(msg)}` : ''}</p>
      </section>
      ${deskLook()}
      ${floorPicker()}
      ${wallPicker()}
      <section class="section" aria-label="Añadir objetos">
        <h3 class="section-title">Añadir a la sala</h3>
        ${catalog()}
      </section>
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
    const add = t.closest<HTMLElement>('[data-add]');
    if (add) return addKind(add.dataset.add as ItemKind, near());
    const wl = t.closest<HTMLElement>('[data-wall]');
    if (wl) return wallFinish(wl.dataset.wall as WallKind);
    const fl = t.closest<HTMLElement>('[data-floor]');
    if (fl) return floorFinish(fl.dataset.floor as FloorKind);
    const ds = t.closest<HTMLElement>('[data-desk-style]');
    if (ds) return styleDesks({ [ds.dataset.deskStyle as keyof DeskStyle]: ds.dataset.value } as Partial<DeskStyle>);
    if (t.closest('[data-desk-look]')) return document.getElementById('room-desks')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!id) return;
    const rot = t.closest<HTMLElement>('[data-rotate]');
    if (rot) return void rotateItem(id, Number(rot.dataset.rotate) * STEP);
    if (t.closest('[data-duplicate]')) return duplicate(id);
    if (t.closest('[data-remove]')) return remove(id);
    const decor = t.closest<HTMLElement>('[data-decor]');
    if (decor) return setDecor(id, decor.dataset.decor as DeskDecor);
  });
  el.addEventListener('change', (e) => {
    const s = e.target as HTMLSelectElement;
    const item = layoutItem(editSelection());
    if (s.matches('[data-owner]') && item?.slot !== undefined && s.value) setDesk(s.value, item.slot);
  });
}

