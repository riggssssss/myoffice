/**
 * Inventories: what each agent makes or finds (a document, a picture, a link, a prompt, a
 * contact…) goes into theirs. Once it's ready it goes up to their boss, who looks at it with
 * their AI and passes it on as it is, improves it, sends it back to redo or sets it aside. The
 * head hands it to you. So what reaches you has been filtered and polished on the way up.
 */
import { getState, inMeeting, log, notify, task, worker } from '../src/sim/ops';
import { ITEM_KIND_IDS, ITEM_KINDS } from '../src/sim/items';
import type { ChatFile, ChatImage, Item, ItemKind, ItemStep, Worker } from '../src/sim/types';
import { addTask, brainOf, remember, spend, systemFor, terse, waitForProvider } from './agents';
import { fileText, imageData, makeFile } from './files';
import { LlmError, sees, think, type Picture, type ToolSpec } from './llm';
import { briefText, parseJson, rulingsText } from './meetings';
import { redact } from './vault';

/** Delivered and archived ones kept (starred ones always stay). */
const KEEP_DONE = 200;
/** Set aside or replaced ones kept, as a record. */
const KEEP_GONE = 80;
const MAX_TEXT = 8000;
/** Longer than this, a written piece also comes as a file to download. */
const LONG = 2500;
/** Pieces one boss looks at in one go. */
const BATCH = 4;
/** Between one boss's rounds of review. */
const GAP_MS = 60_000;
/** A draft left longer than this goes up on its own. */
const DRAFT_MS = 3 * 3600_000;
/** Sent back this many times, it goes on with the boss's reservations instead of round again. */
const MAX_BACKS = 2;
/** Rounds without a usable answer before it goes up as it is. */
const MAX_FAILS = 3;

const kindList = ITEM_KIND_IDS.map((k) => `${k}: ${ITEM_KINDS[k].hint}`).join('; ');

export const ITEM_TOOLS: ToolSpec[] = [
  {
    name: 'guardar_en_inventario',
    description:
      'Guarda en tu inventario una pieza que has hecho o encontrado y que sirve por sí sola (un texto listo, un guion, un prompt, una tabla, un script, un enlace o referencia buena, un contacto, una herramienta, un presupuesto…). Lista → sube a tu responsable, que la revisa, y llega al propietario. Una pieza por cosa, completa.',
    parameters: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ITEM_KIND_IDS, description: kindList },
        titulo: { type: 'string', description: 'corto y claro, en español' },
        contenido: { type: 'string', description: 'la pieza entera (el texto, el script, el prompt, la tabla en CSV, por qué vale la referencia). Nada de «ver arriba».' },
        url: { type: 'string', description: 'enlaces y referencias: la dirección https' },
        borrador: { type: 'boolean', description: 'true si aún no está lista: se queda contigo hasta que la entregues' },
        sustituye: { type: 'string', description: 'id de una pieza tuya devuelta que rehaces' },
      },
      required: ['tipo', 'titulo'],
    },
  },
  {
    name: 'entregar',
    description: 'Pasa a tu responsable un borrador de tu inventario que ya está listo.',
    parameters: { type: 'object', properties: { id: { type: 'string' }, nota: { type: 'string', description: 'qué es y qué mirar, 1 frase' } }, required: ['id'] },
  },
  {
    name: 'ver_inventario',
    description: 'Tu inventario: borradores, lo que está en revisión, lo devuelto con su motivo y lo ya entregado.',
    parameters: { type: 'object', properties: {} },
  },
];

const ITEM_TOOL_NAMES = new Set(ITEM_TOOLS.map((t) => t.name));
export const isItemTool = (name: string) => ITEM_TOOL_NAMES.has(name);

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const plain = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const httpsUrl = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch {
    return '';
  }
};

/** The next one up who is in the team and switched on; null: the head, who hands it to you. */
function nextUp(w: Worker): Worker | null {
  let b = worker(w.reportsTo);
  while (b && !b.enabled) b = worker(b.reportsTo);
  return b ?? null;
}

function step(i: Item, by: string, act: ItemStep['act'], note: string): void {
  i.trail.push({ at: Date.now(), by, act, note: note.slice(0, 300) });
}

