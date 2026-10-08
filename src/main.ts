import { ambience, onSoundChange, setSoundOn, soundOn } from './scene/ambience';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';

import { layoutItem, onLayoutChange, pruneDesks } from './sim/layout';
import { deskOwners } from './sim/ops';
import { DEFAULT_SETTINGS, type Settings } from './sim/settings';
import { api, callMeeting, connect, flush, getSelectedId, getState, onConnection, onRefusal, readMessages, reset, select, subscribe, task } from './sim/store';
import { OfficeScene } from './scene/scene';
import { guessLocation, sunPosition } from './scene/sun';
import { Region, fill, pct } from './ui/dom';
import { bindRoom, renderRoom, roomFooter } from './ui/roomPanel';
import { onThumbs } from './scene/thumbs';
import {
  editRoom,
  editSelection,
  isEditing,
  nudgeItem,
  onEditChange,
  remove,
  resetRoom,
  rotateItem,
  selectRoom,
  setEditing,
  undoLast,
} from './ui/roomState';
import { bindInbox, renderInbox, unreadCount } from './ui/inbox';
import { bindTalks, openConversation, renderTalks } from './ui/talksTab';
import { bindMeeting, meetingComposer, renderMeeting, syncMeetingComposer } from './ui/meetingPanel';
import { bindChat, chatComposer, renderChat, syncChat } from './ui/chatFloat';
import { bindDossier } from './ui/dossier';
import { bindCalendar, openCalendar } from './ui/calendar';
import { esc } from './ui/dom';
import { icon } from './ui/icons';
import { bindTasks, renderTasks } from './ui/tasksTab';
import { activityShown, bindTeam, renderTeam, resetDetailTab } from './ui/teamTab';
import { openWorkerDialog } from './ui/workerDialog';
import { now } from './ui/now';
import { config } from './ui/config';
import { loadSecrets } from './ui/keyField';
import { loadLibrary, openSettings } from './ui/settingsDialog';
import { setupTopbar } from './ui/topbar';
import { setupWeatherMenu } from './ui/weatherMenu';
import { setupAiStatus } from './ui/aiStatus';
import { readPref, savePref } from './sim/prefs';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- local server ----------
// The office lives in the local server: nothing to show until it answers.
try {
  await connect();
} catch {
  document.body.innerHTML = `
    <main class="no-server">
      <h1>No encuentro el servidor local</h1>
      <p>La oficina vive en un pequeño servidor en este ordenador. Arráncalo con <code>npm run dev</code> y recarga la página.</p>
    </main>`;
  throw new Error('Local server unreachable');
}
onConnection((online) => ($('offline').hidden = online));
let toastTimer = 0;
onRefusal((text) => {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 4500);
});

// ---------- theme ----------
// The panel follows the sky: dark once night falls, light by day. Switching it by hand holds
// until the next sunrise or nightfall, then it follows the sky again.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let skyDark = false;

function storedTheme(): 'light' | 'dark' | null {
  try {
    const v = JSON.parse(readPref('theme') ?? 'null') as { theme: 'light' | 'dark'; night: boolean } | null;
    return v && v.night === skyDark && (v.theme === 'light' || v.theme === 'dark') ? v.theme : null;
  } catch {
    return null;
  }
}
const isDark = () => (storedTheme() ?? (skyDark ? 'dark' : 'light')) === 'dark';

// ---------- scene ----------
const scene = new OfficeScene($('stage'), getState(), (id) => {
  select(id);
  if (id) showTab('team');
  $('stage-hint').classList.add('is-hidden');
});
// In development only: a handle for checking the graphics memory from the console.
if (import.meta.env.DEV) Object.assign(window, { __scene: scene, __ambience: ambience });
scene.reducedMotion = reducedMotion.matches;
reducedMotion.addEventListener('change', () => (scene.reducedMotion = reducedMotion.matches));

