import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';

import { update } from './sim/engine';
import { ensureDesks, layoutItem, onLayoutChange } from './sim/layout';
import { flush, getSelectedId, getState, reset, save, select, setSpeed, subscribe, task, worker } from './sim/store';
import type { Speed } from './sim/types';
import { OfficeScene } from './scene/scene';
import { Region, fill, pct } from './ui/dom';
import { bindRoom, renderRoom, roomFooter } from './ui/roomPanel';
import {
  editSelection,
  isEditing,
  nudgeItem,
  onEditChange,
  remove,
  resetRoom,
  rotateItem,
  selectItem,
  setEditing,
  undoLast,
} from './ui/roomState';
import { bindFeed, renderFeed } from './ui/feedTab';
import { icon } from './ui/icons';
import { bindTasks, renderTasks } from './ui/tasksTab';
import { bindTeam, renderTeam } from './ui/teamTab';
import { setupTopbar } from './ui/topbar';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- theme ----------
const THEME_KEY = 'oficina-3d:theme';
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function storedTheme(): 'light' | 'dark' | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}
const isDark = () => (storedTheme() ?? (systemDark.matches ? 'dark' : 'light')) === 'dark';

// ---------- scene ----------
const scene = new OfficeScene($('stage'), getState(), (id) => {
  select(id);
  if (id) showTab('team');
  $('stage-hint').classList.add('is-hidden');
});
scene.reducedMotion = reducedMotion.matches;
reducedMotion.addEventListener('change', () => (scene.reducedMotion = reducedMotion.matches));

function applyTheme(): void {
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  scene.setTheme(dark);
  const btn = $('theme');
  btn.innerHTML = dark ? icon.sun(16) : icon.moon(16);
  btn.setAttribute('aria-label', dark ? 'Cambiar a vista de día' : 'Cambiar a vista de noche');
  btn.title = btn.getAttribute('aria-label')!;
}
$('theme').addEventListener('click', () => {
  try {
    localStorage.setItem(THEME_KEY, isDark() ? 'light' : 'dark');
  } catch {
    /* preference just won't persist */
  }
  applyTheme();
});
systemDark.addEventListener('change', applyTheme);
applyTheme();

// ---------- panel ----------
const topbar = setupTopbar();
const regions = {
  team: new Region($('pane-team'), renderTeam),
  tasks: new Region($('pane-tasks'), renderTasks),
  feed: new Region($('pane-feed'), renderFeed),
};
type TabId = keyof typeof regions;
let activeTab: TabId = 'team';

bindTeam(regions.team.el);
bindTasks(regions.tasks.el, () => regions.tasks.render(true));
bindFeed(regions.feed.el, () => showTab('team'));

function showTab(id: TabId): void {
  if (activeTab === id) return;
  activeTab = id;
  for (const key of Object.keys(regions) as TabId[]) {
    const on = key === id;
    const tab = $(`tab-${key}`);
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    regions[key].el.hidden = !on;
  }
  regions[id].render(true);
}

const tabs = document.querySelector<HTMLElement>('[role="tablist"]')!;
tabs.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
  if (t) showTab(t.id.replace('tab-', '') as TabId);
});
tabs.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const order: TabId[] = ['team', 'tasks', 'feed'];
  const next = order[(order.indexOf(activeTab) + (e.key === 'ArrowRight' ? 1 : 2)) % 3];
  showTab(next);
  $(`tab-${next}`).focus();
  e.preventDefault();
});

// ---------- reset ----------
$('reset').innerHTML = `${icon.reset(15)}<span>Reiniciar</span>`;
$('reset').addEventListener('click', () => {
  const d = $<HTMLDialogElement>('confirm-dialog');
  d.innerHTML = `
    <form method="dialog" class="dialog-form">
      <header class="dialog-head"><h2>¿Reiniciar la simulación?</h2></header>
      <p>Vuelven el equipo y las tareas iniciales. Se pierden las tareas creadas y los cambios que hayas hecho.</p>
      <footer class="dialog-foot">
        <button class="btn btn-ghost" value="cancel" autofocus>Cancelar</button>
        <button class="btn btn-danger" value="reset">Reiniciar</button>
      </footer>
    </form>`;
  d.onclose = () => {
    if (d.returnValue === 'reset') reset();
  };
  d.showModal();
});

// ---------- room editor ----------
const roomRegion = new Region($('pane-room'), renderRoom);
const roomFoot = $('room-foot');
bindRoom(roomRegion.el, () => scene.focusPoint());
let speedBeforeEdit: Speed = 1;

function renderRoomPanel(): void {
  if (!isEditing()) return;
  roomRegion.render();
  roomFoot.innerHTML = roomFooter();
}
onEditChange(renderRoomPanel);
onLayoutChange(renderRoomPanel);

const editBtn = $('edit-room');
editBtn.innerHTML = `${icon.room(15)}<span>Editar sala</span>`;
editBtn.addEventListener('click', () => toggleEditing(!isEditing()));