/** On to the boss of `from`, or to you if there's nobody above. */
function moveUp(i: Item, from: Worker): void {
  const boss = nextUp(from);
  if (boss) Object.assign(i, { holder: boss.id, status: 'review' });
  else {
    Object.assign(i, { holder: 'owner', status: 'delivered', unseen: true });
    log('review', `${from.name} te pasa «${i.title}»`, from.id, i.taskId);
  }
  notify('change');
}

/** A written piece long enough to want it as a file too. */
function asFile(kind: ItemKind, title: string, text: string): ChatFile[] | undefined {
  if (text.length < LONG || !['doc', 'report', 'plan', 'code', 'data', 'copy', 'budget'].includes(kind)) return undefined;
  try {
    const csv = kind === 'data' && text.split('\n').slice(0, 3).every((l) => l.includes(','));
    const body = kind === 'code' && !text.includes('```') ? `# ${title}\n\n\`\`\`\n${text}\n\`\`\`\n` : text;
    return [makeFile(`${title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60) || 'documento'}.${csv ? 'csv' : 'md'}`, body)];
  } catch {
    return undefined;
  }
}

export interface NewItem {
  kind: ItemKind;
  title: string;
  text?: string;
  url?: string;
  files?: ChatFile[];
  images?: ChatImage[];
  taskId: string | null;
  /** Stays with its maker until they hand it in. */
  draft?: boolean;
  /** The id of one of theirs sent back, that this one redoes. */
  replaces?: string;
}

/** Into their inventory (and, unless it's a draft, up to their boss). Returns why not, as a string. */
export function makeItem(w: Worker, o: NewItem): Item | string {
  const st = getState();
  const title = o.title.replace(/\s+/g, ' ').trim().slice(0, 120);
  const text = (o.text ?? '').trim().slice(0, MAX_TEXT);
  const url = o.url ? httpsUrl(o.url) : '';
  if (title.length < 3) return 'Falta un título claro.';
  if ((o.kind === 'link' || o.kind === 'reference') && !url && !text && !o.images?.length && !o.files?.length) return 'Un enlace o una referencia necesita su dirección https.';
  if (!text && !url && !o.files?.length && !o.images?.length) return 'Está vacía: pon el contenido completo.';
  const old = o.replaces ? st.items.find((i) => i.id === o.replaces && i.by === w.id) : undefined;
  if (o.replaces && !old) return `No tienes ninguna pieza ${o.replaces}.`;
  // The same piece again: say so instead of keeping two.
  const same = st.items.find(
    (i) =>
      i !== old &&
      i.status !== 'dropped' &&
      i.status !== 'replaced' &&
      ((i.by === w.id && plain(i.title) === plain(title)) || (url && i.url === url)),
  );
  if (same) return `Ya existe «${same.title}» (${same.id}, ${same.status === 'delivered' || same.status === 'archived' ? 'ya entregada al propietario' : 'en camino'}): no la repitas.`;
  const written = o.files?.length ? undefined : asFile(o.kind, title, text);
  const item: Item = {
    id: `i${st.nextId++}`,
    kind: o.kind,
    title,
    text,
    ...(url ? { url } : {}),
    ...(o.files?.length || written ? { files: [...(o.files ?? []), ...(written ?? [])] } : {}),
    ...(o.images?.length ? { images: o.images.slice(0, 12) } : {}),
    by: w.id,
    holder: w.id,
    status: 'held',
    taskId: o.taskId,
    at: Date.now(),
    v: old ? old.v + 1 : 1,
    trail: old ? [...old.trail] : [],
  };
  if (old) {
    old.status = 'replaced';
    step(item, w.id, 'redo', `versión ${item.v}`);
  } else step(item, w.id, 'made', '');
  st.items.push(item);
  if (!o.draft) moveUp(item, w);
  prune();
  notify('change');
  return item;
}

