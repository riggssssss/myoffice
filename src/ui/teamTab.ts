import { bossProblem, depthOf, headOf, isRequired, queueOf, reportsOf } from '../sim/ops';
import { ROLES } from '../sim/seed';
import {
  answerQuestion,
  assignTask,
  deleteChatArchive,
  callSkeptic,
  getSelectedId,
  setWorkerAi,
  getState,
  removeWorker,
  select,
  setBoss,
  setEnabled,
  setPair,
  setStatus,
  task,
  worker,
} from '../sim/store';
import type { Worker } from '../sim/types';
import { bar, esc, pct, roleDot, stamp } from './dom';
import { ACTIVITY_LABEL, activityIcon, feedIcon, icon } from './icons';
import { renderFeed } from './feedTab';
import { openLookEditor } from './lookEditor';
import { openTaskDialog } from './taskDialog';
import { openWorkerDialog } from './workerDialog';
import { openTemplateDialog } from './teamTemplates';
import { bindStyle, styleChange, styleClick, stylePane } from './stylePane';
import { inventoryPane } from './itemsTab';
import { agentKey, PROVIDERS, type TextProvider } from '../sim/settings';
import { modelInput } from './modelInput';
import { config, openSettingsAt } from './config';
import { bindKeyFields, hasSecret, keyField, secretTail } from './keyField';
import { deskBySlot } from '../sim/layout';

const initial = (w: Worker, size = '') =>
  `<span class="avatar ${size}" style="--role:${ROLES[w.role].color}" aria-hidden="true">${esc(w.name[0])}</span>`;

function statusPill(w: Worker): string {
  return `<span class="status status-${w.activity}">${activityIcon(w.activity, w.role, 13)}${ACTIVITY_LABEL[w.activity]}</span>`;
}

// ---------------------------------------------------------------- org chart

/** A person in the family tree: portrait, name, job. Status rides on the portrait. */
function node(w: Worker, head = false): string {
  const t = task(w.taskId);
  const state = w.enabled ? ACTIVITY_LABEL[w.activity] : 'Desactivado';
  const fixed = isRequired(w);
  return `
    <button class="org-node${head ? ' is-head' : ''}${w.enabled ? '' : ' is-off'}" type="button" ${fixed ? '' : 'draggable="true"'}
      style="--role:${ROLES[w.role].color}" data-select="${w.id}" data-drag="${w.id}" data-key="org-${w.id}"
      aria-label="${esc(w.name)}, ${esc(w.title)}. ${state}${t ? `: ${esc(t.title)}` : ''}" title="${state}${t ? ` · ${esc(t.title)}` : ''}">
      <span class="org-face" aria-hidden="true">
        ${esc(w.name[0])}
        <span class="org-dot org-${w.enabled ? w.activity : 'off'}"></span>
      </span>
      <span class="org-name">${esc(w.name)}</span>
      <span class="org-title">${esc(w.title)}</span>
    </button>`;
}

function branch(workers: Worker[], w: Worker): string {
  const kids = reportsOf(workers, w.id).filter((k) => !k.staff);
  return `<li>${node(w)}${kids.length ? `<ul>${kids.map((k) => branch(workers, k)).join('')}</ul>` : ''}</li>`;
}

function renderChart(): string {
  const workers = getState().workers;
  const head = headOf(workers);
  if (!head) return '';
  const outside = reportsOf(workers, head.id).filter((k) => k.staff);
  const kids = reportsOf(workers, head.id).filter((k) => !k.staff);

  return `
    <div class="toolbar toolbar-row">
      <h2 class="section-title">Organigrama <span class="count">${workers.length}</span></h2>
      <span class="toolbar-actions">
        <button class="btn" type="button" data-templates data-key="templates">${icon.users(15)}Plantillas de equipo</button>
        <button class="btn btn-primary" type="button" data-add data-key="add">${icon.userPlus(15)}Añadir agente</button>
      </span>
    </div>
    <div class="org-scroll">
      <div class="org">
        <ul><li>${node(head, true)}${kids.length ? `<ul>${kids.map((k) => branch(workers, k)).join('')}</ul>` : ''}</li></ul>
      </div>
    </div>
    ${
      outside.length
        ? `<section class="org-outside" aria-label="Fuera de la oficina">
            <div class="org-outside-text">
              <h3>Fuera de la oficina</h3>
              <p>Ronda por fuera criticando lo que ve. Entra a hablar con ${esc(head.name)} cuando tiene algo que decir.</p>
            </div>
            ${outside.map((o) => node(o)).join('')}
          </section>`
        : ''
    }
    <p class="section-note org-hint">Arrastra a alguien sobre otra persona para cambiar a quién responde. Dirección, Organización y el Escéptico tienen puesto fijo.</p>`;
}

// ---------------------------------------------------------------- one person

