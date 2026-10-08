import { ROLES } from '../sim/seed';
import { clearConversations, getState, select, worker } from '../sim/store';
import type { Conversation, ConversationKind } from '../sim/types';
import { esc, stamp } from './dom';
import { linkDossier } from './dossier';
import { openSettingsAt } from './config';
import { icon } from './icons';

const KIND: Record<ConversationKind, string> = {
  interview: 'Entrevista',
  checkin: 'Seguimiento',
  critique: 'Crítica',
  colleagues: 'Entre compañeros',
  direction: 'Con dirección',
  handoff: 'Tu mensaje',
  ask: 'Te necesita',
};

/** The conversation open in the panel (null: the list). */
let openId: string | null = null;

export function openConversation(id: string | null): void {
  openId = id;
}

const who = (id: string) => worker(id);
const nameOf = (id: string) => who(id)?.name ?? 'Alguien que ya no está';
const dot = (id: string) => {
  const w = who(id);
  return `<span class="talk-dot" style="--role:${w ? ROLES[w.role].color : '#999'}">${esc((w?.name ?? '?').charAt(0))}</span>`;
};

function status(): string {
  const ai = getState().ai;
  const fmt = (n: number) => n.toLocaleString('es-ES');
  if (ai.state === 'off') {
    return `<p class="talk-status is-off">${esc(ai.note || 'Sin IA configurada')}. <button class="link" type="button" data-open-settings="ai">Configurar la IA</button></p>`;
  }
  const spent = ai.limit ? `<span class="num">${fmt(ai.tokensToday)}</span> de <span class="num">${fmt(ai.limit)}</span> tokens hoy` : `<span class="num">${fmt(ai.tokensToday)}</span> tokens hoy, sin tope`;
  if (ai.state === 'paused') return `<p class="talk-status is-paused">${esc(ai.note)} · ${spent}</p>`;
  return `<p class="talk-status"><span class="live-dot" aria-hidden="true"></span>IA activa · ${spent}</p>`;
}

function preview(c: Conversation): string {
  if (c.thinking) return `${esc(nameOf(c.thinking.who))} ${esc(c.thinking.tool ?? 'está pensando')}…`;
  if (c.endedAt !== null) return esc(c.conclusion ?? c.error ?? 'Sin conclusión');
  const last = c.lines[c.lines.length - 1];
  return last ? `${esc(nameOf(last.speaker))}: ${esc(last.text)}` : 'Se están juntando…';
}

function row(c: Conversation): string {
  return `
    <li>
      <button type="button" class="talk-row${c.endedAt === null ? ' is-live' : ''}" data-talk="${c.id}" data-key="talk-${c.id}">
        <span class="talk-pair">${dot(c.a)}${dot(c.b)}</span>
        <span class="talk-main">
          <span class="talk-names">${esc(nameOf(c.a))} y ${esc(nameOf(c.b))}<span class="meta"> · ${KIND[c.kind]}</span></span>
          <span class="talk-preview">${preview(c)}</span>
        </span>
        <span class="num muted">${stamp(c.endedAt ?? c.startedAt)}</span>
      </button>
    </li>`;
}

/** Two-step delete: the first click asks, the second does it. */
let confirmClear = false;