/** What they sent you straight in a chat: yours already, kept with the rest. */
export function keepSent(w: Worker, files: ChatFile[], images: ChatImage[], about: string): void {
  const st = getState();
  const add = (kind: ItemKind, title: string, extra: Partial<Item>) => {
    const i: Item = { id: `i${st.nextId++}`, kind, title: title.slice(0, 120), text: '', by: w.id, holder: 'owner', status: 'delivered', taskId: null, at: Date.now(), v: 1, trail: [], ...extra };
    step(i, w.id, 'sent', about.slice(0, 200));
    st.items.push(i);
  };
  for (const f of files) add(f.kind === 'image' ? 'image' : 'doc', f.name, { files: [f] });
  if (images.length) add('reference', images.length === 1 ? (images[0].title ?? 'Imagen') : `${images.length} imágenes${images[0].title ? `: ${images[0].title}` : ''}`, { images, ...(images[0].link ? { url: images[0].link } : {}) });
  prune();
  notify('change');
}

/** Their inventory, for their prompt at the desk: what to redo first, drafts, what's gone up. */
export function inventoryFor(w: Worker): string {
  const mine = getState().items.filter((i) => i.by === w.id);
  const back = mine.filter((i) => i.status === 'back');
  const held = mine.filter((i) => i.status === 'held');
  const gone = mine.filter((i) => i.status === 'review' || i.status === 'delivered' || i.status === 'archived').slice(-6);
  const lastNote = (i: Item) => {
    const s = [...i.trail].reverse().find((x) => x.act === 'back' || x.act === 'asked');
    return s ? `${s.by === 'owner' ? 'el propietario' : (worker(s.by)?.name ?? 'tu responsable')}: ${s.note}` : '';
  };
  const lines = [
    ...(back.length ? ['Devuelto, rehazlo antes que nada (guardar_en_inventario con sustituye=id):', ...back.map((i) => `- ${i.id} «${i.title}» → ${lastNote(i)}`)] : []),
    ...(held.length ? ['Borradores tuyos (entregar cuando estén listos):', ...held.map((i) => `- ${i.id} «${i.title}»`)] : []),
    ...(gone.length ? [`Ya pasado hacia arriba (no lo repitas): ${gone.map((i) => `«${i.title}»`).join(', ')}`] : []),
  ];
  return lines.length ? `Tu inventario:\n${lines.join('\n')}` : '';
}