function bossOptions(w: Worker): string {
  const workers = getState().workers;
  return workers
    .filter((b) => b.id !== w.id && !bossProblem(workers, w.id, b.id))
    .sort((a, b) => depthOf(workers, a.id) - depthOf(workers, b.id))
    .map((b) => `<option value="${b.id}" ${b.id === w.reportsTo ? 'selected' : ''}>${esc(b.name)} · ${esc(b.title)}</option>`)
    .join('');
}

/** Which AI they think with and which connectors they use. */
function aiSection(w: Worker): string {
  const { settings, library } = config;
  const office = settings.ai.provider;
  const provider = w.ai.provider ?? office;
  const info = PROVIDERS[provider];
  const providerBlock = `
    <div class="field">
      <label for="ai-provider-${w.id}">Proveedor</label>
      <select id="ai-provider-${w.id}" data-ai-provider="${w.id}" data-key="ai-provider">
        <option value="" ${w.ai.provider ? '' : 'selected'}>El de Ajustes · ${esc(PROVIDERS[office].label)}</option>
        ${(Object.keys(PROVIDERS) as TextProvider[]).map((p) => `<option value="${p}" ${p === w.ai.provider ? 'selected' : ''}>${PROVIDERS[p].label}</option>`).join('')}
      </select>
    </div>`;
  let keyBlock = `<p class="section-note">Ollama corre en tu ordenador: no hace falta clave.</p>`;
  if (info.key) {
    const shared = hasSecret(info.key);
    keyBlock = `
      <div class="field">
        <label for="ai-key-${w.id}">Clave de ${esc(info.label)}</label>
        <select id="ai-key-${w.id}" data-ai-key="${w.id}" data-key="ai-key">
          <option value="shared" ${w.ai.sharedKey ? 'selected' : ''}>La de Ajustes${shared ? ` · ····${esc(secretTail(info.key))}` : ' · sin configurar'}</option>
          <option value="own" ${w.ai.sharedKey ? '' : 'selected'}>Una propia para ${esc(w.name)}</option>
        </select>
      </div>
      ${
        w.ai.sharedKey
          ? shared
            ? ''
            : `<p class="section-note">Todavía no hay clave de ${esc(info.label)} en Ajustes. <button class="link" type="button" data-open-settings="ai">Ponerla</button></p>`
          : keyField(agentKey(w.id, provider), `Clave de ${info.label} de ${w.name}`, { help: info.help })
      }`;
  }
  // Left empty: the office's model when they share its provider, else that provider's usual one.
  const fallback = provider === office ? settings.ai.model : info.defaultModel;
  const fallbackLabel = info.models.find((m) => m.id === fallback)?.label ?? fallback;
  const modelBlock = `
    <div class="field">
      <label for="ai-model-${w.id}">Modelo</label>
      ${modelInput(`ai-model-${w.id}`, provider, w.ai.model, `data-ai-model="${w.id}" data-key="ai-model"`, `${provider === office ? 'El de Ajustes' : 'El habitual'} · ${fallbackLabel}`)}
    </div>`;
  const mcps = library.length
    ? `<ul class="ai-mcps">${library
        .map(
          (m) => `<li><label class="check"><input type="checkbox" data-ai-mcp="${m.id}" data-key="mcp-${m.id}" ${w.ai.mcps.includes(m.id) ? 'checked' : ''} /><span>${esc(m.name)}</span></label></li>`,
        )
        .join('')}</ul>`
    : `<p class="section-note">Tu biblioteca de conectores está vacía. <button class="link" type="button" data-open-settings="mcp">Añadir conectores</button></p>`;
  return `
    <section class="section">
      <h3 class="section-title">IA</h3>
      ${providerBlock}
      ${keyBlock}
      ${modelBlock}
      <p class="section-note">Si esta IA llega a un límite o falla, sigue con tu lista de prioridad de <button class="link" type="button" data-open-settings="ai">Ajustes → IA</button>.</p>
      <h4 class="sub-title">Conectores</h4>
      <p class="section-note">Cuando tenga la IA conectada elegirá él mismo los que necesita. Aquí puedes corregirlo.</p>
      ${mcps}
    </section>`;
}

/** Who they're talking to right now, with a way into the conversation. */
function talkBlock(w: Worker): string {
  if (!w.talk) return '';
  const c = getState().conversations.find((x) => x.id === w.talk!.convId);
  const other = getState().workers.find((o) => o.id === w.talk!.with);
  if (!c || !other) return '';
  const last = c.lines[c.lines.length - 1];
  return `
    <button class="detail-note talk-now" type="button" data-open-talk="${c.id}" data-key="talk-now">
      ${icon.talk(14)}
      <span>Hablando con ${esc(other.name)}${last ? `: «${esc(last.text.length > 90 ? `${last.text.slice(0, 90)}…` : last.text)}»` : ''} <span class="link">Ver conversación</span></span>
    </button>`;
}

/** Where someone sits in the chart, in words, for the three fixed roles. */
function fixedPlace(w: Worker, boss: Worker | undefined): string {
  if (w.role === 'director') return 'Dirige la oficina. Es un puesto fijo.';
  if (w.role === 'skeptic') return `Está fuera de la cadena de mando: ronda fuera de la oficina y responde a ${esc(boss?.name ?? 'dirección')}. Es un puesto fijo.`;
  return `Responde a ${esc(boss?.name ?? 'dirección')}. Es un puesto fijo.`;
}