function list(): string {
  const all = getState().conversations;
  const live = all.filter((c) => c.endedAt === null);
  const ended = all.filter((c) => c.endedAt !== null);
  return `
    ${status()}
    ${
      all.length
        ? `<div class="talk-tools">
             <button class="btn btn-sm" type="button" data-talk-export data-key="talk-export">${icon.download(14)}Exportar</button>
             ${
               ended.length
                 ? confirmClear
                   ? `<button class="btn btn-sm btn-danger" type="button" data-talk-clear="yes" data-key="talk-clear">Borrar ${ended.length} terminadas</button>
                      <button class="btn btn-ghost btn-sm" type="button" data-talk-clear="no" data-key="talk-clear-no">Cancelar</button>`
                   : `<button class="btn btn-ghost btn-sm" type="button" data-talk-clear="ask" data-key="talk-clear">${icon.trash(14)}Borrar terminadas</button>`
                 : ''
             }
           </div>`
        : ''
    }
    <section class="section">
      <h3 class="section-title">En curso <span class="count">${live.length}</span></h3>
      ${live.length ? `<ul class="talk-list">${live.map(row).join('')}</ul>` : `<p class="section-note">${getState().working ? 'Ahora mismo nadie está hablando. Las conversaciones empiezan solas cada poco.' : 'La oficina está cerrada: nadie conversa hasta que pulses Trabajar.'}</p>`}
    </section>
    ${
      ended.length
        ? `<section class="section">
             <h3 class="section-title">Recientes</h3>
             <ul class="talk-list">${ended.map(row).join('')}</ul>
           </section>`
        : ''
    }`;
}

function detail(c: Conversation): string {
  const think = c.thinking;
  return `
    <button class="btn btn-ghost back" type="button" data-talk-back>${icon.back(16)}Conversaciones</button>
    <header class="talk-head">
      <span class="talk-pair">${dot(c.a)}${dot(c.b)}</span>
      <div>
        <h2 class="talk-title">${esc(nameOf(c.a))} y ${esc(nameOf(c.b))}</h2>
        <p class="meta">${KIND[c.kind]} · ${c.endedAt === null ? '<span class="live-dot" aria-hidden="true"></span>en curso' : `terminó a las ${stamp(c.endedAt)}`}</p>
      </div>
    </header>
    <p class="section-note">${esc(c.topic)}</p>
    <ol class="chat" aria-live="polite">
      ${c.lines
        .map(
          (l) => `
          <li class="chat-line ${l.speaker === c.a ? 'is-a' : 'is-b'}" data-key="line-${c.id}-${l.at}">
            ${dot(l.speaker)}
            <div class="chat-body">
              <p class="chat-who"><button class="link" type="button" data-who="${l.speaker}">${esc(nameOf(l.speaker))}</button> <span class="num muted">${stamp(l.at)}</span></p>
              ${l.tools.length ? `<ul class="chat-tools">${l.tools.map((t) => `<li>${linkDossier(esc(t.note))}</li>`).join('')}</ul>` : ''}
              <p class="chat-text">${linkDossier(esc(l.text))}</p>
            </div>
          </li>`,
        )
        .join('')}
      ${
        think
          ? `<li class="chat-line is-thinking ${think.who === c.a ? 'is-a' : 'is-b'}">
               ${dot(think.who)}
               <div class="chat-body"><p class="chat-text"><span class="typing" aria-hidden="true"><i></i><i></i><i></i></span> ${esc(nameOf(think.who))} ${esc(think.tool ?? 'está pensando')}</p></div>
             </li>`
          : ''
      }
    </ol>
    ${c.conclusion ? `<section class="talk-outcome"><h3 class="section-title">Conclusión</h3><p>${esc(c.conclusion)}</p></section>` : ''}
    ${c.error ? `<p class="talk-status is-paused">Se cortó: ${esc(c.error)}</p>` : ''}`;
}

export function renderTalks(): string {
  const c = openId ? getState().conversations.find((x) => x.id === openId) : undefined;
  return c ? detail(c) : list();
}

export function bindTalks(el: HTMLElement, rerender: () => void, showTeam: () => void): void {
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const open = t.closest<HTMLElement>('[data-talk]');
    if (open) {
      openId = open.dataset.talk!;
      return rerender();
    }
    if (t.closest('[data-talk-export]')) return exportTalks();
    const clear = t.closest<HTMLElement>('[data-talk-clear]');
    if (clear) {
      if (clear.dataset.talkClear === 'yes') clearConversations();
      confirmClear = clear.dataset.talkClear === 'ask';
      return rerender();
    }
    if (t.closest('[data-talk-back]')) {
      openId = null;
      return rerender();
    }
    const os = t.closest<HTMLElement>('[data-open-settings]');
    if (os) return openSettingsAt('ai');
    const person = t.closest<HTMLElement>('[data-who]');
    if (person) {
      select(person.dataset.who!);
      showTeam();
    }
  });
}

