/**
 * Meetings with you, around the meeting table: the head and the second row of the chart
 * (or, the very first time, the head and Entrevistas). You speak from the panel; each of them
 * answers with their own AI, asks what's missing and writes it into the project's dossier.
 * Closing it, the head writes the minutes and the office gets back to work with what it learned.
 */
import { PLAIN } from './plain';
import { assignTask, deleteTask, getState, log, notify, refreshActivities, worker } from '../src/sim/ops';
import type { BriefAspect, Meeting, MeetingLine, ToolUse, Worker } from '../src/sim/types';
import { addTask, brainOf, forOwner, remember, spend, systemFor, terse, toolLabel, tidy, toolsFor, useTool, waitForProvider } from './agents';
import { ROLES } from '../src/sim/seed';
import { aboutTopic, BRIEF_ASPECTS, roots, troubleFacts } from './health';
import { LlmError, think, type ToolSpec } from './llm';
import { redact } from './vault';
import { linksIn, readOwnerLinks } from './web';

/** Walking to the table before anyone speaks. */
const GATHER_MS = 14_000;
const KEEP = 12;

let busy = false;
let waitUntil = 0;

export function meetingTick(publish: () => void, canThink: boolean): void {
  const st = getState();
  const m = st.meeting;
  if (!m && settleDue && !busy && canThink && Date.now() >= waitUntil) void settleQuestions(publish);
  if (!m || busy || Date.now() < waitUntil) return;
  if (!st.working) {
    // Everyone went home: whatever was said stays in the minutes.
    m.status = 'closing';
  }
  if (m.status === 'gathering' && Date.now() - m.startedAt > GATHER_MS) {
    m.status = 'live';
    m.waitingFor = 'agents';
    notify('change');
  }
  if (m.status === 'live' && m.waitingFor === 'agents' && canThink) void answer(m, publish);
  else if (m.status === 'closing') void close(m, publish, canThink);
}

const people = (m: Meeting) => m.participants.map((id) => worker(id)).filter((w): w is Worker => !!w);
const nameOf = (id: string) => (id === 'owner' ? 'Tú (propietario)' : (worker(id)?.name ?? '¿?'));

/** The head first, then the rest in chart order. */
const byRank = (m: Meeting) => people(m).sort((a, b) => Number(b.role === 'director') - Number(a.role === 'director'));

/**
 * Listening to you, after each thing you say: they take down in the dossier what it made clear
 * (so the project's health moves while you talk, not only at the end), what you've ruled on
 * and what you keep for yourself (so nobody asks about it again), read any web you passed, and,
 * one voice at a time, settle who answers: whoever you named, or the one they agree on.
 */
async function listen(m: Meeting, publish: () => void): Promise<{ order: Worker[]; notes: ToolUse[]; web: string; task: string | null }> {
  const all = byRank(m);
  const last = m.lines[m.lines.length - 1];
  const lead = all[0];
  if (!last || last.speaker !== 'owner' || !lead) return { order: all, notes: [], web: '', task: null };
  // Two messages in a row are one turn: «¿qué acabo de decir?» + «¿todo claro?».
  const turn = ownerTurn(m);
  // «oscar» is Óscar: names are matched without accents, as whole words.
  const named = all.find((w) => ` ${norm(turn)} `.includes(` ${norm(w.name)} `));
  const tone = toneOf(turn);
  const notes: ToolUse[] = [];
  // A web you passed: read before anyone answers.
  let web = '';
  if (linksIn(turn).length) {
    m.thinking = { who: lead.id, tool: 'leyendo la web que has pasado' };
    notify('change');
    publish();
    web = await readOwnerLinks(turn);
    const read = (getState().brief.links ?? []).filter((l) => linksIn(turn).includes(l.url));
    if (read.length) notes.push({ name: 'leer_web', note: `leyó ${read.map((l) => new URL(l.url).hostname).join(' y ')}` });
  }
  // A doubt or a complaint is answered by whoever said the thing.
  const asked = worker([...m.lines].reverse().find((l) => l.speaker !== 'owner')?.speaker ?? '');
  const forced = !named && asked && (tone === 'complaint' || tone === 'confused') ? asked : named;
  const choose = !forced && all.length > 1;
  const orderFor = (first: Worker | undefined) => (first ? [first, ...all.filter((w) => w !== first)] : all);
  const brain = brainOf(lead);
  if (typeof brain === 'string') return { order: orderFor(forced), notes, web, task: null };
  const others = all.filter((w) => w !== lead);
  m.thinking = { who: lead.id, tool: choose ? `lo habla con ${andList(others.map((w) => w.name))}` : 'apuntando lo que has dicho' };
  notify('change');
  publish();
  const known = briefText();
  const out = await think(
    brain,
    `Reunión con el propietario. Presentes: ${all.map((w) => `${w.name} (${w.title}: ${ROLES[w.role].about})`).join('; ')}.${choose ? ' Solo habla una persona por turno.' : ''}`,
    [
      'Lo último:',
      m.lines.slice(-4).map((l) => `${nameOf(l.speaker)}: ${l.text}`).join('\n'),
      '',
      `Dossier actual:\n${known || '(vacío)'}`,
      rulingsText(),
      '',
      `Del ÚLTIMO mensaje del propietario («${turn.slice(0, 2400)}»):`,
      `1. "dossier": lo que dice del producto. Aspectos: ${BRIEF_ASPECTS.map((a) => `${a.id} (${a.label.toLowerCase()})`).join(', ')}. Todos los aspectos de los que habla (un mensaje largo suele tocar varios; uno corto, 0-2), aunque no responda a lo preguntado. Lo que dijo el equipo solo cuenta si él lo acepta en ese mensaje. Por aspecto: texto completo actualizado (lo que ya había + lo nuevo), ${terse() ? 'telegráfico, ' : ''}datos exactos; certeza 0-1 (0.9 claro y completo, 0.5 a medias). Nada inventado, nada de preguntas.`,
      '2. "decisiones": instrucciones firmes sobre cómo trabajar que da en ESE mensaje (quién hace qué, ritmo, qué no tocar, qué no volver a preguntar), en frases cortas impersonales, p. ej. «Sin fechas fijas: ritmo diario», «El equipo se centra en marketing y creación de mockups», «Uno crea los mockups y otro los revisa con las referencias visuales del propietario». Solo nuevas (no repitas las que ya están). [] si no hay.',
      '3. "suyo": temas que dice expresamente que hace él mismo, 1-3 palabras en español sacadas de su mensaje (p. ej. "indexación", "validación de pagos"). Decidir el ritmo o avisar de algo NO es «suyo». [] si no hay.',
      '3b. "puestos": perfiles que dice que quiere en el equipo, con lo que harán (p. ej. "Director de arte: supervisa los mockups generados y los compara con las referencias"). [] si no habla del equipo.',
      '4. "encargos": lo que manda hacer a alguien del equipo en ESE mensaje, como tarea concreta con sus datos (p. ej. {"quien": "Óscar", "tarea": "Buscar la forma más barata de generar 10-30 mockups al día con 20 €/mes"}). "quien" vacío si no nombra a nadie. [] si no manda nada.',
      '5. "cerrado": temas que ya ha respondido o zanjado en la reunión y no se le vuelven a preguntar, 1-2 palabras cada uno, con los sinónimos que usaría el equipo (p. ej. "fechas", "plazo", "presupuesto", "precio por mockup", "frecuencia"). [] si no hay.',
      choose ? '6. "habla": quién le responde: a quien le toca por su puesto o quien más aporta.' : '',
      `Responde SOLO JSON: {"dossier": {"para_quien": {"texto": "…", "certeza": 0.8}}, "decisiones": [], "suyo": [], "encargos": [], "cerrado": [], "puestos": []${choose ? ', "habla": "Nombre"' : ''}}`,
    ]
      .filter(Boolean)
      .join('\n'),
    [],
    async () => '',
    // A long message makes a long answer (and a reasoning model thinks first): room for both.
    { maxRounds: 0, maxTokens: turn.length > 400 ? 2400 : 1400 },
  );
  spend(out.tokens);
  m.thinking = null;
  const json = parseJson(out.text);
  // Lost silently, a whole message of facts never reaches the dossier: at least say so.
  if (!json) console.error(`[reunión] lo que dijiste no se pudo apuntar (respuesta sin JSON): ${redact(out.text.slice(0, 300))}`);
  // Into the dossier right away: the bars move while you talk.
  notes.push(...applyOwnerNotes(json, turn, m.lines.filter((l) => l.speaker === 'owner').map((l) => l.text).join(' '), lead, tone === 'unsure'));
  closeTopics(m, json?.cerrado);
  // What you told someone to do: a real task, and they're the one who answers.
  const orders = takeOrders(m, json?.encargos, named ?? lead);
  for (const o of orders) notes.push({ name: 'crear_tarea', note: `creó «${o.title}» para ${o.who.name}` });
  const doer = orders.find((o) => all.includes(o.who));
  if (doer) return { order: orderFor(doer.who), notes, web, task: doer.title };
  if (!choose) return { order: orderFor(forced), notes, web, task: null };
  const pick = all.find((w) => typeof json?.habla === 'string' && norm(w.name) === norm(json.habla)) ?? lead;
  // Only worth saying when the voice changes from whoever spoke last.
  const lastVoice = [...m.lines].reverse().find((l) => l.speaker !== 'owner')?.speaker;
  if (pick !== lead && pick.id !== lastVoice) notes.unshift({ name: 'turno', note: `responde tras hablarlo con ${andList(all.filter((w) => w !== pick).map((w) => w.name))}` });
  return { order: orderFor(pick), notes, web, task: null };
}