type DetailTab = 'tasks' | 'items' | 'style' | 'ai' | 'settings' | 'history';
const ALL_TABS: [DetailTab, string][] = [
  ['tasks', 'Tareas'],
  ['items', 'Inventario'],
  ['style', 'Estilo'],
  ['ai', 'IA'],
  ['settings', 'Ajustes'],
  ['history', 'Historial'],
];
/** Estilo only in the art director's file. */
const tabsOf = (w: Worker | undefined): [DetailTab, string][] => ALL_TABS.filter(([id]) => id !== 'style' || w?.role === 'art');
let detailTab: DetailTab = 'tasks';

/** A new person selected: their panel opens on Tareas. */
export function resetDetailTab(): void {
  detailTab = 'tasks';
}

/** What they need from you: answer right here. Answered ones stay a day, faded. */
function questionsBlock(w: Worker): string {
  const s = getState();
  const mine = s.questions.filter((q) => q.workerId === w.id && (q.answer === null || Date.now() - (q.answeredAt ?? 0) < 86_400_000));
  if (!mine.length) return '';
  return `
    <section class="section needs">
      <h3 class="section-title">Necesita de ti</h3>
      <ul class="needs-list">${mine
        .map((q) => {
          const by = worker(q.byId);
          if (q.answer !== null) {
            return `<li class="need is-answered" data-key="need-${q.id}">
              <p class="need-text">${esc(q.text)}</p>
              <p class="need-answer">${esc(q.answer)}</p>
            </li>`;
          }
          return `<li class="need" data-key="need-${q.id}">
            <p class="meta">${q.kind === 'connector' ? 'Le falta una herramienta o un acceso' : 'Le falta información'}${by ? ` · te lo trae ${esc(by.name)}` : ''}${task(q.taskId) ? ` · «${esc(task(q.taskId)!.title)}» en pausa` : ''} · <span class="num">${stamp(q.at)}</span></p>
            <p class="need-text">${esc(q.text)}</p>
            <form class="need-form" data-answer="${q.id}">
              <label class="sr-only" for="ans-${q.id}">Tu respuesta</label>
              <textarea id="ans-${q.id}" name="answer" rows="2" maxlength="4000" placeholder="Tu respuesta" data-key="ans-${q.id}"></textarea>
              <button class="btn btn-primary btn-sm" type="submit">Responder</button>
            </form>
            ${q.kind === 'connector' ? `<p class="section-note">Si es un conector, añádelo en <button class="link" type="button" data-open-settings="mcp">Ajustes → Conectores</button> y márcalo en su pestaña IA.</p>` : ''}
          </li>`;
        })
        .join('')}</ul>
    </section>`;
}