// ---------------------------------------------------------------- export

const clock = (ms: number) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const minutes = (ms: number) => `${(ms / 60_000).toFixed(1)} min`;

/** Everything said, with times, as a Markdown file: for reading through and analysing. */
function exportTalks(): void {
  const s = getState();
  const now = Date.now();
  const all = [...s.conversations].sort((a, b) => a.startedAt - b.startedAt);
  const length = (c: Conversation) => (c.endedAt ?? now) - c.startedAt;
  const total = all.reduce((n, c) => n + length(c), 0);
  const lines = all.reduce((n, c) => n + c.lines.length, 0);
  const tools = all.reduce((n, c) => n + c.lines.reduce((k, l) => k + l.tools.length, 0), 0);
  const byKind = new Map<string, number>();
  for (const c of all) byKind.set(KIND[c.kind], (byKind.get(KIND[c.kind]) ?? 0) + 1);
  const md = [
    `# Conversaciones de ${s.agency || 'la oficina'}`,
    '',
    `Exportado el ${new Date(now).toLocaleString('es-ES')}. Producto: ${s.project || '(sin definir)'}.`,
    '',
    '## Resumen',
    '',
    `- Conversaciones: ${all.length} (${all.filter((c) => c.endedAt === null).length} en curso)`,
    `- Tiempo total conversando: ${minutes(total)}; media por conversación: ${minutes(all.length ? total / all.length : 0)}`,
    `- Intervenciones: ${lines}; media por conversación: ${all.length ? (lines / all.length).toFixed(1) : 0}`,
    `- Usos de herramientas: ${tools}`,
    `- Terminadas con conclusión: ${all.filter((c) => c.conclusion).length}; cortadas: ${all.filter((c) => c.error).length}`,
    `- Por tipo: ${[...byKind].map(([k, n]) => `${k} ${n}`).join(', ') || '—'}`,
    `- Tokens hoy: ${s.ai.tokensToday.toLocaleString('es-ES')}${s.ai.limit ? ` de ${s.ai.limit.toLocaleString('es-ES')}` : ' (sin tope)'}`,
    `- Tareas: ${s.tasks.length} (${s.tasks.filter((t) => t.status === 'done').length} hechas, ${s.tasks.filter((t) => t.status === 'blocked').length} bloqueadas)`,
    '',
    ...all.flatMap((c) => [
      `## ${nameOf(c.a)} y ${nameOf(c.b)} · ${KIND[c.kind]}`,
      '',
      `${clock(c.startedAt)} → ${c.endedAt ? clock(c.endedAt) : 'en curso'} · ${minutes(length(c))} · ${c.lines.length} intervenciones`,
      '',
      `> ${c.topic}`,
      '',
      ...c.lines.map((l, i) => {
        const gap = i ? ` (+${Math.round((l.at - c.lines[i - 1].at) / 1000)} s)` : ` (+${Math.round((l.at - c.startedAt) / 1000)} s desde el inicio)`;
        const used = l.tools.length ? `  \n  _Herramientas: ${l.tools.map((t) => t.note).join('; ')}_` : '';
        return `- **${nameOf(l.speaker)}** ${clock(l.at)}${gap}: ${l.text}${used}`;
      }),
      '',
      c.conclusion ? `**Conclusión:** ${c.conclusion}` : c.error ? `**Se cortó:** ${c.error}` : '',
      '',
    ]),
  ].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
  const stamp = new Date(now).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  a.download = `conversaciones-${stamp}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