/**
 * Roles you want in the team, kept with the dossier: the head's next hire ideas start from them
 * (she's asked to think again right away). Returns how many were new.
 */
function noteWanted(raw: unknown): number {
  const st = getState();
  const list = (st.brief.wanted ??= []);
  let added = 0;
  for (const p of Array.isArray(raw) ? raw.slice(0, 8) : []) {
    const text = typeof p === 'string' ? p.trim().replace(/\s+/g, ' ').slice(0, 200) : '';
    if (text.length < 6 || list.some((x) => overlap(x, text) > 0.6)) continue;
    list.push(text);
    added++;
  }
  if (list.length > 12) list.splice(0, list.length - 12);
  if (added && st.hireIdeas.status !== 'thinking') st.hireIdeas.status = 'asked';
  if (added) notify('change');
  return added;
}

/**
 * What the owner made clear, kept: the dossier (only what comes from his words), his rulings,
 * what he keeps for himself and the roles he wants. Shared by meetings and chats; returns the
 * notes to show next to whoever took them down.
 */
function applyOwnerNotes(json: Record<string, unknown> | null, turn: string, ownerWords: string, by: Worker, unsure = false): ToolUse[] {
  const notes: ToolUse[] = [];
  const noted: string[] = [];
  const dossier = (json?.dossier ?? {}) as Record<string, { texto?: unknown; certeza?: unknown }>;
  // «No sé» adds nothing to the dossier; one message rarely touches more than a few aspects.
  const entries = unsure ? [] : Object.entries(dossier).slice(0, turn.length > 400 ? BRIEF_ASPECTS.length : 3);
  // His words, this message first: a summary reuses them, a guess doesn't.
  const said = new Set(roots(`${turn} ${ownerWords}`));
  for (const [id, v] of entries) {
    const before = getState().brief.aspects[id as BriefAspect]?.text;
    if (typeof v?.texto === 'string' && v.texto.trim() === before) continue;
    // What's new in it has to come from what he said: no filling gaps with guesses. A third of
    // the new words is enough, since a summary rephrases («plataforma» for «web»).
    const had = new Set(roots(before ?? ''));
    const added = roots(typeof v?.texto === 'string' ? v.texto : '').filter((r) => !had.has(r));
    if (added.length && added.filter((r) => said.has(r)).length / added.length < 0.34) continue;
    if (noteBrief({ aspecto: id, texto: v?.texto, certeza: v?.certeza }).result === 'Apuntado.') noted.push(BRIEF_ASPECTS.find((a) => a.id === id)!.label.toLowerCase());
  }
  if (noted.length) notes.push({ name: 'anotar_dossier', note: noted.length > 2 ? `apuntó ${noted.length} aspectos en el dossier` : `apuntó en el dossier: ${noted.join(' y ')}` });
  const ruled = noteRulings(json?.decisiones);
  const kept = keepForOwner(json?.suyo, by, turn);
  const wanted = noteWanted(json?.puestos);
  if (wanted) notes.push({ name: 'puestos', note: `apuntó ${wanted === 1 ? 'el puesto que quieres' : `${wanted} puestos que quieres`} en el equipo` });
  if (ruled) notes.push({ name: 'decision', note: ruled === 1 ? 'apuntó tu decisión' : `apuntó ${ruled} decisiones tuyas` });
  if (kept.length) notes.push({ name: 'suyo', note: `quitó del equipo lo que llevas tú: ${kept.join(', ')}` });
  return notes;
}

/** Worth taking notes on: more than a greeting or a nod. */
const SUBSTANCE = (text: string) => norm(text).split(' ').filter((w) => w.length > 2).length >= 5;