function tasksPane(w: Worker): string {
  const s = getState();
  const own = task(w.taskId);
  const queue = queueOf(s.tasks, w);
  const ongoing = s.tasks.filter((x) => x.ongoing && x.assigneeId === w.id && x.status !== 'done');
  const backlog = s.tasks
    .filter((x) => x.status === 'backlog' && !x.assigneeId)
    .sort((a, b) => Number(b.role === w.role) - Number(a.role === w.role) || a.createdAt - b.createdAt);
  const options = backlog.map((x) => `<option value="${x.id}">${esc(x.title)}${x.role !== w.role ? ` (${ROLES[x.role].label})` : ''}</option>`).join('');
  // One reason shared by several paused tasks is said once, above them, not on every row.
  const reasons = new Map<string, number>();
  for (const t of ongoing) if (t.status === 'blocked') reasons.set(t.blockReason ?? 'Bloqueada', (reasons.get(t.blockReason ?? 'Bloqueada') ?? 0) + 1);
  const [shared, many] = [...reasons].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  const pausedNote = many > 1 ? `<p class="section-note danger">${many} en pausa: ${esc(shared.replace(/^En pausa:\s*/i, ''))}</p>` : '';
  const why = (t: (typeof ongoing)[number]) => (many > 1 && (t.blockReason ?? 'Bloqueada') === shared ? 'En pausa' : esc(t.blockReason ?? 'Bloqueada'));

  const current = own
    ? `
      <div class="current" style="--role:${ROLES[own.role].color}">
        <div class="current-head">
          <span class="label">Ahora</span>
          <button class="btn btn-icon" type="button" data-edit="${own.id}" data-key="edit-${own.id}" aria-label="Editar tarea">${icon.edit(15)}</button>
        </div>
        <p class="current-title">${esc(own.title)}</p>
        <div class="current-progress">${bar(own.id, own.progress, 'bar-lg')}<span class="num" data-pct="${own.id}">${pct(own.progress)}</span></div>
        <p class="meta">${roleDot(own.role)}${ROLES[own.role].label} · ${own.estimate} h${
          own.status === 'blocked' && own.blockReason ? ` · <span class="danger">${esc(own.blockReason)}</span>` : ''
        }</p>
        ${
          own.notes.length
            ? `<div class="work-note"><p class="meta">Último avance · <span class="num">${stamp(own.notes[own.notes.length - 1].at)}</span></p><p>${esc(own.notes[own.notes.length - 1].text)}</p></div>`
            : w.busyWith
              ? ''
              : `<p class="meta">Aún no ha dejado ningún avance.</p>`
        }
        <div class="current-actions">${
          own.status === 'blocked'
            ? `<button class="btn btn-sm" type="button" data-unblock="${own.id}" data-key="unblock">${icon.check(14)}Desbloquear</button>`
            : `<button class="btn btn-ghost btn-sm" type="button" data-block="${own.id}" data-key="block">${icon.alert(14)}Marcar bloqueo</button>`
        }</div>
      </div>`
    : ongoing.length
      ? `<div class="current current-empty"><p class="current-title">Sin tarea con final ahora mismo</p><p class="meta">Sigue con sus tareas continuas. Escríbele abajo si quieres que haga algo más.</p></div>`
      : `<div class="current current-empty"><p class="current-title">Sin tarea ahora mismo</p><p class="meta">Escríbele abajo qué quieres que haga, o asígnale una pendiente.</p></div>`;

  return `
    ${
      w.needsInterview
        ? `<p class="detail-note">${icon.critique(14)}<span>Pendiente de su bienvenida con ${esc(s.workers.find((o) => o.role === 'interviewer')?.name ?? 'Entrevistas')}, en recepción, en cuanto esté en la oficina.</span></p>`
        : ''
    }
    ${w.profile ? `<p class="brief brief-top">${esc(w.profile.summary)}</p>` : w.brief ? `<p class="brief brief-top">${esc(w.brief)}</p>` : ''}
    ${!isRequired(w) && !deskBySlot(w.desk) ? `<p class="detail-note">${icon.room(14)}<span>Su mesa está por colocar: hazlo en «Editar oficina». Mientras, espera en recepción.</span></p>` : ''}
    ${questionsBlock(w)}
    ${talkBlock(w)}
    ${current}
    ${
      ongoing.length
        ? `<section class="section">
             <h3 class="section-title">Continuas <span class="count">${ongoing.length}</span></h3>
             ${pausedNote}
             <ul class="queue">${ongoing
               .map((t) => {
                 const last = t.notes[t.notes.length - 1];
                 return `<li><button class="queue-row" type="button" data-edit="${t.id}" data-key="on-${t.id}">
                   <span class="queue-title">${icon.ongoing(13)} ${esc(t.title)}</span>
                   <span class="meta">${t.status === 'blocked' ? `<span class="danger">${why(t)}</span>` : last ? `Última entrega <span class="num">${stamp(last.at)}</span> · ${t.notes.length} en total` : 'Sin entregas aún'}</span>
                 </button></li>`;
               })
               .join('')}</ul>
           </section>`
        : ''
    }
    ${
      queue.length
        ? `<section class="section">
             <h3 class="section-title">En cola <span class="count">${queue.length}</span></h3>
             <ol class="queue">${queue
               .map(
                 (t) => `<li><button class="queue-row" type="button" data-edit="${t.id}" data-key="q-${t.id}">
                   <span class="queue-title">${esc(t.title)}</span>
                   <span class="meta">${t.role !== w.role ? `${roleDot(t.role)}${ROLES[t.role].label} · ` : ''}${t.estimate} h</span>
                 </button></li>`,
               )
               .join('')}</ol>
           </section>`
        : ''
    }
    ${
      backlog.length
        ? `<section class="section">
             <h3 class="section-title"><label for="assign-${w.id}">Darle una pendiente</label></h3>
             <form class="inline-form" data-assign="${w.id}">
               <select id="assign-${w.id}" name="task" data-key="assign-select">${options}</select>
               <button class="btn" type="submit" data-key="assign-go">Asignar</button>
             </form>
             <p class="section-note">${own ? 'Está con otra cosa: le quedará en cola.' : 'La empieza ahora.'}</p>
           </section>`
        : ''
    }`;
}