// The panel follows the theme; the office itself is lit by the real sun (see daylight below).
function applyTheme(): void {
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const btn = $('theme');
  btn.innerHTML = dark ? icon.sun(16) : icon.moon(16);
  btn.setAttribute('aria-label', dark ? 'Panel claro' : 'Panel oscuro');
  btn.title = btn.getAttribute('aria-label')!;
}
$('theme').addEventListener('click', () => {
  savePref('theme', JSON.stringify({ theme: isDark() ? 'light' : 'dark', night: skyDark }));
  applyTheme();

// The sound outside (birds, rain, storm): on or off, remembered on this device.
function applySound(): void {
  const btn = $('sound');
  const on = soundOn();
  btn.innerHTML = on ? icon.soundOn(16) : icon.soundOff(16);
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', on ? 'Silenciar el sonido de fuera' : 'Activar el sonido de fuera');
  btn.title = btn.getAttribute('aria-label')!;
}
$('sound').addEventListener('click', () => setSoundOn(!soundOn()));
onSoundChange(applySound);
applySound();
});
applyTheme();

// ---------- daylight ----------
let settings: Settings = DEFAULT_SETTINGS;

function applyDaylight(): void {
  const loc = settings.location ?? guessLocation();
  scene.setDaylight(now(), loc.lat, loc.lon, settings.north);
  // Night for the panel: from the end of dusk (sun 4° below the horizon).
  const night = sunPosition(now(), loc.lat, loc.lon).elevation < -4;
  if (night !== skyDark) {
    skyDark = night;
    applyTheme();
  }
}

try {
  settings = await api<Settings>('/api/settings');
  if (!settings.location) settings = await api<Settings>('/api/settings', 'PUT', { location: { ...guessLocation(), guessed: true } });
  // Which keys exist (never their values) and the connector library, for the agents' AI section.
  await Promise.all([loadSecrets(), loadLibrary()]);
} catch {
  /* keep the time-zone guess; AI sections show as unconfigured */
}
config.settings = settings;
applyDaylight();
setInterval(applyDaylight, 30_000);

function showSettings(tab: 'general' | 'ai' | 'mcp' | 'project' = 'general'): void {
  void openSettings(
    settings,
    (next) => {
      settings = config.settings = next;
      applyDaylight();
    },
    tab,
  );
}
$('settings').innerHTML = icon.settings(16);
$('settings').addEventListener('click', () => showSettings());
document.addEventListener('open-settings', (e) => showSettings((e as CustomEvent<'general' | 'ai' | 'mcp' | 'project'>).detail));
// Keys or connectors may have changed: the agent's AI section reflects them.
$('settings-dialog').addEventListener('close', () => regions[activeTab].render(true));

// ---------- panel ----------
const topbar = setupTopbar();
setupWeatherMenu();
setupAiStatus();
const regions = {
  team: new Region($('pane-team'), renderTeam),
  tasks: new Region($('pane-tasks'), renderTasks),
  talks: new Region($('pane-talks'), renderTalks),
  inbox: new Region($('pane-inbox'), renderInbox),
};
type TabId = keyof typeof regions;
let activeTab: TabId = 'team';

bindTeam(regions.team.el, () => regions.team.render(true));
bindTasks(regions.tasks.el, () => regions.tasks.render(true));
bindInbox();
document.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-open-inbox]')) showTab('inbox');
});
// The activity log opening or closing over the chart.
document.addEventListener('panel-change', () => {
  applyPanel();
  regions.team.render(true);
});
bindTalks(regions.talks.el, () => regions.talks.render(true), () => showTab('team'));
document.addEventListener('open-tasks', () => showTab('tasks'));
document.addEventListener('open-calendar', () => openCalendar());
document.addEventListener('add-agent', () => openWorkerDialog(null));
// A speech bubble, a link between two people or "Ver conversación" in someone's card.
document.addEventListener('open-conversation', (e) => {
  openConversation((e as CustomEvent<string>).detail);
  if (activeTab === 'talks') regions.talks.render(true);
  else showTab('talks');
});

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
  if (id === 'inbox') syncInbox();
}