function toggleEditing(on: boolean): void {
  if (on === isEditing()) return;
  if (on) {
    speedBeforeEdit = getState().speed;
    setSpeed(0);
    select(null);
  } else {
    setSpeed(speedBeforeEdit);
  }
  setEditing(on);
  scene.setEditing(on);
  document.body.classList.toggle('is-editing', on);
  editBtn.setAttribute('aria-pressed', String(on));
  $('stage-hint').hidden = on;
  $('edit-hint').hidden = !on;
  // The editor takes the panel over; the tabs come back as they were.
  document.querySelector<HTMLElement>('.tabs')!.hidden = on;
  for (const key of Object.keys(regions) as TabId[]) regions[key].el.hidden = on || key !== activeTab;
  roomRegion.el.hidden = !on;
  roomFoot.hidden = !on;
  if (on) {
    roomRegion.render(true);
    roomFoot.innerHTML = roomFooter();
  } else {
    regions[activeTab].render(true);
  }
}

roomFoot.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('[data-done]')) toggleEditing(false);
  else if (t.closest('[data-undo]')) undoLast();
  else if (t.closest('[data-reset-room]')) confirmResetRoom();
});

function confirmResetRoom(): void {
  const d = $<HTMLDialogElement>('confirm-dialog');
  d.innerHTML = `
    <form method="dialog" class="dialog-form">
      <header class="dialog-head"><h2>¿Volver a la distribución original?</h2></header>
      <p>Los muebles y plantas vuelven a su sitio inicial y se quita lo que hayas añadido. Puedes deshacerlo después.</p>
      <footer class="dialog-foot">
        <button class="btn btn-ghost" value="cancel" autofocus>Cancelar</button>
        <button class="btn btn-primary" value="reset">Restaurar</button>
      </footer>
    </form>`;
  d.onclose = () => {
    if (d.returnValue === 'reset') {
      resetRoom();
      ensureDesks(getState().workers.map((w) => w.desk));
    }
  };
  d.showModal();
}

// ---------- keyboard ----------
function roomKeys(e: KeyboardEvent): boolean {
  const typing = (e.target as HTMLElement).closest?.('input, select, textarea');
  if (typing) return false;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    undoLast();
    return true;
  }
  if (e.metaKey || e.ctrlKey) return false;
  const id = editSelection();
  if (e.key === 'Escape') {
    if (id) selectItem(null);
    else toggleEditing(false);
    return true;
  }
  if (!id || !layoutItem(id)) return false;
  const step = e.altKey ? 0.05 : 0.25;
  const turn = Math.PI / 12;
  switch (e.key) {
    case 'Delete':
    case 'Backspace':
      remove(id);
      return true;
    case 'r':
    case 'R':
      rotateItem(id, e.shiftKey ? -6 * turn : 6 * turn);
      return true;
    case 'q':
    case 'Q':
      rotateItem(id, turn);
      return true;
    case 'e':
    case 'E':
      rotateItem(id, -turn);
      return true;
  }
  // Arrows move the way the room looks on screen right now.
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  const a = arrows[e.key];
  if (a) {
    const d = scene.screenToFloor(a[0], a[1]);
    nudgeItem(id, d.x * step, d.z * step);
    return true;
  }
  return false;
}

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  if (isEditing()) {
    // Buttons and chips keep their own keys; the room only takes keys aimed at the scene.
    const onControl = (e.target as HTMLElement).closest?.('button') && (e.key === 'Enter' || e.key === ' ');
    if (!onControl && roomKeys(e)) e.preventDefault();
    return;
  }
  if (e.key === 'Escape' && getSelectedId()) select(null);
});

// ---------- state → view ----------
function syncNumbers(): void {
  topbar.update();
  const panel = regions[activeTab].el;
  panel.querySelectorAll<HTMLElement>('[data-progress]').forEach((el) => {
    const t = task(el.dataset.progress!);
    if (t) el.style.transform = fill(t.status === 'review' ? t.reviewProgress : t.progress);
  });
  panel.querySelectorAll<HTMLElement>('[data-pct]').forEach((el) => {
    const t = task(el.dataset.pct!);
    if (t) el.textContent = pct(t.status === 'review' ? t.reviewProgress : t.progress);
  });
  panel.querySelectorAll<HTMLElement>('[data-energy]').forEach((el) => {
    const w = worker(el.dataset.energy!);
    if (w) el.style.transform = fill(w.energy);
  });
  panel.querySelectorAll<HTMLElement>('[data-energy-pct]').forEach((el) => {
    const w = worker(el.dataset.energyPct!);
    if (w) el.textContent = pct(w.energy);
  });
  scene.refreshLabels(getState());
}

// Every worker needs a desk, also after a simulation reset.
ensureDesks(getState().workers.map((w) => w.desk));

subscribe((kind) => {
  if (kind !== 'change') return;
  ensureDesks(getState().workers.map((w) => w.desk));
  renderRoomPanel();
  scene.setSelected(getSelectedId());
  regions[activeTab].render();
  syncNumbers();
});

regions.team.render(true);
syncNumbers();

// ---------- loop ----------
let last = performance.now();
let uiClock = 0;
function loop(now: number): void {
  // rAF timestamps can predate performance.now() taken at startup: never step backwards.
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  update(dt);
  scene.frame(dt, now / 1000, getState());
  uiClock += dt;
  if (uiClock > 0.25) {
    uiClock = 0;
    syncNumbers();
  }
  flush();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) save();
  last = performance.now();
});