/** Their card: what they do, who they are and what they put first (or the interview's note). */
function profileCard(w: Worker): string {
  const p = w.profile;
  if (!p) {
    return w.brief
      ? `<p class="section-note">De su entrevista: ${esc(w.brief)}</p>`
      : '<p class="section-note">Sin ficha: escríbela para que sepa exactamente qué hacer y cómo.</p>';
  }
  return `
    <div class="profile-card">
      <p class="profile-summary">${esc(p.summary)}</p>
      ${p.persona ? `<p class="profile-persona">${esc(p.persona)}</p>` : ''}
      ${p.focus.length ? `<ul class="profile-focus">${p.focus.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    </div>`;
}

function settingsPane(w: Worker): string {
  const s = getState();
  const boss = worker(w.reportsTo);
  const team = reportsOf(s.workers, w.id);
  const partners = s.workers
    .filter((o) => o.id !== w.id && (!o.pairWith || o.id === w.pairWith))
    .map((o) => `<option value="${o.id}" ${o.id === w.pairWith ? 'selected' : ''}>${esc(o.name)} · ${esc(o.title)}</option>`)
    .join('');
  return `
    <div class="detail-switch">
      <button class="work" type="button" role="switch" aria-checked="${w.enabled}" data-enabled="${w.id}" data-key="enabled">
        <span class="work-track" aria-hidden="true"></span>
        <span class="work-label">Viene a trabajar</span>
      </button>
      <p class="section-note">${w.enabled ? 'Entra cuando la oficina está abierta.' : 'Se queda en casa aunque la oficina esté abierta. El resto sigue igual.'}</p>
    </div>
    <section class="section">
      <h3 class="section-title"><label for="boss-${w.id}">Responde a</label></h3>
      ${isRequired(w) ? `<p class="section-note">${fixedPlace(w, boss)}</p>` : `<select id="boss-${w.id}" data-boss="${w.id}" data-key="boss-select">${bossOptions(w)}</select>`}
      ${team.length ? `<p class="section-note">Supervisa a ${team.map((t) => esc(t.name)).join(', ')}.</p>` : ''}
    </section>
    <section class="section">
      <h3 class="section-title"><label for="pair-${w.id}">Colabora con</label></h3>
      <select id="pair-${w.id}" data-pair="${w.id}" data-key="pair-select">
        <option value="">Nadie, trabaja en su mesa</option>
        ${partners}
      </select>
      <p class="section-note">Se sienta en la mesa de esa persona para trabajar juntos.</p>
    </section>
    <section class="section">
      <h3 class="section-title">Persona</h3>
      ${profileCard(w)}
      <div class="actions">
        <button class="btn" type="button" data-edit-worker="${w.id}" data-key="edit-worker">${icon.edit(15)}${isRequired(w) ? 'Nombre, puesto y perfil' : w.profile ? 'Editar su ficha' : 'Nombre, puesto y ficha'}</button>
        <button class="btn" type="button" data-look-edit="${w.id}" data-key="look">${icon.shirt(15)}Aspecto</button>
        ${
          w.role === 'skeptic'
            ? `<button class="btn" type="button" data-call-skeptic data-key="call-skeptic" ${s.working && w.enabled ? '' : 'disabled'}>${icon.critique(15)}Que entre a hablar con dirección</button>`
            : ''
        }
      </div>
    </section>
    ${pastChats(w)}
    ${
      isRequired(w)
        ? ''
        : `<section class="section">
            <button class="btn btn-ghost btn-danger-text" type="button" data-remove="${w.id}" data-key="remove">${icon.trash(15)}Quitar de la oficina</button>
          </section>`
    }`;
}

/** Chats you restarted from: kept here to reread (their AI no longer sees them). */
function pastChats(w: Worker): string {
  const past = w.chat?.archive ?? [];
  if (!past.length) return '';
  const said = (l: { speaker: string; text: string; files?: unknown[]; images?: unknown[] }) =>
    l.text || (l.files?.length ? `(${l.files.length} archivo${l.files.length > 1 ? 's' : ''})` : l.images?.length ? `(${l.images.length} imagen${l.images.length > 1 ? 'es' : ''})` : '');
  return `
    <section class="section">
      <h3 class="section-title">Chats anteriores <span class="count">${past.length}</span></h3>
      <ul class="past-chats">
        ${past
          .map((a) => {
            const first = a.lines.find((l) => l.speaker === 'owner');
            return `
          <li>
            <details class="past-chat" data-key="pc-${a.at}">
              <summary>
                <span class="past-chat-main">
                  <span class="past-chat-title">${esc(first ? said(first).slice(0, 70) : 'Chat')}</span>
                  <span class="meta"><span class="num">${stamp(a.lines[0]?.at ?? a.at)}</span> · ${a.lines.length} mensaje${a.lines.length === 1 ? '' : 's'}</span>
                </span>
                <span class="past-chat-caret" aria-hidden="true">${icon.chevron(14)}</span>
              </summary>
              <ol class="past-chat-lines">
                ${a.lines
                  .map((l) => `<li class="${l.speaker === 'owner' ? 'is-owner' : ''}"><span class="past-chat-who">${l.speaker === 'owner' ? 'Tú' : esc(w.name)}</span><span>${esc(said(l))}</span></li>`)
                  .join('')}
              </ol>
              <button class="btn btn-ghost btn-sm btn-danger-text" type="button" data-chat-forget="${w.id}" data-at="${a.at}">${icon.trash(13)}Borrar este chat</button>
            </details>
          </li>`;
          })
          .join('')}
      </ul>
    </section>`;
}

function historyPane(w: Worker): string {
  const s = getState();
  const talks = s.conversations.filter((c) => c.a === w.id || c.b === w.id).slice(0, 12);
  const done = s.tasks
    .filter((x) => x.status === 'done' && x.assigneeId === w.id)
    .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
    .slice(0, 8);
  const events = s.feed.filter((e) => e.workerId === w.id).slice(0, 12);
  const nameOf = (id: string) => worker(id)?.name ?? 'alguien';
  return `
    <section class="section first">
      <h3 class="section-title">Conversaciones</h3>
      ${
        talks.length
          ? `<ul class="talk-list">${talks
              .map((c) => {
                const other = c.a === w.id ? c.b : c.a;
                return `<li><button type="button" class="talk-row${c.endedAt === null ? ' is-live' : ''}" data-open-talk="${c.id}" data-key="h-${c.id}">
                  <span class="talk-pair"><span class="talk-dot" style="--role:${ROLES[worker(other)?.role ?? 'dev'].color}">${esc(nameOf(other).charAt(0))}</span></span>
                  <span class="talk-main">
                    <span class="talk-names">Con ${esc(nameOf(other))}</span>
                    <span class="talk-preview">${esc(c.conclusion ?? c.error ?? c.lines[c.lines.length - 1]?.text ?? 'Empezando…')}</span>
                  </span>
                  <span class="num muted">${stamp(c.endedAt ?? c.startedAt)}</span>
                </button></li>`;
              })
              .join('')}</ul>`
          : `<p class="section-note">Todavía no ha hablado con nadie.</p>`
      }
    </section>
    <section class="section">
      <h3 class="section-title">Tareas terminadas</h3>
      ${
        done.length
          ? `<ul class="history">${done.map((x) => `<li>${icon.check(14)}<span>${esc(x.title)}</span><span class="num muted">${stamp(x.doneAt!)}</span></li>`).join('')}</ul>`
          : `<p class="section-note">Todavía no ha cerrado ninguna tarea.</p>`
      }
    </section>
    ${
      events.length
        ? `<section class="section">
             <h3 class="section-title">Actividad</h3>
             <ul class="feed feed-compact">${events
               .map((e) => `<li><span class="feed-icon feed-${e.kind}">${feedIcon(e.kind, 13)}</span><span>${esc(e.text)}</span><span class="num muted">${stamp(e.t)}</span></li>`)
               .join('')}</ul>
           </section>`
        : ''
    }`;
}

function renderDetail(w: Worker): string {
  const partner = worker(w.pairWith);
  const role = ROLES[w.role];
  const open = getState().questions.filter((q) => q.workerId === w.id && q.answer === null).length;
  const toReview = getState().items.filter((i) => i.status === 'review' && i.holder === w.id).length;
  if (detailTab === 'style' && w.role !== 'art') detailTab = 'tasks';
  const pane =
    detailTab === 'items' ? inventoryPane(w) : detailTab === 'ai' ? aiSection(w) : detailTab === 'settings' ? settingsPane(w) : detailTab === 'history' ? historyPane(w) : detailTab === 'style' ? stylePane(w) : tasksPane(w);
  return `
    <div class="worker" style="--role:${role.color}">
      <header class="worker-head">
        <button class="btn btn-ghost back" type="button" data-back data-key="back">${icon.back(16)}Equipo</button>
        <div class="detail-head">
          ${initial(w, 'avatar-lg')}
          <div class="detail-who">
            <h2 class="detail-name">${esc(w.name)}</h2>
            <p class="detail-title">${esc(w.title)} · ${roleDot(w.role)}${role.label}</p>
          </div>
        </div>
        <div class="detail-status">
          ${statusPill(w)}
          ${partner ? `<span class="muted">con ${esc(partner.name)}</span>` : ''}
        </div>
        <div class="worker-tabs" role="tablist" aria-label="${esc(w.name)}">
          ${tabsOf(w).map(
            ([id, label]) =>
              `<button role="tab" type="button" data-detail-tab="${id}" aria-selected="${detailTab === id}" ${detailTab === id ? '' : 'tabindex="-1"'} data-key="dt-${id}">${label}${
                id === 'tasks' && open ? ` <span class="count is-alert">${open}</span>` : id === 'items' && toReview ? ` <span class="count">${toReview}</span>` : ''
              }</button>`,
          ).join('')}
        </div>
      </header>
      <div class="worker-body" role="tabpanel">${pane}</div>
    </div>`;
}

// ---------------------------------------------------------------- activity

/** The office's log opens over the chart, like a person does; «Equipo» brings the chart back. */
let activityOpen = false;
export const activityShown = () => activityOpen && !getSelectedId();

function setActivity(open: boolean): void {
  activityOpen = open;
  document.dispatchEvent(new CustomEvent('panel-change'));
}

/** Who the project could use next: opens «Añadir agente» with the suggestions on top. */
function ideasButton(): string {
  const st = getState();
  const h = st.hireIdeas;
  const proposed = st.inbox.filter((m) => !m.closed && m.action?.type === 'hire').length;
  const titles = h.items.map((i) => i.title);
  const head = headOf(st.workers);
  const meta =
    h.status === 'asked' || h.status === 'thinking'
      ? `${head?.name ?? 'Dirección'} lo está pensando…`
      : proposed
        ? `${proposed} propuesta${proposed > 1 ? 's' : ''} del equipo${titles.length ? ` · ${titles.join(', ')}` : ''}`
        : titles.length
          ? titles.join(', ')
          : `${head?.name ?? 'Dirección'} te dice qué perfiles le faltan al equipo`;
  return `
    <button class="activity-btn" type="button" data-add data-key="open-ideas">
      <span class="activity-btn-icon">${icon.idea(16)}</span>
      <span class="activity-btn-main">
        <span class="activity-btn-title">Sugeridos para tu proyecto</span>
        <span class="meta">${esc(meta)}</span>
      </span>
      ${icon.next(16)}
    </button>`;
}

function activityButton(): string {
  const last = getState().feed[0];
  return `
    <button class="activity-btn" type="button" data-open-activity data-key="open-activity">
      <span class="activity-btn-icon">${icon.history(16)}</span>
      <span class="activity-btn-main">
        <span class="activity-btn-title">Actividad</span>
        <span class="meta">${last ? `${esc(last.text)}` : 'Todo lo que pasa en la oficina'}</span>
      </span>
      ${icon.next(16)}
    </button>`;
}

function renderActivity(): string {
  return `
    <div class="worker">
      <header class="worker-head">
        <button class="btn btn-ghost back" type="button" data-close-activity data-key="back-activity">${icon.back(16)}Equipo</button>
        <h2 class="activity-title">Actividad</h2>
        <p class="section-note">Todo lo que pasa en la oficina, lo último arriba. Pulsa a alguien para ver su ficha.</p>
      </header>
      <div class="worker-body">${renderFeed()}</div>
    </div>`;
}

export function renderTeam(): string {
  const w = worker(getSelectedId());
  if (w) return renderDetail(w);
  return activityOpen ? renderActivity() : `${renderChart()}${ideasButton()}${activityButton()}`;
}

function confirmRemove(w: Worker): void {
  const d = document.getElementById('confirm-dialog') as HTMLDialogElement;
  const team = reportsOf(getState().workers, w.id);
  const boss = worker(w.reportsTo);
  const moves = team.length ? ` Su equipo pasa a responder a ${esc(boss?.name ?? 'su jefe')}.` : '';
  d.innerHTML = `
    <form method="dialog" class="dialog-form">
      <header class="dialog-head"><h2>¿Quitar a ${esc(w.name)} de la oficina?</h2></header>
      <p>Sus tareas vuelven a pendientes.${moves}</p>
      <footer class="dialog-foot">
        <button class="btn btn-ghost" value="cancel" autofocus>Cancelar</button>
        <button class="btn btn-danger" value="remove">Quitar</button>
      </footer>
    </form>`;
  d.onclose = () => {
    if (d.returnValue !== 'remove') return;
    select(null);
    removeWorker(w.id);
  };
  d.showModal();
}

export function bindTeam(el: HTMLElement, rerender: () => void): void {
  bindKeyFields(el, rerender);
  bindStyle(() => detailTab === 'style' && rerender());
  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (detailTab === 'style' && styleClick(target)) return;
    const talk = target.closest<HTMLElement>('[data-open-talk]');
    if (talk) return document.dispatchEvent(new CustomEvent('open-conversation', { detail: talk.dataset.openTalk }));
    const os = target.closest<HTMLElement>('[data-open-settings]');
    if (os) return openSettingsAt(os.dataset.openSettings as 'ai' | 'mcp');
    if (target.closest('[data-add]')) return openWorkerDialog(null);
    if (target.closest('[data-templates]')) return openTemplateDialog();
    if (target.closest('[data-call-skeptic]')) return callSkeptic();
    const sel = target.closest<HTMLElement>('[data-select]');
    if (sel) return select(sel.dataset.select!);
    if (target.closest('[data-back]')) return select(null);
    if (target.closest('[data-open-activity]')) return setActivity(true);
    if (target.closest('[data-close-activity]')) return setActivity(false);
    const who = target.closest<HTMLElement>('[data-who]');
    if (who) return select(who.dataset.who!);
    const dt = target.closest<HTMLElement>('[data-detail-tab]');
    if (dt) {
      detailTab = dt.dataset.detailTab as DetailTab;
      rerender();
      el.querySelector<HTMLElement>(`[data-detail-tab="${detailTab}"]`)?.focus();
      return;
    }
    const ew = target.closest<HTMLElement>('[data-edit-worker]');
    if (ew) return openWorkerDialog(ew.dataset.editWorker!);
    const edit = target.closest<HTMLElement>('[data-edit]');
    if (edit) return openTaskDialog(edit.dataset.edit!);
    const un = target.closest<HTMLElement>('[data-unblock]');
    if (un) return setStatus(un.dataset.unblock!, 'doing');
    const en = target.closest<HTMLElement>('[data-enabled]');
    if (en) return setEnabled(en.dataset.enabled!, en.getAttribute('aria-checked') !== 'true');
    const bl = target.closest<HTMLElement>('[data-block]');
    if (bl) return setStatus(bl.dataset.block!, 'blocked');
    const lk = target.closest<HTMLElement>('[data-look-edit]');
    if (lk) return openLookEditor(lk.dataset.lookEdit!);
    const forget = target.closest<HTMLElement>('[data-chat-forget]');
    if (forget) return deleteChatArchive(forget.dataset.chatForget!, Number(forget.dataset.at));
    const rm = target.closest<HTMLElement>('[data-remove]');
    if (rm) {
      const w = worker(rm.dataset.remove!);
      if (w) confirmRemove(w);
    }
  });
  el.addEventListener('submit', (e) => {
    const t = e.target as HTMLElement;
    const ans =t.closest<HTMLFormElement>('[data-answer]');
    if (ans) {
      e.preventDefault();
      const text = String(new FormData(ans).get('answer') ?? '').trim();
      if (text) answerQuestion(ans.dataset.answer!, text);
      ans.querySelector<HTMLTextAreaElement>('textarea')?.blur();
      return;
    }
    const form = t.closest<HTMLFormElement>('[data-assign]');
    if (!form) return;
    e.preventDefault();
    const id = new FormData(form).get('task');
    if (typeof id === 'string' && id) assignTask(id, form.dataset.assign!);
  });
  // Arrow keys move between the person's tabs.
  el.addEventListener('keydown', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-detail-tab]');
    if (!tab || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
    const ids = tabsOf(worker(getSelectedId())).map(([id]) => id);
    detailTab = ids[(ids.indexOf(tab.dataset.detailTab as DetailTab) + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
    rerender();
    el.querySelector<HTMLElement>(`[data-detail-tab="${detailTab}"]`)?.focus();
    e.preventDefault();
  });
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (styleChange(t)) return;
    const pair = t.closest<HTMLSelectElement>('[data-pair]');
    if (pair) {
      setPair(pair.dataset.pair!, pair.value || null);
      pair.blur();
    }
    const key = t.closest<HTMLSelectElement>('[data-ai-key]');
    if (key) return setWorkerAi(key.dataset.aiKey!, { sharedKey: key.value === 'shared' });
    // A different provider: their model choice belonged to the old one.
    const provider = t.closest<HTMLSelectElement>('[data-ai-provider]');
    if (provider) return setWorkerAi(provider.dataset.aiProvider!, { provider: (provider.value || null) as TextProvider | null, model: null });
    const model = t.closest<HTMLInputElement | HTMLSelectElement>('[data-ai-model]');
    if (model) {
      const v = model.value.trim();
      if (v && !/^[\w.:/-]{1,80}$/.test(v)) return;
      return setWorkerAi(model.dataset.aiModel!, { model: v || null });
    }
    const mcp = t.closest<HTMLInputElement>('[data-ai-mcp]');
    if (mcp) {
      const w = worker(getSelectedId());
      if (!w) return;
      const set = new Set(w.ai.mcps);
      if (mcp.checked) set.add(mcp.dataset.aiMcp!);
      else set.delete(mcp.dataset.aiMcp!);
      return setWorkerAi(w.id, { mcps: [...set] });
    }
    const boss = t.closest<HTMLSelectElement>('[data-boss]');
    if (boss) {
      setBoss(boss.dataset.boss!, boss.value);
      boss.blur();
    }
  });

  // Drag a card onto another: that person becomes the boss.
  let dragged: string | null = null;
  const target = (e: DragEvent) => (e.target as HTMLElement).closest<HTMLElement>('[data-drag]');
  const clear = () => el.querySelectorAll('.is-drop-ok, .is-drop-no').forEach((n) => n.classList.remove('is-drop-ok', 'is-drop-no'));
  el.addEventListener('dragstart', (e) => {
    const c = target(e);
    if (!c) return;
    dragged = c.dataset.drag!;
    e.dataTransfer!.setData('text/plain', dragged);
    e.dataTransfer!.effectAllowed = 'move';
    c.classList.add('is-dragging');
  });
  el.addEventListener('dragover', (e) => {
    const c = target(e);
    if (!c || !dragged || c.dataset.drag === dragged) return;
    const w = worker(dragged);
    const ok = !!w && !isRequired(w) && !bossProblem(getState().workers, dragged, c.dataset.drag!);
    clear();
    c.classList.add(ok ? 'is-drop-ok' : 'is-drop-no');
    if (ok) {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
    }
  });
  el.addEventListener('dragleave', (e) => target(e)?.classList.remove('is-drop-ok', 'is-drop-no'));
  el.addEventListener('drop', (e) => {
    const c = target(e);
    e.preventDefault();
    clear();
    if (c && dragged && c.dataset.drag !== dragged) setBoss(dragged, c.dataset.drag!);
  });
  el.addEventListener('dragend', () => {
    dragged = null;
    clear();
    el.querySelectorAll('.is-dragging').forEach((n) => n.classList.remove('is-dragging'));
  });
}