/**
 * Your chat with someone: what you make clear there about the project counts as much as in a
 * meeting (a correction, a decision, a role you want). They take it down before answering, and
 * the notes say what they took down so «¿lo has apuntado?» has a true answer.
 */
export async function noteFromChat(w: Worker, turn: string, history: { owner: boolean; text: string }[]): Promise<ToolUse[]> {
  const brain = brainOf(w);
  if (typeof brain === 'string' || !SUBSTANCE(turn)) return [];
  const out = await think(
    brain,
    `Chat entre el propietario y ${w.name} (${w.title}). Tomas nota de lo que el propietario deja claro sobre su proyecto.`,
    [
      'Lo último:',
      history
        .slice(-6)
        .map((l) => `${l.owner ? 'Propietario' : w.name}: ${l.text.slice(0, 1200)}`)
        .join('\n'),
      '',
      `Dossier actual:\n${briefText() || '(vacío)'}`,
      rulingsText(),
      '',
      `Del ÚLTIMO mensaje del propietario («${turn.slice(0, 2400)}»):`,
      `1. "dossier": lo que dice del producto. Aspectos: ${BRIEF_ASPECTS.map((a) => `${a.id} (${a.label.toLowerCase()})`).join(', ')}. Solo los aspectos de los que habla. Lo que dijo ${w.name} solo cuenta si el propietario lo acepta. Por aspecto: texto completo actualizado (lo que ya había + lo nuevo, y si corrige algo, su versión), ${terse() ? 'telegráfico, ' : ''}datos exactos; certeza 0-1. Nada inventado.`,
      `2. "decisiones": instrucciones o correcciones firmes sobre cómo se hace el trabajo en el proyecto, en frases cortas impersonales (p. ej. «El croma se pide en el mismo prompt de generación, no se añade después»). Lo que le manda hacer ahora a ${w.name} («habla con Marta», «mira esto») NO es una decisión. Solo nuevas. [] si no hay.`,
      '3. "suyo": temas que dice expresamente que hace él mismo, 1-3 palabras en español sacadas de su mensaje. [] si no hay.',
      '4. "puestos": perfiles que dice que quiere en el equipo, con lo que harán. [] si no habla del equipo.',
      'Responde SOLO JSON: {"dossier": {}, "decisiones": [], "suyo": [], "puestos": []}',
    ].join('\n'),
    [],
    async () => '',
    { maxRounds: 0, maxTokens: turn.length > 400 ? 2400 : 1200 },
  );
  spend(out.tokens);
  const json = parseJson(out.text);
  if (!json) console.error(`[chat] ${w.name}: lo que dijiste no se pudo apuntar (respuesta sin JSON): ${redact(out.text.slice(0, 300))}`);
  const owner = history.filter((l) => l.owner).map((l) => l.text).join(' ');
  return applyOwnerNotes(json, turn, owner, w, UNSURE.test(turn));
}

/** Everything you've said since the team last spoke, as one turn. */
function ownerTurn(m: Meeting): string {
  const out: string[] = [];
  for (let i = m.lines.length - 1; i >= 0 && m.lines[i].speaker === 'owner'; i--) out.unshift(m.lines[i].text);
  return out.join('\n');
}

/** The last thing you said with substance (ten words or more): what a «¿qué acabo de decir?» points at. */
function lastAsk(m: Meeting): string {
  return [...m.lines].reverse().find((l) => l.speaker === 'owner' && norm(l.text).split(' ').length >= 10)?.text ?? '';
}

/** Topics you've answered or closed: kept for the rest of the meeting, so nobody asks again. */
function closeTopics(m: Meeting, raw: unknown): void {
  const list = (m.closed ??= []);
  for (const t of Array.isArray(raw) ? raw.slice(0, 6) : []) {
    const topic = typeof t === 'string' ? t.trim().slice(0, 40) : '';
    if (roots(topic).length && !list.some((x) => aboutTopic(x, topic) && aboutTopic(topic, x))) list.push(topic);
  }
  if (list.length > 20) list.splice(0, list.length - 20);
}

/** Orders to someone at the table, as tasks for them (never twice, never on what you keep yourself). */
function takeOrders(m: Meeting, raw: unknown, fallback: Worker): { who: Worker; title: string }[] {
  const st = getState();
  const done: { who: Worker; title: string }[] = [];
  for (const o of Array.isArray(raw) ? raw.slice(0, 3) : []) {
    const title = typeof o?.tarea === 'string' ? o.tarea.trim().slice(0, 160) : '';
    if (title.length < 8 || /\?\s*$/.test(title)) continue;
    const who = (typeof o?.quien === 'string' && st.workers.find((w) => norm(w.name) === norm(o.quien))) || fallback;
    // Same checks as any task (no copies, nothing that's yours); an existing one is simply theirs now.
    const { task: t } = addTask({ title, role: who.role, hours: 4, ongoing: false, who });
    if (!t) continue;
    if (t.assigneeId !== who.id) assignTask(t.id, who.id);
    log('edit', `Encargo tuyo en la reunión: «${t.title}» para ${who.name}`, who.id, t.id);
    (m.orders ??= []).push(`${who.name}: ${t.title}`);
    done.push({ who, title: t.title });
  }
  if (done.length) refreshActivities();
  return done;
}