const tabs = document.querySelector<HTMLElement>('[role="tablist"]')!;
tabs.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
  if (t) showTab(t.id.replace('tab-', '') as TabId);
});
tabs.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const order: TabId[] = ['team', 'tasks', 'talks', 'inbox'];
  const next = order[(order.indexOf(activeTab) + (e.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length];
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
      <header class="dialog-head"><h2>¿Reiniciar la oficina?</h2></header>
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

function renderRoomPanel(): void {
  if (!isEditing()) return;
  roomRegion.render();
  roomFoot.innerHTML = roomFooter();
}
onEditChange(renderRoomPanel);
onLayoutChange(renderRoomPanel);
onThumbs(renderRoomPanel);

const editBtn = $('edit-room');
editBtn.innerHTML = `${icon.room(15)}<span>Editar oficina</span>`;
editBtn.addEventListener('click', () => toggleEditing(!isEditing()));

function toggleEditing(on: boolean): void {
  if (on === isEditing()) return;
  if (on) select(null);
  setEditing(on);
  scene.setEditing(on);
  document.body.classList.toggle('is-editing', on);
  editBtn.setAttribute('aria-pressed', String(on));
  $('stage-hint').hidden = on;
  $('edit-hint').hidden = !on;
  applyPanel();
  if (on) {
    roomRegion.render(true);
    roomFoot.innerHTML = roomFooter();
  } else {
    regions[activeTab].render(true);
  }
}

// ---------- who owns the panel ----------
// The room editor, then a meeting with you, then a selected person, then the office's tabs.
const meetingPane = $('pane-meeting');
const meetingLog = new Region($('meeting-log'), renderMeeting);
$('meeting-compose').innerHTML = meetingComposer();
bindMeeting(meetingPane);
bindDossier();
bindCalendar();
let meetingShown: string | null = null;

// Your chat with one person, floating over the left of the office.
const chatFloat = $('chat-float');
const chatLog = new Region($('chat-log'), renderChat);
$('chat-compose').innerHTML = chatComposer();
bindChat(chatFloat);
const syncChatFloat = () => syncChat(chatFloat, (force) => chatLog.render(force));
document.addEventListener('chat-change', syncChatFloat);
chatFloat.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-open-settings]')) showSettings('ai');
});

function applyPanel(): void {
  const editing = isEditing();
  const meeting = !editing && !!getState().meeting;
  const person = !editing && !meeting && (!!getSelectedId() || (activeTab === 'team' && activityShown()));
  tabs.hidden = editing || meeting || person;
  for (const key of Object.keys(regions) as TabId[]) regions[key].el.hidden = editing || meeting || key !== activeTab;
  meetingPane.hidden = !meeting;
  roomRegion.el.hidden = !editing;
  roomFoot.hidden = !editing;
}

/** Over the office: how the story starts, or that the head is waiting for you. */
const story = $('story');
let storyKey = '';
function syncStory(): void {
  const s = getState();
  const head = s.workers.find((w) => w.role === 'director');
  const iv = s.workers.find((w) => w.role === 'interviewer');
  let key = '';
  let html = '';
  if (!s.meeting && !s.brief.kickedOff) {
    key = `start-${s.working}-${s.ai.state}`;
    html = `
      <h2 class="story-title">Empieza la historia</h2>
      <p class="story-text">Tu oficina aún no sabe en qué trabaja. Siéntate con ${esc(head?.name ?? 'Dirección')} e ${esc(iv?.name ?? 'Entrevistas')} y cuéntales tu producto. Hasta entonces nadie se pone a trabajar: no van a inventárselo.</p>
      ${
        s.ai.state === 'off'
          ? '<p class="story-text">Antes conecta la IA en <button class="link" type="button" data-story-settings>Ajustes → IA</button>.</p>'
          : s.working
            ? '<button class="btn btn-primary" type="button" data-story-meet>Reunirme con ellas</button>'
            : '<p class="story-text">Pulsa <strong>Trabajar</strong> arriba para que vengan a la oficina.</p>'
      }`;
  } else if (!s.meeting && s.health.crisis) {
    key = `crisis-${s.health.overall}`;
    html = `
      <h2 class="story-title">La salud del proyecto está en el ${s.health.overall} %</h2>
      <p class="story-text">El trabajo está en pausa hasta que hables con la dirección.</p>
      <button class="btn btn-primary" type="button" data-story-meet>Reunirme</button>`;
  }
  if (key === storyKey) return;
  storyKey = key;
  story.hidden = !html;
  story.innerHTML = html;
}
story.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('[data-story-meet]')) callMeeting();
  else if (t.closest('[data-story-settings]')) showSettings('ai');
});