export function useItemTool(me: Worker, name: string, args: Record<string, unknown>): { note: string; result: string } {
  const st = getState();
  if (name === 'ver_inventario') {
    const mine = st.items.filter((i) => i.by === me.id && i.status !== 'replaced').slice(-20);
    const toReview = st.items.filter((i) => i.status === 'review' && i.holder === me.id).length;
    const where = (i: Item) =>
      i.status === 'review' ? `en revisión con ${worker(i.holder)?.name ?? '—'}` : i.status === 'delivered' || i.status === 'archived' ? 'entregada al propietario' : i.status === 'back' ? 'devuelta' : i.status === 'dropped' ? 'descartada' : 'borrador';
    return {
      note: 'miró su inventario',
      result: [
        mine.length ? mine.map((i) => `${i.id} ${ITEM_KINDS[i.kind].label} «${i.title}» · ${where(i)}${i.v > 1 ? ` · v${i.v}` : ''}`).join('\n') : 'Tu inventario está vacío.',
        inventoryFor(me),
        toReview ? `Te han pasado ${toReview} pieza(s) para revisar: las revisas en tu ronda de revisión, no hace falta herramienta.` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    };
  }
  if (name === 'entregar') {
    const i = st.items.find((x) => x.id === str(args.id, 20) && x.by === me.id);
    if (!i) return { note: 'quiso entregar algo', result: 'No tienes ninguna pieza con ese id (mira ver_inventario).' };
    if (i.status !== 'held') return { note: `vio que «${i.title}» ya no era un borrador`, result: i.status === 'back' ? 'Está devuelta: rehazla con guardar_en_inventario y sustituye.' : 'Ya no es un borrador: ya ha salido.' };
    const nota = str(args.nota, 200);
    if (nota) step(i, me.id, 'up', nota);
    moveUp(i, me);
    const boss = nextUp(me);
    return { note: `pasó «${i.title}» a ${boss?.name ?? 'el propietario'}`, result: boss ? `Pasada a ${boss.name} para revisión.` : 'Entregada al propietario.' };
  }
  // guardar_en_inventario
  const kind = ITEM_KIND_IDS.includes(args.tipo as ItemKind) ? (args.tipo as ItemKind) : null;
  if (!kind) return { note: 'quiso guardar algo', result: `Tipo no válido. Usa uno de: ${ITEM_KIND_IDS.join(', ')}.` };
  const r = makeItem(me, {
    kind,
    title: str(args.titulo, 160),
    text: str(args.contenido, MAX_TEXT),
    url: str(args.url, 600),
    taskId: me.deskWork?.taskId ?? me.taskId,
    draft: args.borrador === true || args.borrador === 'true',
    replaces: str(args.sustituye, 20) || undefined,
  });
  if (typeof r === 'string') return { note: 'no pudo guardar una pieza', result: r };
  const boss = nextUp(me);
  return {
    note: `guardó «${r.title}» en su inventario`,
    result:
      r.status === 'held'
        ? `Guardada como borrador (${r.id}). Entrégala con entregar cuando esté lista.`
        : `Guardada (${r.id}) y ${boss ? `pasada a ${boss.name} para revisión` : 'entregada al propietario'}.`,
  };
}

// ---------------------------------------------------------------- review on the way up

let reviewing = false;
const lastRound = new Map<string, number>();
const fails = new Map<string, number>();

/** In the office and free enough to look at what they were passed. */
const around = (w: Worker) => getState().working && w.enabled && !inMeeting(w) && w.activity !== 'away' && w.interviewSince === null;

/** Every tick: drafts that are due go up, and one boss at a time looks at what they were passed. */
export function itemsTick(publish: () => void, canThink: boolean): void {
  const st = getState();
  const now = Date.now();
  for (const i of st.items) {
    if (i.status !== 'held' && i.status !== 'review') continue;
    const maker = worker(i.by);
    if (!maker) {
      // Its maker left: what was on its way still goes on, from where it was.
      if (i.status === 'held') Object.assign(i, { status: 'dropped' });
      continue;
    }
    if (i.status === 'held') {
      // A draft goes up once its task is finished, or after a few hours.
      const t = task(i.taskId);
      if ((t && (t.status === 'review' || t.status === 'done')) || now - i.at > DRAFT_MS) moveUp(i, maker);
    } else if (!worker(i.holder)) {
      // Whoever had it to review left: the next one up from its maker.
      moveUp(i, maker);
    }
  }
  if (reviewing || !st.working) return;
  const waiting = st.items.filter((i) => i.status === 'review').sort((a, b) => a.trail[a.trail.length - 1].at - b.trail[b.trail.length - 1].at);
  for (const i of waiting) {
    const w = worker(i.holder);
    if (!w || !around(w) || now - (lastRound.get(w.id) ?? 0) < GAP_MS) continue;
    const batch = waiting.filter((x) => x.holder === w.id).slice(0, BATCH);
    const brains = brainOf(w);
    lastRound.set(w.id, now);
    // Without an AI they can't judge it: it goes on as it is.
    if (typeof brains === 'string') {
      for (const x of batch) {
        step(x, w.id, 'up', '');
        moveUp(x, w);
      }
      continue;
    }
    if (!canThink) return;
    reviewing = true;
    void review(w, batch, brains, publish).finally(() => {
      reviewing = false;
      if (w.busyWith === BUSY) w.busyWith = null;
      notify('change');
      publish();
    });
    return;
  }
}

const BUSY = 'revisando lo que le han pasado';

async function review(w: Worker, items: Item[], brains: Exclude<ReturnType<typeof brainOf>, string>, publish: () => void): Promise<void> {
  const st = getState();
  const boss = nextUp(w);
  const toWhom = boss ? `${boss.name} (${boss.title})` : 'el propietario';
  if (!w.busyWith) w.busyWith = BUSY;
  notify('change');
  publish();
  const canSee = sees(brains[0]);
  const pictures: Picture[] = [];
  const given = st.items.filter((i) => i.holder === 'owner' && i.status !== 'replaced').slice(-15);
  const blocks: string[] = [];
  for (const i of items) {
    const maker = worker(i.by);
    const t = task(i.taskId);
    const backs = i.trail.filter((s) => s.act === 'back' || s.act === 'asked');
    const said = i.trail.filter((s) => (s.act === 'up' || s.act === 'better') && s.note).map((s) => `${worker(s.by)?.name ?? '?'}: ${s.note}`);
    let body = i.text;
    const doc = i.files?.find((f) => f.kind === 'doc');
    if (!body && doc) body = (await fileText(doc.id, 4000)) ?? '';
    const pics = (i.files ?? []).filter((f) => f.kind === 'image');
    const shown: number[] = [];
    if (canSee) {
      for (const f of pics) {
        const d = pictures.length < 4 ? imageData(f.id) : null;
        if (d) shown.push(pictures.push(d));
      }
    }
    blocks.push(
      [
        `[${i.id}] ${ITEM_KINDS[i.kind].label} · «${i.title}» · de ${maker?.name ?? '?'}${t ? ` · tarea «${t.title}»` : ''}${i.v > 1 ? ` · versión ${i.v}` : ''}`,
        i.url ? `Enlace: ${i.url}` : '',
        body ? `Contenido:\n${body.slice(0, 3000)}` : '',
        pics.length ? `${pics.length} imagen(es)${shown.length ? `: te adjunto la(s) ${shown.join(', ')}` : ': no las ves, juzga por el título y el prompt'}.` : '',
        i.images?.length ? `${i.images.length} imagen(es) de una app${i.images[0].title ? ` («${i.images[0].title}»)` : ''}.` : '',
        said.length ? `Ya revisado por: ${said.join(' / ')}` : '',
        backs.length ? `Se devolvió antes por: ${backs.map((b) => b.note).join(' / ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  const prompt = [
    `Revisas lo que tu equipo te ha pasado antes de que siga hacia ${toWhom}. Al propietario solo debe llegar lo que merece la pena, pulido.`,
    st.project ? `Producto: ${st.project}` : '',
    briefText() ? `Lo que sabemos del producto:\n${briefText()}` : '',
    rulingsText(),
    given.length ? `Ya entregado al propietario (no repitas):\n${given.map((i) => `- ${ITEM_KINDS[i.kind].label}: ${i.title}`).join('\n')}` : '',
    '',
    blocks.join('\n\n'),
    '',
    'Para cada pieza decide:',
    '- "subir": vale y sigue. Si puedes mejorarla de verdad (más clara, sin relleno, corrigiendo un error, más ajustada a lo que quiere el propietario), pon "titulo" y/o "contenido" ya mejorados y completos; si no, déjalos vacíos.',
    '- "devolver": aún no vale; en "nota", qué cambiar, concreto. No devuelvas por detalles que puedes arreglar tú al mejorarla.',
    '- "descartar": repetida, inútil o contra lo que decidió el propietario; en "nota", por qué.',
    `"nota" (1 frase${terse() ? ', máx. 20 palabras' : ''}): para ${boss ? boss.name : 'el propietario'}, qué es y por qué vale, o qué falta.`,
    'Responde SOLO JSON: {"revision":[{"id":"i12","decision":"subir","titulo":"","contenido":"","nota":"…"}]}',
  ].join('\n');
  try {
    const out = await think(brains, systemFor(w), prompt, [], async () => '', {
      maxRounds: 0,
      maxTokens: 1400 + 800 * items.length,
      ...(pictures.length ? { pictures } : {}),
    });
    spend(out.tokens);
    const json = parseJson(out.text);
    const list = Array.isArray(json?.revision) ? (json.revision as Record<string, unknown>[]) : [];
    if (!list.length) console.error(`[inventario] ${w.name}: la revisión no trajo JSON`);
    const counts = { up: 0, back: 0, dropped: 0 };
    items.forEach((i, n) => {
      const d = list.find((x) => str(x?.id, 20) === i.id) ?? (list.length === items.length ? list[n] : undefined);
      if (i.status !== 'review' || i.holder !== w.id) return;
      if (!d) {
        // No verdict: next round, and after a few, on as it is.
        const f = (fails.get(i.id) ?? 0) + 1;
        fails.set(i.id, f);
        if (f >= MAX_FAILS) {
          fails.delete(i.id);
          step(i, w.id, 'up', '');
          moveUp(i, w);
        }
        return;
      }
      fails.delete(i.id);
      counts[apply(w, i, d)]++;
    });
    const n = counts.up + counts.back + counts.dropped;
    if (n)
      log(
        'review',
        `${w.name} revisa ${n === 1 ? `«${items[0].title}»` : `${n} piezas`}: ${[
          counts.up ? `${counts.up} ${boss ? 'suben' : 'te llegan'}` : '',
          counts.back ? `${counts.back} devuelta${counts.back > 1 ? 's' : ''}` : '',
          counts.dropped ? `${counts.dropped} descartada${counts.dropped > 1 ? 's' : ''}` : '',
        ]
          .filter(Boolean)
          .join(', ')}`,
        w.id,
        null,
      );
  } catch (e) {
    const msg = redact(e instanceof Error ? e.message : String(e));
    console.error(`[inventario] ${w.name}: ${msg}`);
    if (e instanceof LlmError && e.status === 429) waitForProvider(e);
    lastRound.set(w.id, Date.now() + (e instanceof LlmError ? e.retryAfterMs : 0));
  }
}

/** One verdict, carried out. */
function apply(w: Worker, i: Item, d: Record<string, unknown>): 'up' | 'back' | 'dropped' {
  const maker = worker(i.by);
  const note = str(d.nota, 300);
  let decision = str(d.decision, 20).toLowerCase();
  const backs = i.trail.filter((s) => s.act === 'back' || s.act === 'asked').length;
  if (decision === 'devolver' && (!maker || maker === w || backs >= MAX_BACKS)) decision = 'subir';
  if (decision === 'devolver' && maker) {
    Object.assign(i, { status: 'back', holder: maker.id });
    step(i, w.id, 'back', note || 'Necesita otra vuelta.');
    remember(maker, `${w.name} me devolvió «${i.title}» (${i.id}): ${note}. Rehacerla y guardarla con sustituye=${i.id}.`);
    // Their task for it is over (or there's none): the redo goes to their queue.
    const t = task(i.taskId);
    if (!t || t.status === 'review' || t.status === 'done' || t.assigneeId !== maker.id) {
      addTask({ title: `Rehacer «${i.title.slice(0, 90)}»`, role: maker.role, hours: 1, ongoing: false, who: maker });
    }
    notify('change');
    return 'back';
  }
  if (decision === 'descartar') {
    Object.assign(i, { status: 'dropped', holder: w.id });
    step(i, w.id, 'dropped', note || 'No aporta.');
    if (maker && maker !== w) remember(maker, `${w.name} descartó «${i.title}»: ${note}`);
    notify('change');
    return 'dropped';
  }
  // Up, maybe improved.
  const title = str(d.titulo, 120);
  const text = str(d.contenido, MAX_TEXT);
  const better = (title.length >= 3 && title !== i.title) || (text.length > 20 && text !== i.text);
  if (title.length >= 3) i.title = title;
  if (text.length > 20 && text !== i.text) {
    i.text = text;
    // The file goes with the words: a new one with the improved text, the pictures stay.
    const file = asFile(i.kind, i.title, text);
    if (file) i.files = [...(i.files ?? []).filter((f) => f.kind === 'image'), ...file];
  }
  step(i, w.id, better ? 'better' : 'up', note + (backs >= MAX_BACKS && str(d.decision, 20).toLowerCase() === 'devolver' ? ' (pasa con reservas)' : ''));
  moveUp(i, w);
  return 'up';
}

/** Old ones go, so the state stays light: never what's on its way, never what you starred. */
function prune(): void {
  const st = getState();
  const cut = (list: Item[], keep: number) => new Set(list.slice(0, Math.max(0, list.length - keep)));
  const gone = cut(st.items.filter((i) => i.status === 'dropped' || i.status === 'replaced'), KEEP_GONE);
  const done = cut(st.items.filter((i) => (i.status === 'delivered' || i.status === 'archived') && !i.starred), KEEP_DONE);
  if (gone.size || done.size) st.items = st.items.filter((i) => !gone.has(i) && !done.has(i));
}