const norm = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** How much two sentences say the same (shared words over the shorter one's words). */
function overlap(a: string, b: string): number {
  const wa = new Set(norm(a).split(' ').filter((w) => w.length > 3));
  const wb = new Set(norm(b).split(' ').filter((w) => w.length > 3));
  if (!wa.size || !wb.size) return 0;
  let same = 0;
  for (const w of wa) if (wb.has(w)) same++;
  return same / Math.min(wa.size, wb.size);
}

/** Your rulings, kept (new ones only). Returns how many were added. */
function noteRulings(raw: unknown): number {
  const b = getState().brief;
  const list = (b.rulings ??= []);
  let added = 0;
  for (const r of Array.isArray(raw) ? raw.slice(0, 3) : []) {
    const text = typeof r === 'string' ? r.trim().slice(0, 220) : '';
    if (text.length < 6 || /\?\s*$/.test(text) || list.some((x) => overlap(x.text, text) > 0.7)) continue;
    list.push({ text, at: Date.now() });
    added++;
  }
  // The latest dozen: older ones give way.
  if (list.length > 12) list.splice(0, list.length - 12);
  if (added) notify('change');
  return added;
}

/**
 * What you said you handle yourself: off the team's plate. Their unfinished tasks on it go (each
 * one in the log, so you can see what was dropped), and their open questions about it too.
 */
function keepForOwner(raw: unknown, by: Worker, turn: string): string[] {
  const st = getState();
  const yours = (st.brief.yours ??= []);
  const kept: string[] = [];
  for (const t of Array.isArray(raw) ? raw.slice(0, 4) : []) {
    const topic = typeof t === 'string' ? t.trim().slice(0, 40) : '';
    // In his own words or not at all: «pacing» for «I'll say when we slow down» would drop real work.
    if (norm(topic).length < 4 || !aboutTopic(turn, topic)) continue;
    const isNew = !yours.some((y) => aboutTopic(y, topic) && aboutTopic(topic, y));
    if (isNew) yours.push(topic);
    // «Priorizar la indexación» isn't the team's priority any more: back to doubtful.
    const prio = st.brief.aspects.prioridades;
    if (prio && prio.confidence >= 0.6 && aboutTopic(prio.text, topic)) prio.confidence = 0.4;
    const drop =st.tasks.filter((x) => x.status !== 'done' && aboutTopic(x.title, topic));
    for (const task of drop) {
      log('edit', `«${task.title}» sale del equipo: lo llevas tú`, by.id, null);
      deleteTask(task.id);
    }
    const before = st.questions.length;
    st.questions = st.questions.filter((q) => q.answer !== null || !aboutTopic(q.text, topic));
    // Only news is worth a note: the same thing said again changes nothing.
    if (isNew || drop.length || st.questions.length !== before) kept.push(topic);
  }
  if (kept.length) {
    notify('change');
    refreshActivities();
  }
  return kept;
}

/** Drop what the team already said: a reply that only restates an earlier line says nothing new. */
function fresh(m: Meeting, said: string): string {
  const before = m.lines.filter((l) => l.speaker !== 'owner').flatMap((l) => l.text.split(/(?<=[.!?])\s+/));
  const sentences = said.split(/(?<=[.!?])\s+/);
  // A question asked before (and not answered) is asked again at a lower bar: it's nagging.
  const kept = sentences.filter((s) => !before.some((b) => overlap(b, s) > (/\?\s*$/.test(s) && /\?\s*$/.test(b) ? 0.55 : 0.75)));
  if (kept.length) return kept.join(' ').trim();
  // Nothing new but a short «understood»: that much is still a fair answer.
  return said.length <= 90 && !/\?/.test(said) ? said : '';
}

/**
 * How to talk to the owner: they may not know what to say, so the team leads. Generic asks
 * («what information is missing?», «what resources do you need?») push the job back onto them;
 * the team knows exactly what's missing, so it asks for that, one thing at a time, made easy.
 */
const GUIDE = [
  'Cómo hablar con el propietario (puede que no sepa qué contar: guías tú, pero le escuchas):',
  '- Pregunta solo lo que solo él puede decidir: qué es el producto, para quién, qué problema resuelve, objetivos, presupuesto y plazos, prioridades. Los detalles de ejecución (tipografías, colores, formatos de plantillas, cada cuánto se revisa algo, quién del equipo hace qué) los decidís vosotros: no se los preguntes.',
  '- Primero los huecos del dossier, de arriba abajo; una tarea solo si sigue parada por algo que solo él sabe.',
  '- Una sola pregunta por turno, fácil de contestar: 2-3 opciones concretas o un ejemplo de su producto, y para qué lo necesitáis.',
  '- Prohibido preguntar en abierto: «¿qué información falta?», «¿qué recursos necesitas?», «¿algo más?», «cuéntanos». Lo que falta lo sabéis vosotros.',
  '- Nunca des por dicho ni por decidido algo que él no ha dicho con sus palabras. Nada de «confirmado» si no ha respondido a eso.',
  '- Si no entiende algo o se queja, para: explícalo o corrígete antes de seguir.',
  '- No vuelvas a preguntar lo que ya está respondido arriba, ni nada de lo que el propietario ha dicho que lleva él.',
  '- Lo que él hará lo dices así: «Te encargas tú de X» (nunca «quieres que yo te encargues»).',
  '- Nada de repetir un «Apunto que…» ya dicho: si no hay nada nuevo que apuntar, no apuntes nada.',
  '- Una pregunta que ya le hicisteis y no contestó no se repite: o propones tú («Empezamos por X; si no te encaja, me dices») o pasas a otra cosa.',
  '- Si dice que te pasa algo (un prompt, una web, un archivo) y en su mensaje no está, díselo: no te ha llegado, que lo pegue aquí.',
  '- Si se enfada, no te justifiques: reconócelo en una frase y no vuelvas a ese tema.',
  `- ${PLAIN}`,
].join('\n');

/** «Yo no he dicho eso», «escúchame», «te he dicho que…», a swear word: the team isn't listening. */
const COMPLAINT =
  /(no te he dicho|no (os )?he dicho|(?<![\p{L}])(te|os) (lo )?he dicho|ya (te|os) (lo )?(he )?dicho|esc[uú]ch(ame|adme)|no me (est[aá]is |est[aá]s )?escuch|no es eso|inventad|inventando|qu[eé] dices|de qu[eé] habl[aá]is|fatal|no tiene sentido|no me hac[eé]is caso|olv[ií]da(te|os|d)(?![\p{L}])|^\s*no,?\s*no(?![\p{L}])|confusi[oó]n|te equivocas|est[aá]s equivocad|te has liado|no es as[ií]|a qu[eé] esperas|(por qu[eé] )?no haces nada|sigues sin|joder|co[ñn]o(?![\p{L}])|hostia|me cago)/iu;
/** Shouting: mostly capitals, or «!!». */
const shouting = (text: string) => {
  const letters = text.replace(/[^\p{L}]/gu, '');
  return /!!/.test(text) || (letters.length >= 12 && letters.replace(/[^\p{Lu}]/gu, '').length / letters.length > 0.6);
};
/** «No entiendo», «¿a qué te refieres?», any question: they need it explained before anything else. */
const CONFUSED = /(no (lo )?entiendo|no comprendo|qu[eé] significa|qu[eé] quiere decir|a qu[eé] te refieres|de qu[eé] va|qu[eé] quer[eé]is que (os )?diga|qu[eé] quieres que (te )?diga|no s[eé] (lo )?qu[eé] es)/iu;
const QUESTION = /\?\s*$|^\s*¿/u;
/** «No sé», «lo que veáis»…: they've no answer, so the team proposes one. */
const UNSURE = /(?<![\p{L}])(no (lo )?s[eé]|ni idea|no (lo )?tengo claro|no estoy segur[oa]|lo que (veáis|veas|creáis|creas|prefieras|prefiráis)|me da igual|decidid vosotros|decide tú|no sabr[ií]a)(?![\p{L}])/iu;
/** «Vale», «me sirve», «sí»: agreeing to what was just proposed. */
const AGREES = /^\s*(s[ií]|vale|ok|okay|de acuerdo|perfecto|me (vale|sirve|parece bien)|adelante|genial|bien)(?![\p{L}])/iu;
/** The whole message is a nod: «por ejemplo», «eso es», «exacto», «así». */
const NOD = /^\s*(por ejemplo|eso es|eso mismo|exacto|justo( eso)?|as[ií]( es)?|claro|correcto|tal cual)[\s.!]*$/iu;
/** «Lo hablaré con Víctor», «eso lo hago yo», «es cosa mía»: the topic is theirs, closed. */
const HANDOFF =
  /(?<![\p{L}])(hablar[eé] (yo )?con|ya (lo )?hablo (yo )?con|me encargo yo|me ocupo yo|(lo|la|los|las) (hago|llevo|har[eé]) yo|(es|son) cosa m[ií]a|eso es m[ií]o|de eso me ocupo)(?![\p{L}])/iu;
/** «Te paso un prompt», «aquí tienes la web»: something should come with the message. */
const PASSES = /((te|os) (paso|dejo|adjunto|mando|env[ií]o)|aqu[ií] tienes)/iu;

/** «¿Terminamos la reunión?», «lo dejamos aquí»: they want to close it. */
const ENDS =
  /((terminar|terminamos|acabar|acabamos|cerrar|cerramos|finalizar|finalizamos)\b.{0,20}reuni[oó]n|^\s*¿?\s*(terminamos|acabamos|cerramos|lo dejamos aqu[ií]|eso es todo)(?![\p{L}]).{0,30}$)/iu;

type Tone = 'complaint' | 'ends' | 'handoff' | 'confused' | 'unsure' | 'agrees' | 'answer';
/** How the owner's last words land: a complaint and a doubt come before anything else. */
export function toneOf(text: string): Tone {
  if (COMPLAINT.test(text) || shouting(text)) return 'complaint';
  if (ENDS.test(text)) return 'ends';
  if (HANDOFF.test(text)) return 'handoff';
  if (CONFUSED.test(text) || QUESTION.test(text)) return 'confused';
  if (UNSURE.test(text)) return 'unsure';
  if (AGREES.test(text) || NOD.test(text)) return 'agrees';
  return 'answer';
}

/** What you've ruled on and what you've kept for yourself: above everything the team knows. */
export function rulingsText(): string {
  const b = getState().brief;
  const lines = [
    ...(b.yours ?? []).map((t) => `- «${t}» lo lleva el propietario: el equipo no lo toca ni pregunta por ello.`),
    ...(b.rulings ?? []).map((r) => `- ${r.text}`),
  ];
  return lines.length ? `Decisiones del propietario (mandan sobre todo lo demás; no se discuten ni se vuelven a preguntar):\n${lines.join('\n')}` : '';
}

/** The concrete case: what the dossier says and doesn't, what's blocked, what's unanswered. */
function caseFile(): string {
  const st = getState();
  const f = troubleFacts();
  const gaps = BRIEF_ASPECTS.filter((a) => (st.brief.aspects[a.id]?.confidence ?? 0) < 0.6).map((a) => {
    const known = st.brief.aspects[a.id];
    return `- ${a.label}: ${known ? `solo sabemos «${known.text.slice(0, 140)}» (dudoso)` : 'nada'}`;
  });
  return [
    `Producto: ${st.project || '(sin nombre)'}`,
    rulingsText(),
    gaps.length ? `Huecos del dossier:\n${gaps.join('\n')}` : 'Dossier completo.',
    f.blocked.length ? `Tareas bloqueadas: ${f.blocked.join('; ')}` : '',
    f.questions.length ? `Preguntas del equipo sin respuesta: ${f.questions.join(' · ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function purpose(m: Meeting): string {
  const st = getState();
  if (m.kind === 'kickoff') {
    return [
      'Primera reunión con el propietario (para quien trabaja la oficina): viene a contar su producto. Deja que explique; luego pregunta lo que falte (lo que dice ya queda apuntado en el dossier).',
      '',
      caseFile(),
      '',
      GUIDE,
    ].join('\n');
  }
  if (m.kind === 'crisis') {
    const weak = st.health.aspects.filter((a) => a.value < 50).map((a) => `${a.label.toLowerCase()} (${a.value} %: ${a.note})`);
    return [
      `Salud del proyecto ${st.health.overall} %, trabajo en pausa. Habéis convocado al propietario para desatascarlo.`,
      weak.length ? `Va mal: ${weak.join('; ')}.` : '',
      'Orden: primero el hueco que más trabajo bloquea, luego los demás.',
      '',
      caseFile(),
      '',
      GUIDE,
    ].join('\n');
  }
  return [
    'El propietario os convoca para repasar: qué sabéis, qué habéis hecho, qué cambiar.',
    'Responde a lo que plantee, cuenta lo relevante de tu área con datos concretos (mira tareas) y propone cambios si hacen falta.',
    '',
    caseFile(),
    '',
    GUIDE,
  ].join('\n');
}

/** What to do with the owner's last words: listen first, then take the answer or propose one. */
function afterOwner(m: Meeting, task: string | null): string {
  const last = m.lines[m.lines.length - 1];
  const next = 'Luego, si toca, la siguiente pregunta de la lista (solo lo que él decide), con 2-3 opciones o un ejemplo.';
  if (last?.speaker !== 'owner') return next;
  const turn = ownerTurn(m);
  const asked = [...m.lines].reverse().find((l) => l.speaker !== 'owner');
  const before = asked ? ` Lo último que le dijisteis: «${asked.text.slice(0, 300)}».` : '';
  const tone = toneOf(turn);
  // He told you to do something: you take it, no questions (an angry tone just means «already!»).
  if (task) {
    return [
      `Te ha encargado: «${task}» (ya está en tus tareas).`,
      tone === 'complaint' ? 'Está harto de repetirlo: «Perdona» y nada más de disculpa.' : '',
      'Tu turno, SIN NINGUNA PREGUNTA: confirma con sus datos que lo haces tú y di en una frase cómo empiezas (y que si necesitas ayuda se lo dirás a dirección).',
    ].join(' ');
  }
  switch (tone) {
    case 'complaint': {
      // What he's angry about is usually the last thing he asked for in full: say that back, not a closed topic.
      const ask = lastAsk(m);
      return [
        `Se queja o se enfada («${turn.slice(0, 200)}») y tiene razón: no le habéis escuchado.${before}`,
        ask && !turn.includes(ask) ? `Lo último que pidió con detalle, y no recogisteis: «${ask.slice(0, 300)}».` : '',
        'Tu turno, SIN NINGUNA PREGUNTA: «Perdona» (sin justificarte), repite en una frase y con sus palabras lo que pidió, y di qué hacéis ahora con ello. Lo que ya ha zanjado no se vuelve a nombrar.',
      ].join(' ');
    }
    case 'ends':
      return `Quiere terminar la reunión. Tu turno, SIN NINGUNA PREGUNTA: despídete en una o dos frases con el siguiente paso concreto del equipo. La reunión se cierra al terminar tú.`;
    case 'handoff':
      return [
        `Dice que eso lo lleva él o que lo hablará él directamente («${turn.slice(0, 200)}»).${before}`,
        'Tu turno: confírmalo en una frase («Perfecto, eso lo llevas tú» o «Hecho, Víctor queda a tu disposición») y nada más sobre ese tema: ni preguntas ni opciones.',
        'Si queda algo vuestro pendiente que solo él decide, una pregunta corta; si no, di qué vais a hacer vosotros y ya.',
      ].join(' ');
    case 'confused':
      return [
        `No ha entendido o te pregunta algo («${turn.slice(0, 200)}»).${before}`,
        'Tu turno: NO des nada por confirmado ni le devuelvas la pregunta. Si pregunta si está todo claro, resume en una frase lo que os ha pedido y ya. Si no entendió algo vuestro, explica qué necesitáis saber y para qué, con un ejemplo sacado de su producto. Si era un detalle que podéis decidir vosotros, dile que lo decidís vosotros.',
      ].join(' ');
    case 'unsure':
      return [
        `No lo sabe.${before}`,
        'Tu turno es SOLO esto, sin cambiar de tema ni repetir la pregunta: elige tú la opción que mejor encaja con su producto y díselo así: «Te propongo [opción], porque [motivo en una frase]. ¿Te vale?»',
      ].join(' ');
    case 'agrees':
      return [
        `Dice que sí.${before}`,
        'Si lo anterior era UNA propuesta vuestra, queda aceptada: dilo en pocas palabras. Si eran varias opciones y no eligió una, pregúntale cuál, sin dar nada por decidido.',
        next,
      ].join(' ');
    default:
      return [
        `Ha dicho: «${turn.slice(0, 300)}».${before}`,
        'Si aporta algo nuevo, recógelo en pocas palabras y en segunda persona, con lo que dijo él y nada más (si es lo mismo que ya apuntasteis, no lo repitas).',
        PASSES.test(turn) ?'Dice que te pasa algo: mira si de verdad viene en su mensaje (un texto, un prompt, una web). Si no está, díselo y pídele que lo pegue.' : '',
        next,
      ].join(' ');
  }
}

function prompt(me: Worker, m: Meeting, opening: boolean, web = '', task: string | null = null): string {
  const others = people(m)
    .filter((w) => w !== me)
    .map((w) => `${w.name} (${w.title})`);
  const closed = closedTopics(m);
  return [
    `Sala de reuniones con el propietario${others.length ? ` y ${others.join(', ')}` : ''}.`,
    purpose(m),
    '',
    'Dicho hasta ahora:',
    m.lines.length ? m.lines.map((l) => `${nameOf(l.speaker)}: ${l.text}`).join('\n') : '(nadie todavía)',
    '',
    web ? `${web}\n\nSi la web sirve para lo que habláis, úsala con datos concretos de ella; si no se pudo leer, díselo.\n` : '',
    opening
      ? m.kind === 'crisis'
        ? 'Abres tú, 2-3 frases: el motivo concreto (la cifra y la causa principal, con nombres de tareas o huecos) y tu primera pregunta concreta, con opciones o un ejemplo.'
        : m.kind === 'kickoff'
          ? 'Abres tú: saludo breve y pide que cuente qué es el producto y para quién, con un ejemplo de respuesta para que sepa por dónde empezar.'
          : 'Abres tú: saludo breve, una frase de cómo va (con un dato) y pregunta qué quiere repasar, proponiendo 2-3 temas concretos de los de abajo.'
      : [
          'Os habéis puesto de acuerdo: este turno hablas solo tú. 1-3 frases al propietario, sin repetir lo ya dicho.',
          afterOwner(m, task),
        ].join(' '),
    '',
    // Last, where a small model still reads it: what's settled.
    closed.length ? `Ya respondido o suyo, PROHIBIDO preguntar por ello: ${closed.join(', ')}.` : '',
    `Escribe SOLO lo que dices tú, ${me.name}, en voz alta al propietario: primera persona, hablándole de tú, sin comillas, sin hablar de él en tercera persona, sin contestar por él y sin repetir estas instrucciones.`,
  ].join('\n');
}

function noteBrief(args: Record<string, unknown>): { result: string; note: string } {
  const st = getState();
  const id = args.aspecto as BriefAspect;
  const aspect = BRIEF_ASPECTS.find((a) => a.id === id);
  const text = typeof args.texto === 'string' ? args.texto.trim().slice(0, 600) : '';
  if (!aspect || !text) return { result: 'Falta el aspecto o el texto.', note: 'quiso apuntar en el dossier' };
  // Only answers go in: a question still open isn't something you know.
  if (/\?\s*$/.test(text)) return { result: 'Eso es una pregunta: apunta solo lo que el propietario ha respondido.', note: 'quiso apuntar una pregunta' };
  const raw = Number(args.certeza);
  const c = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw > 1 ? raw / 100 : raw)) : 0.7;
  if (c < 0.15) return { result: 'Con tan poca certeza no se apunta.', note: 'no lo apuntó' };
  // "Still to be decided" is a gap, not something they know: it stays doubtful.
  const open = /por (definir|decidir|concretar)|sin definir|pendiente de (definir|decidir)|no (lo )?(sabe|tiene claro)|desconoc/i.test(text);
  if (open) return noteGap(id, aspect.label, text);
  st.brief.aspects[id] = { text, confidence: c, at: Date.now() };
  if (id === 'que' && !st.project) st.project = text.slice(0, 80);
  notify('change');
  return { result: 'Apuntado.', note: `apuntó «${aspect.label.toLowerCase()}» en el dossier` };
}

function tools(me: Worker): ToolSpec[] {
  const base = toolsFor(me).filter((t) => ['ver_equipo', 'ver_tareas', 'crear_tarea', 'asignar_tarea', 'recordar', 'ver_calendario', 'agendar', 'sugerir_contratacion', 'leer_web', 'buscar_web'].includes(t.name));
  // The dossier is kept by listen(), after each thing you say.
  return base;
}

async function speak(me: Worker, m: Meeting, text: string, publish: () => void, before: ToolUse[] = [], ordered = false): Promise<MeetingLine | null> {
  const brain = brainOf(me);
  if (typeof brain === 'string') return null;
  m.thinking = { who: me.id, tool: null };
  notify('change');
  publish();
  const used: ToolUse[] = [...before];
  const out = await think(brain, systemFor(me, 'owner'), text, tools(me), async (name, args) => {
    m.thinking = { who: me.id, tool: toolLabel(name) };
    notify('change');
    publish();
    const r = await useTool(me, null, name, args);
    used.push({ name, note: r.note });
    return redact(r.result);
  }, { maxRounds: 4, maxTokens: 900 });
  spend(out.tokens);
  m.thinking = null;
  const said = unasked(m, fresh(m, forOwner(tidy(out.text, me.name))), ordered);
  if (!said || answersForOwner(m, said)) return null;
  return { at: Date.now(), speaker: me.id, text: said, tools: used };
}

/** Ways the team asks the same thing: closing one closes them all. */
const SAME = [
  ['fechas', 'plazo', 'límite de tiempo', 'fecha límite', 'cuándo'],
  ['presupuesto', 'precio', 'coste', 'pagar', 'euros'],
  ['frecuencia', 'ritmo', 'diarios'],
];

/** What's settled: topics closed in this meeting (and their twins) and what the owner keeps for himself. */
function closedTopics(m: Meeting): string[] {
  const closed = m.closed ?? [];
  const twins = SAME.filter((g) => g.some((s) => closed.some((c) => aboutTopic(c, s) || aboutTopic(s, c)))).flat();
  return [...new Set([...closed, ...twins, ...(getState().brief.yours ?? [])])];
}

/**
 * The questions that shouldn't be there go, whatever the model wrote: about anything settled,
 * and after a complaint, an order or a handoff, any question at all.
 */
function unasked(m: Meeting, said: string, ordered: boolean): string {
  const tone = toneOf(ownerTurn(m));
  const none = ordered || tone === 'complaint' || tone === 'handoff' || tone === 'ends';
  const closed = closedTopics(m);
  return said
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !/\?\s*$/.test(s) || (!none && !closed.some((t) => aboutTopic(s, t))))
    .join(' ')
    .trim();
}

/** «Sí, aprobaré la propuesta», «Menos de 0,5 €.»: the model answering its own question as the owner. */
function answersForOwner(m: Meeting, said: string): boolean {
  if (/^\s*(s[ií],?\s+)?(apruebo|aprobar[eé]|acepto)(?![\p{L}])/iu.test(said)) return true;
  const asked = [...m.lines].reverse().find((l) => l.speaker !== 'owner')?.text ?? '';
  // Short and one of the options we offered: that's his line, not ours.
  return said.length <= 40 && /\?/.test(asked) && norm(asked).includes(norm(said));
}

async function answer(m: Meeting, publish: () => void): Promise<void> {
  busy = true;
  try {
    const opening = !m.lines.length;
    const ending = !opening && toneOf(ownerTurn(m)) === 'ends';
    const { order, notes, web, task } = opening ? { order: byRank(m).slice(0, 1), notes: [], web: '', task: null } : await listen(m, publish);
    // Only one line per turn; if the one who answers comes back empty-handed, the next takes it.
    let said = false;
    for (const me of order.slice(0, 2)) {
      if (getState().meeting !== m || m.status !== 'live') return;
      const first = me === order[0];
      const line = await speak(me, m, prompt(me, m, opening, web, first ? task : null), publish, first ? notes : [], first && !!task);
      if (line) {
        m.lines.push(line);
        notify('change');
        publish();
        said = true;
        break;
      }
      if (opening) break;
    }
    // Silence after you've spoken reads as not listening: at least an «understood», with what they took down.
    if (!said && !opening && order[0] && getState().meeting === m && m.status === 'live') {
      m.lines.push({ at: Date.now(), speaker: order[0].id, text: 'Entendido.', tools: notes });
      notify('change');
      publish();
    }
    m.waitingFor = 'owner';
    // You asked to finish: once they've said goodbye, the minutes get written.
    if (ending && m.status === 'live') m.status = 'closing';
  } catch (e) {
    const msg = redact(e instanceof Error ? e.message : String(e));
    console.error(`[reunión] ${msg}`);
    m.thinking = null;
    // The provider asks to wait: try again then (the panel says why); anything else, the word comes back to you.
    if (e instanceof LlmError && e.status === 429) {
      waitForProvider(e);
      waitUntil = Date.now() + (e.retryAfterMs || 20_000);
    } else m.waitingFor = 'owner';
  } finally {
    busy = false;
    notify('change');
    publish();
  }
}

/** The head (or whoever leads) writes the minutes and finishes the dossier; everyone remembers it. */
async function close(m: Meeting, publish: () => void, canThink: boolean): Promise<void> {
  busy = true;
  const st = getState();
  const lead = people(m).find((w) => w.role === 'director') ?? people(m)[0];
  try {
    // Without AI right now the meeting still ends: just without minutes.
    if (lead && canThink && m.lines.some((l) => l.speaker === 'owner')) {
      const brain = brainOf(lead);
      if (typeof brain !== 'string') {
        m.thinking = { who: lead.id, tool: 'escribiendo el acta' };
        notify('change');
        publish();
        // One plain answer (no tools): the minutes and the dossier as JSON, which every model manages.
        const out = await think(
          brain,
          systemFor(lead, 'owner'),
          [
            'Fin de la reunión con el propietario. Se dijo:',
            m.lines.map((l) => `${nameOf(l.speaker)}: ${l.text}`).join('\n'),
            '',
            rulingsText(),
            m.orders?.length ? `Encargos que dio (ya son tareas): ${m.orders.join('; ')}.` : '',
            'Lo que el propietario dijo manda: nada de lo que ya respondió va como pendiente ni como «espera instrucciones». Próximos pasos = sus encargos y lo que él dijo que enviará.',
            '',
            'Responde SOLO un objeto JSON, sin texto alrededor:',
            `{"acta": "3-6 frases claras: qué se aclaró, qué se decidió, próximos pasos", "dossier": {"objetivos": {"texto": "${terse() ? 'telegráfico, datos exactos' : 'lo que dijo, resumido'}", "certeza": 0.8}}}`,
            'Certeza 0-1: 0.9 claro y completo, 0.5 a medias.',
            `Aspectos: ${BRIEF_ASPECTS.map((a) => `${a.id} (${a.label.toLowerCase()})`).join(', ')}.`,
            'Solo aspectos de los que el propietario dijo algo, con sus datos. Nada inventado, nada de preguntas.',
          ].join('\n'),
          [],
          async () => '',
          { maxRounds: 0, maxTokens: 1400 },
        );
        spend(out.tokens);
        const json = parseJson(out.text);
        const dossier = (json?.dossier ?? {}) as Record<string, { texto?: unknown; certeza?: unknown }>;
        // Only what the owner said: everything new in an aspect has to be in their words.
        const said = new Set(roots(m.lines.filter((l) => l.speaker === 'owner').map((l) => l.text).join(' ')));
        for (const [id, v] of Object.entries(dossier)) {
          const had = new Set(roots(st.brief.aspects[id as BriefAspect]?.text ?? ''));
          const added = roots(typeof v?.texto === 'string' ? v.texto : '').filter((r) => !had.has(r));
          if (added.length && added.filter((r) => said.has(r)).length / added.length < 0.34) continue;
          noteBrief({ aspecto: id, texto: v?.texto, certeza: v?.certeza });
        }
        m.summary = typeof json?.acta === 'string' ? json.acta.trim().slice(0, 1200) : tidy(out.text, lead.name).slice(0, 1200) || null;
      }
    }
  } catch (e) {
    if (e instanceof LlmError && e.status === 429) {
      busy = false;
      waitForProvider(e);
      waitUntil = Date.now() + (e.retryAfterMs || 20_000);
      return;
    }
    console.error(`[reunión] ${redact(e instanceof Error ? e.message : String(e))}`);
  }
  m.status = 'ended';
  m.endedAt = Date.now();
  m.thinking = null;
  if (m.kind === 'kickoff' && m.lines.some((l) => l.speaker === 'owner')) st.brief.kickedOff = true;
  for (const w of people(m)) remember(w, `Reunión con el propietario (${new Date(m.startedAt).toLocaleDateString('es-ES')}): ${m.summary ?? 'sin acta'}`);
  st.meetings.unshift(m);
  st.meetings.length = Math.min(st.meetings.length, KEEP);
  st.health.lastMeetingEnd = m.endedAt;
  st.meeting = null;
  // What the meeting answered shouldn't stay open as a doubt.
  settleDue = true;
  log('meeting', m.summary ? `Acta de la reunión: ${m.summary}` : 'Termina la reunión contigo', lead?.id ?? null);
  refreshActivities();
  busy = false;
  notify('change');
  publish();
}

/** Due after each meeting, and once on start: open doubts are checked against what's known. */
let settleDue = true;

/**
 * Doubts the team left for you that the meeting, your decisions or the dossier already answer
 * (or that were never yours to answer: ids, how their tools work) get closed by the head with
 * that answer, so they neither wait on you nor count against the project's clarity. What only
 * you can answer stays open.
 */
async function settleQuestions(publish: () => void): Promise<void> {
  settleDue = false;
  const st = getState();
  const open = st.questions.filter((q) => q.answer === null);
  const head = st.workers.find((w) => w.reportsTo === null);
  if (!open.length || !head) return;
  const brain = brainOf(head);
  if (typeof brain === 'string') return;
  busy = true;
  const last = st.meetings[0];
  const heard = last ? last.lines.filter((l) => l.speaker === 'owner').map((l) => `- ${l.text}`).join('\n').slice(-4000) : '';
  try {
    const out = await think(
      brain,
      systemFor(head),
      [
        'Dudas del equipo que siguen abiertas, esperando al propietario:',
        open.map((q) => `[${q.id}] ${worker(q.workerId)?.name ?? '¿?'}: ${q.text}`).join('\n'),
        '',
        'Lo que ya sabemos:',
        briefText() || '(dossier vacío)',
        rulingsText(),
        last?.summary ? `Acta de la última reunión: ${last.summary}` : '',
        heard ? `Lo que dijo el propietario en ella:\n${heard}` : '',
        '',
        'Para cada duda: si lo de arriba ya la responde, escribe la respuesta con esos datos (1-2 frases, sin inventar nada).',
        'Si es interna del equipo y el propietario no tiene por qué saberla (ids de tareas, cómo usar sus herramientas, dónde está algo del sistema), respóndela tú: cómo lo resuelven ellos.',
        'Si de verdad solo el propietario puede responderla, NO la pongas.',
        'Responde SOLO JSON: {"respondidas": [{"id": "p12", "respuesta": "…"}]}',
      ]
        .filter(Boolean)
        .join('\n'),
      [],
      async () => '',
      { maxRounds: 0, maxTokens: 1200 + 250 * open.length },
    );
    spend(out.tokens);
    const list = parseJson(out.text)?.respondidas;
    for (const x of Array.isArray(list) ? (list as Record<string, unknown>[]) : []) {
      const q = open.find((o) => o.id === x?.id && o.answer === null);
      const text = typeof x?.respuesta === 'string' ? x.respuesta.trim().slice(0, 600) : '';
      if (!q || text.length < 3) continue;
      q.answer = `(${head.name}, con lo ya hablado con el propietario) ${text}`;
      q.answeredAt = Date.now();
      for (const msg of st.inbox) if (msg.action?.type === 'answer' && msg.action.questionId === q.id) Object.assign(msg, { closed: true, read: true });
      log('question', `${head.name} responde a ${worker(q.workerId)?.name ?? 'alguien'} con lo ya hablado: «${text.length > 80 ? `${text.slice(0, 80)}…` : text}»`, head.id);
    }
  } catch (e) {
    if (e instanceof LlmError && e.status === 429) {
      settleDue = true;
      waitForProvider(e);
      waitUntil = Date.now() + (e.retryAfterMs || 20_000);
    } else console.error(`[dudas] ${redact(e instanceof Error ? e.message : String(e))}`);
  } finally {
    busy = false;
    notify('change');
    publish();
  }
}

function noteGap(id: BriefAspect, label: string, text: string): { result: string; note: string } {
  getState().brief.aspects[id] = { text, confidence: 0.2, at: Date.now() };
  notify('change');
  return { result: 'Apuntado como pendiente.', note: `apuntó «${label.toLowerCase()}» como pendiente` };
}

/** For prompts: what the office knows about the product. */
export function briefText(): string {
  const st = getState();
  const known = BRIEF_ASPECTS.filter((a) => st.brief.aspects[a.id]);
  if (!known.length) return '';
  return known.map((a) => `- ${a.label}: ${st.brief.aspects[a.id]!.text}${st.brief.aspects[a.id]!.confidence < 0.6 ? ' (dudoso)' : ''}`).join('\n');
}

/** "Marta", "Marta y Óscar", "Marta, Óscar e Inés": "e" before an i- sound, as in Spanish. */
function andList(names: string[]): string {
  if (names.length < 2) return names[0] ?? '';
  const last = names[names.length - 1];
  return `${names.slice(0, -1).join(', ')} ${/^h?[iíIÍ](?![aeoáéó])/.test(last) ? 'e' : 'y'} ${last}`;
}

/** The first {...} in a reply, parsed; null if there isn't a valid one. */
export function parseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