function syncMeeting(): void {
  const m = getState().meeting;
  applyPanel();
  if (!m) {
    meetingShown = null;
    return;
  }
  const atBottom = meetingPane.scrollHeight - meetingPane.scrollTop - meetingPane.clientHeight < 80;
  meetingLog.render(meetingShown !== m.id);
  syncMeetingComposer($('meeting-compose'));
  // Follow the conversation, unless you scrolled up to reread.
  if (meetingShown !== m.id || atBottom) meetingPane.scrollTop = meetingPane.scrollHeight;
  if (meetingShown !== m.id) $<HTMLTextAreaElement>('meeting-say').focus();
  meetingShown = m.id;
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
      <p>Vuelven las cuatro salas iniciales con sus muebles, y se quita lo que hayas añadido. Las mesas de los agentes se quedan, colocadas en su sitio por defecto. Puedes deshacerlo después.</p>
      <footer class="dialog-foot">
        <button class="btn btn-ghost" value="cancel" autofocus>Cancelar</button>
        <button class="btn btn-primary" value="reset">Restaurar</button>
      </footer>
    </form>`;
  d.onclose = () => {
    if (d.returnValue === 'reset') {
      resetRoom(deskSlots());
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
    if (id || editRoom()) selectRoom(null);
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
    if (t) el.style.transform = fill(t.progress);
  });
  panel.querySelectorAll<HTMLElement>('[data-pct]').forEach((el) => {
    const t = task(el.dataset.pct!);
    if (t) el.textContent = pct(t.progress);
  });
  scene.refreshLabels(getState());
}

// Desks belong to agents: you place each new one in the editor, and it leaves with its agent.
// Of the fixed roles only the head has one, in their office.
function deskSlots(): number[] {
  return deskOwners(getState().workers).map((w) => w.desk);
}
pruneDesks(deskSlots());

/** With someone selected the panel is theirs: the office's tabs step aside for their own. */
let shownWorker: string | null = null;
function syncWorkerPanel(): void {
  const id = getSelectedId();
  if (id === shownWorker) return;
  shownWorker = id;
  applyPanel();
  if (id) {
    resetDetailTab();
    showTab('team');
    regions.team.render(true);
  }
}

subscribe((kind) => {
  if (kind !== 'change') return;
  pruneDesks(deskSlots());
  renderRoomPanel();
  syncWorkerPanel();
  syncMeeting();
  syncChatFloat();
  syncStory();
  scene.setSelected(getSelectedId());
  regions[activeTab].render();
  syncNumbers();
  syncInbox();
});

/** «Para ti» shows how many are new; looking at the list counts as reading them. */
const inboxBadge = $('inbox-badge');
function syncInbox(): void {
  const n = unreadCount();
  if (n && activeTab === 'inbox' && !tabs.hidden && document.visibilityState === 'visible') {
    readMessages('all');
    return;
  }
  inboxBadge.hidden = !n;
  inboxBadge.textContent = n > 9 ? '9+' : String(n);
}

regions.team.render(true);
syncNumbers();

// ---------- loop ----------
let last = performance.now();
let uiClock = 0;
function loop(t: number): void {
  // rAF timestamps can predate performance.now() taken at startup: never step backwards.
  const dt = Math.min(0.1, Math.max(0, (t - last) / 1000));
  last = t;
  scene.frame(dt, t / 1000, getState());
  uiClock += dt;
  if (uiClock > 0.25) {
    uiClock = 0;
    syncNumbers();
  }
  flush();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

document.addEventListener('visibilitychange', () => {
  last = performance.now();
  if (!document.hidden) applyDaylight();
});
