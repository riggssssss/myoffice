/**
 * The art director's eye. Every reference picture you send them (in their chat or from their
 * Estilo tab) is kept for good and analysed like a production crew would, to shoot it again
 * tomorrow: light, colour grading, camera, scene, materials, what makes it work. From all of them
 * they keep a living style guide (your liked ones weigh double; the disliked ones teach what to
 * avoid), which their team works to and which goes into every picture the office makes.
 */
import { randomBytes } from 'node:crypto';
import { getState, worker } from '../src/sim/ops';
import { VISUAL_ROLES } from '../src/sim/seed';
import { GUIDE_LINES, isHex, MAX_REFS, STYLE_SECTIONS, type RefAnalysis, type StyleGuide, type StyleRef, type StyleSection, type StyleView, type Swatch } from '../src/sim/style';
import type { Worker } from '../src/sim/types';
import { brainOf, eyesFor, overDailyCap, spend, systemFor } from './agents';
import { getJson, setJson } from './db';
import { fileInfo, imageData, pinFile } from './files';
import { LlmError, think, type Brain } from './llm';
import { briefText, parseJson } from './meetings';
import { redact } from './vault';

let notifier: () => void = () => {};
/** Browsers showing the Estilo tab hear about every change. */
export function setStyleNotifier(fn: () => void): void {
  notifier = fn;
}

const refs = (): StyleRef[] => getJson<StyleRef[]>('refs') ?? [];
function saveRefs(list: StyleRef[]): void {
  setJson('refs', list);
  notifier();
}
const guide = (): StyleGuide | null => getJson<StyleGuide>('style:guide') ?? null;
function saveGuide(g: StyleGuide): void {
  const before = guide();
  if (before) setJson('style:guide:prev', before);
  setJson('style:guide', g);
  notifier();
}

let thinking = false;

export function styleView(): StyleView {
  return { refs: refs(), guide: guide(), thinking, director: artDirector()?.id ?? null };
}

/** Who leads the look: the art director (the one with a team, if there are several). */
export function artDirector(): Worker | undefined {
  const st = getState();
  const arts = st.workers.filter((w) => w.role === 'art');
  return arts.find((w) => st.workers.some((o) => o.reportsTo === w.id)) ?? arts[0];
}

/** Their work is visual, or they're in the art director's team. */
export function isArtTeam(w: Worker): boolean {
  return VISUAL_ROLES.has(w.role) || w.team === 'arte' || (!!w.reportsTo && w.reportsTo === artDirector()?.id);
}

// ---------------------------------------------------------------- references

const cleanSwatches = (v: unknown): Swatch[] =>
  (Array.isArray(v) ? v : [])
    .filter((s): s is Swatch => !!s && isHex((s as Swatch).hex) && typeof (s as Swatch).share === 'number' && (s as Swatch).share >= 0 && (s as Swatch).share <= 1)
    .slice(0, 8)
    .map((s) => ({ hex: s.hex.toLowerCase(), share: Math.round(s.share * 1000) / 1000 }));

/** Colours measured in the browser when a picture is sent (kept until it becomes a reference). */
export function rememberPalette(fileId: string, palette: unknown): void {
  const p = cleanSwatches(palette);
  if (p.length) setJson(`palette:${fileId}`, p);
}

/** A picture becomes a reference: kept for good and queued for analysis. */
export function addRef(fileId: string, from: StyleRef['from'], palette?: unknown, note = ''): StyleRef | string {
  const f = fileInfo(fileId);
  if (!f || f.kind !== 'image') return 'Solo se pueden guardar imágenes como referencia';
  const list = refs();
  const have = list.find((r) => r.fileId === fileId);
  if (have) return have;
  const ref: StyleRef = {
    id: `r${randomBytes(5).toString('hex')}`,
    fileId,
    name: f.name,
    from,
    at: Date.now(),
    note: note.slice(0, 300),
    verdict: null,
    palette: cleanSwatches(palette).length ? cleanSwatches(palette) : (getJson<Swatch[]>(`palette:${fileId}`) ?? []),
    status: 'pending',
    analysis: null,
  };
  list.unshift(ref);
  // Too many: the oldest one you haven't marked goes (its file can be tidied away again).
  if (list.length > MAX_REFS) {
    const i = list.map((r) => r.verdict).lastIndexOf(null);
    const [gone] = list.splice(i >= 0 ? i : list.length - 1, 1);
    pinFile(gone.fileId, false);
  }
  pinFile(fileId, true);
  saveRefs(list);
  queue();
  return ref;
}

/** Pictures you sent the art director in their chat. */
export function refsFromChat(workerId: string, fileIds: unknown): void {
  if (worker(workerId)?.role !== 'art' || !Array.isArray(fileIds)) return;
  for (const id of fileIds) if (typeof id === 'string' && fileInfo(id)?.kind === 'image') addRef(id, 'chat');
}

export function updateRef(id: string, patch: { verdict?: unknown; note?: unknown; palette?: unknown }): string | null {
  const list = refs();
  const r = list.find((x) => x.id === id);
  if (!r) return 'Esa referencia ya no está';
  let rethink = false;
  if ('verdict' in patch && (patch.verdict === 'like' || patch.verdict === 'dislike' || patch.verdict === null)) {
    rethink = r.verdict !== patch.verdict;
    r.verdict = patch.verdict;
  }
  if (typeof patch.note === 'string') r.note = patch.note.slice(0, 300);
  if (patch.palette !== undefined && !r.palette.length) r.palette = cleanSwatches(patch.palette);
  saveRefs(list);
  if (rethink && r.status === 'ready') rewriteSoon();
  return null;
}

export function removeRef(id: string): void {
  const list = refs();
  const r = list.find((x) => x.id === id);
  if (!r) return;
  pinFile(r.fileId, false);
  saveRefs(list.filter((x) => x !== r));
  if (r.status === 'ready') rewriteSoon();
}

export function retryRef(id: string): void {
  const list = refs();
  const r = list.find((x) => x.id === id);
  if (!r || r.status === 'analyzing') return;
  Object.assign(r, { status: 'pending', error: undefined });
  saveRefs(list);
  queue();
}

// ---------------------------------------------------------------- analysis

/** The AIs that look at references: the art director's that see, else your keys'. */
function eyes(): Brain[] | string {
  const who = artDirector() ?? getState().workers.find((w) => w.reportsTo === null);
  const brains = who ? brainOf(who) : 'No hay nadie en la oficina';
  const list = eyesFor(typeof brains === 'string' ? [] : brains, true);
  if (!list.length) return 'Para analizar referencias hace falta una IA que vea imágenes: Claude, o una clave de Groq o NVIDIA (Ajustes → IA)';
  return list;
}

const ANALYST = `Eres directora de arte y de fotografía con veinte años en campañas de producto, editorial y branding. Analizas una imagen de referencia como lo haría un equipo de producción que tiene que repetirla mañana en estudio. Técnica, concreta y verificable: lo que se ve, no adjetivos vacíos («luz cenital difusa con rebote cálido a la izquierda», no «luz bonita»). Si algo no se distingue, escribe «no se aprecia»: no inventes. Todo en español de España salvo promptEn.`;

const SHAPE = `Devuelve SOLO este JSON (cadenas cortas y precisas):
{
 "summary": "qué es y por qué funciona, 1-2 frases",
 "composition": {"shot": "plano (detalle, medio, general…)", "angle": "ángulo de cámara (cenital, 3/4, a la altura…)", "lens": "sensación de objetivo y focal equivalente estimada en mm", "depthOfField": "profundidad de campo y qué está a foco", "layout": "regla de composición, simetría, líneas, peso visual", "negativeSpace": "uso del espacio vacío"},
 "lighting": {"key": "luz principal: tipo, posición (en reloj y altura) y tamaño aparente", "fill": "relleno o rebotes", "rim": "contraluz o recorte", "hardness": "dura/difusa y transición de sombras", "colorTemp": "temperatura aproximada en K y mezcla", "timeOfDay": "hora del día si es natural, o «estudio»", "shadows": "forma, densidad y dirección de las sombras", "reflections": "reflejos y brillos especulares"},
 "color": {"palette": ["4-8 colores con nombre"], "contrast": "curva: negros levantados, altas comprimidas…", "saturation": "nivel y dónde", "whiteBalance": "neutro, cálido, frío…", "grading": "etalonaje o emulación de película (p. ej. Portra 400, Kodachrome) si se intuye", "grain": "grano o ruido"},
 "materials": ["materiales y texturas visibles"],
 "scene": {"setting": "localización o set", "props": ["atrezo"], "styling": "estilismo y disposición"},
 "mood": "la emoción o historia en una frase",
 "typography": "tipografía si la hay (familia aproximada, peso, composición) o «sin texto»",
 "works": ["3-5 razones concretas por las que funciona"],
 "avoid": ["2-4 cosas que romperían este estilo"],
 "tags": ["3-6 etiquetas cortas"],
 "promptEn": "one English style fragment, max 70 words, NO subject: lighting, lens, palette, grading, set, mood — so an image model can reproduce this look"
}`;

// Some free models slip in a word in Chinese or Japanese now and then: it goes.
const str = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]+/g, '').trim().replace(/\s+/g, ' ').slice(0, max) : '';
const strs = (v: unknown, max: number, n = 8) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

function cleanAnalysis(j: Record<string, unknown>): RefAnalysis | null {
  const c = obj(j.composition);
  const l = obj(j.lighting);
  const k = obj(j.color);
  const s = obj(j.scene);
  const a: RefAnalysis = {
    summary: str(j.summary, 400),
    composition: { shot: str(c.shot, 200), angle: str(c.angle, 200), lens: str(c.lens, 200), depthOfField: str(c.depthOfField, 200), layout: str(c.layout, 300), negativeSpace: str(c.negativeSpace, 200) },
    lighting: {
      key: str(l.key, 300), fill: str(l.fill, 200), rim: str(l.rim, 200), hardness: str(l.hardness, 200), colorTemp: str(l.colorTemp, 200),
      timeOfDay: str(l.timeOfDay, 120), shadows: str(l.shadows, 300), reflections: str(l.reflections, 200),
    },
    color: { palette: strs(k.palette, 60), contrast: str(k.contrast, 200), saturation: str(k.saturation, 200), whiteBalance: str(k.whiteBalance, 120), grading: str(k.grading, 300), grain: str(k.grain, 120) },
    materials: strs(j.materials, 120),
    scene: { setting: str(s.setting, 300), props: strs(s.props, 100), styling: str(s.styling, 300) },
    mood: str(j.mood, 300),
    typography: str(j.typography, 300),
    works: strs(j.works, 220, 5),
    avoid: strs(j.avoid, 220, 4),
    tags: strs(j.tags, 40, 6),
    promptEn: str(j.promptEn, 520),
  };
  return a.summary && (a.lighting.key || a.color.palette.length) ? a : null;
}

let analysing = false;

/** One reference at a time, oldest first, while there are any waiting. */
function queue(): void {
  if (analysing) return;
  const list = refs();
  const next = [...list].reverse().find((r) => r.status === 'pending');
  if (!next) return;
  if (overDailyCap()) return;
  const brains = eyes();
  if (typeof brains === 'string') {
    Object.assign(next, { status: 'failed', error: brains });
    saveRefs(list);
    return;
  }
  const pic = imageData(next.fileId);
  if (!pic) {
    Object.assign(next, { status: 'failed', error: 'La imagen pesa más de 3,5 MB o ya no está: súbela otra vez más pequeña' });
    saveRefs(list);
    return queue();
  }
  analysing = true;
  next.status = 'analyzing';
  saveRefs(list);
  const g = guide();
  const prompt = [
    briefText() ? `El producto (para entender para qué sirve la referencia; no lo describas):\n${briefText().slice(0, 1500)}` : '',
    next.note ? `Lo que dice el propietario de ella: «${next.note}»` : '',
    next.palette.length ? `Colores medidos en la imagen (exactos): ${next.palette.map((p) => `${p.hex} ${Math.round(p.share * 100)} %`).join(', ')}.` : '',
    g ? `Guía de estilo actual, por si encaja o la contradice:\n${g.prompt}` : '',
    '',
    SHAPE,
  ]
    .filter(Boolean)
    .join('\n');
  void think(brains, ANALYST, prompt, [], async () => '', { maxRounds: 0, maxTokens: 1800, pictures: [pic] })
    .then((out) => {
      spend(out.tokens);
      const j = parseJson(out.text);
      const analysis = j ? cleanAnalysis(j) : null;
      if (!analysis) throw new LlmError('La IA no devolvió un análisis válido: dale a Reintentar', 0);
      return { analysis, model: brains[0].model };
    })
    .then(({ analysis, model }) => {
      const now = refs();
      const r = now.find((x) => x.id === next.id);
      if (!r) return;
      Object.assign(r, { status: 'ready', analysis, model, error: undefined });
      saveRefs(now);
      rewriteSoon();
    })
    .catch((e) => {
      const now = refs();
      const r = now.find((x) => x.id === next.id);
      if (r) Object.assign(r, { status: 'failed', error: redact(e instanceof Error ? e.message : 'No se pudo analizar') });
      saveRefs(now);
    })
    .finally(() => {
      analysing = false;
      queue();
    });
}

/** After a restart: anything left half-way goes back in the queue. */
export function resumeStyle(): void {
  const list = refs();
  let changed = false;
  for (const r of list) if (r.status === 'analyzing') (r.status = 'pending'), (changed = true);
  if (changed) saveRefs(list);
  queue();
}

// ---------------------------------------------------------------- the guide

let rewriteTimer: ReturnType<typeof setTimeout> | null = null;
/** A while after the last change (several pictures arrive together), the guide is rewritten once. */
function rewriteSoon(full = false): void {
  if (rewriteTimer) clearTimeout(rewriteTimer);
  rewriteTimer = setTimeout(() => {
    rewriteTimer = null;
    void rewrite(full);
  }, full ? 0 : 20_000);
}

const compact = (r: StyleRef) => {
  const a = r.analysis!;
  return [
    `[${r.verdict === 'like' ? 'LE GUSTA ×2' : r.verdict === 'dislike' ? 'NO LE GUSTA → solo para Evitar' : 'neutra'}] ${a.summary}`,
    r.note ? `  nota del propietario: ${r.note}` : '',
    `  luz: ${[a.lighting.key, a.lighting.fill, a.lighting.rim, a.lighting.hardness, a.lighting.colorTemp, a.lighting.shadows].filter(Boolean).join(' · ')}`,
    `  color: ${[a.color.palette.join(', '), a.color.contrast, a.color.saturation, a.color.whiteBalance, a.color.grading, a.color.grain].filter(Boolean).join(' · ')}`,
    r.palette.length ? `  medidos: ${r.palette.map((p) => p.hex).join(' ')}` : '',
    `  cámara: ${[a.composition.shot, a.composition.angle, a.composition.lens, a.composition.depthOfField, a.composition.layout].filter(Boolean).join(' · ')}`,
    `  escena: ${[a.scene.setting, a.scene.props.join(', '), a.scene.styling, a.materials.join(', ')].filter(Boolean).join(' · ')}`,
    a.typography ? `  tipografía: ${a.typography}` : '',
    `  funciona: ${a.works.join('; ')}`,
    `  evitar: ${a.avoid.join('; ')}`,
    `  prompt: ${a.promptEn}`,
  ]
    .filter(Boolean)
    .join('\n');
};

/** Colours the liked and neutral references share, weighted, measured (not guessed). */
function mergePalettes(list: StyleRef[]): string[] {
  const pool: { rgb: [number, number, number]; w: number }[] = [];
  const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  const near = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 28;
  for (const r of list) {
    if (r.verdict === 'dislike') continue;
    for (const s of r.palette) {
      const c = rgb(s.hex);
      const w = s.share * (r.verdict === 'like' ? 2 : 1);
      const hit = pool.find((p) => near(p.rgb, c));
      if (hit) {
        const t = hit.w + w;
        hit.rgb = hit.rgb.map((v, i) => (v * hit.w + c[i] * w) / t) as [number, number, number];
        hit.w = t;
      } else pool.push({ rgb: c, w });
    }
  }
  return pool
    .sort((a, b) => b.w - a.w)
    .slice(0, 8)
    .map((p) => `#${p.rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`);
}

const emptySections = (): Record<StyleSection, string[]> => Object.fromEntries(STYLE_SECTIONS.map((s) => [s.id, []])) as unknown as Record<StyleSection, string[]>;

async function rewrite(full: boolean): Promise<void> {
  if (thinking || overDailyCap()) return;
  const ready = refs().filter((r) => r.status === 'ready' && r.analysis);
  const before = guide();
  if (!ready.length) return;
  const who = artDirector() ?? getState().workers.find((w) => w.reportsTo === null);
  const brains = who ? brainOf(who) : 'Sin nadie';
  if (typeof brains === 'string' || !who) return;
  // New since the last version (or all of them, for «Rehacer»), the liked ones first.
  const used = new Set(before?.basedOn ?? []);
  const fresh = (full || !before ? ready : ready.filter((r) => !used.has(r.id) || r.verdict !== null)).sort(
    (a, b) => Number(b.verdict === 'like') - Number(a.verdict === 'like'),
  );
  const pick = fresh.slice(0, full ? 20 : 12);
  if (!pick.length && !full) return;
  thinking = true;
  notifier();
  try {
    const locked = before?.owner ?? {};
    const current = before && !full
      ? STYLE_SECTIONS.map((s) => `${s.label}:\n${before.sections[s.id].map((l) => `- ${(locked[s.id] ?? []).includes(l) ? '[FIJADA] ' : ''}${l}`).join('\n') || '- (vacía)'}`).join('\n') + `\nPrompt: ${before.prompt}`
      : '';
    const out = await think(
      brains,
      `${systemFor(who)}\n\nAhora escribes la guía de estilo visual de la oficina a partir de las referencias analizadas: es lo que tu equipo seguirá y lo que se añade a cada imagen que se genera.`,
      [
        current ? `Guía actual (mézclala con lo nuevo; no la reescribas de cero; las líneas [FIJADA] las escribió el propietario: consérvalas tal cual):\n${current}` : 'Aún no hay guía: escríbela.',
        '',
        `Referencias ${full ? '(todas las que hay)' : 'nuevas o que el propietario ha valorado'}:`,
        pick.map(compact).join('\n\n'),
        '',
        'Reglas:',
        `- Cada sección, como mucho ${GUIDE_LINES} líneas, cada una de máx. 160 caracteres, concretas y accionables («luz principal difusa a 45° desde la izquierda, sombras suaves y abiertas»), sin adjetivos vacíos.`,
        '- Lo que se repite en varias referencias pesa más; las que le gustan, el doble. Si se contradicen, manda lo que le gusta. Las que no le gustan solo alimentan «evitar».',
        '- tipografia vacía si ninguna referencia tiene texto.',
        '- prompt: un bloque en inglés (máx. 600 caracteres) que reproduzca el estilo en un modelo de imagen: luz, cámara/objetivo, paleta, etalonaje, set y mood. Sin sujeto ni producto.',
        'Responde SOLO JSON: {"luz":[],"color":[],"composicion":[],"escena":[],"materiales":[],"tipografia":[],"evitar":[],"prompt":"…"}',
      ].join('\n'),
      [],
      async () => '',
      { maxRounds: 0, maxTokens: 1600 },
    );
    spend(out.tokens);
    const j = parseJson(out.text);
    if (!j) return;
    const sections = emptySections();
    for (const s of STYLE_SECTIONS) {
      // Your lines stay, even if the model dropped them; then theirs, without repeats.
      const mine = locked[s.id] ?? [];
      const theirs = strs(j[s.id], 160, GUIDE_LINES).filter((l) => !mine.some((m) => m.toLowerCase() === l.toLowerCase()));
      sections[s.id] = [...mine, ...theirs].slice(0, Math.max(GUIDE_LINES, mine.length));
    }
    const prompt = before?.ownerPrompt ? before.prompt : str(j.prompt, 700);
    if (!prompt && !Object.values(sections).some((l) => l.length)) return;
    saveGuide({
      version: (before?.version ?? 0) + 1,
      at: Date.now(),
      sections,
      prompt: prompt || before?.prompt || '',
      palette: mergePalettes(ready),
      owner: locked,
      ownerPrompt: before?.ownerPrompt ?? false,
      basedOn: ready.map((r) => r.id),
    });
  } catch {
    /* it tries again with the next change */
  } finally {
    thinking = false;
    notifier();
  }
}

export function rebuildGuide(): string | null {
  if (!refs().some((r) => r.status === 'ready')) return 'Aún no hay referencias analizadas';
  rewriteSoon(true);
  return null;
}

/** Your edit: what you wrote stays fixed (the art director keeps it as it is). */
export function editGuide(body: unknown): string | null {
  const b = obj(body);
  const sec = obj(b.sections);
  const before = guide();
  const sections = emptySections();
  const owner: Partial<Record<StyleSection, string[]>> = {};
  for (const s of STYLE_SECTIONS) {
    const lines = strs(sec[s.id], 200, 12);
    sections[s.id] = lines;
    // Lines that weren't there before (or changed) are yours.
    const had = new Set(before?.sections[s.id] ?? []);
    const mine = [...(before?.owner[s.id] ?? []).filter((l) => lines.includes(l)), ...lines.filter((l) => !had.has(l))];
    if (mine.length) owner[s.id] = [...new Set(mine)];
  }
  const prompt = str(b.prompt, 700);
  saveGuide({
    version: (before?.version ?? 0) + 1,
    at: Date.now(),
    sections,
    prompt,
    palette: before?.palette ?? mergePalettes(refs()),
    owner,
    ownerPrompt: !!prompt && prompt !== before?.prompt ? true : (before?.ownerPrompt ?? false),
    basedOn: before?.basedOn ?? [],
  });
  return null;
}

export function undoGuide(): string | null {
  const prev = getJson<StyleGuide>('style:guide:prev');
  if (!prev) return 'No hay una versión anterior';
  const now = guide();
  setJson('style:guide', prev);
  if (now) setJson('style:guide:prev', now);
  notifier();
  return null;
}

// ---------------------------------------------------------------- for the agents

const guideLines = (g: StyleGuide, per: number) =>
  STYLE_SECTIONS.filter((s) => g.sections[s.id].length)
    .map((s) => `${s.label}: ${g.sections[s.id].slice(0, per).join('; ')}`)
    .join('\n');

/** The guide as the art team carries it (in full for the art director). */
export function styleFor(w: Worker, full = false): string {
  const g = guide();
  if (!g || !(full || isArtTeam(w))) return '';
  return `Guía de estilo de la oficina (v${g.version}; manda sobre tus gustos):\n${guideLines(g, full ? GUIDE_LINES : 3)}${g.palette.length ? `\nPaleta medida: ${g.palette.join(' ')}` : ''}`;
}

/** The English style block that goes into every picture. */
export const stylePrompt = (): string | null => guide()?.prompt || null;

export function guideText(): string {
  const g = guide();
  if (!g) return 'Aún no hay guía de estilo: se escribe sola cuando el propietario manda referencias a dirección de arte.';
  const liked = refs()
    .filter((r) => r.verdict === 'like' && r.analysis)
    .slice(0, 5)
    .map((r) => `- ${r.analysis!.summary}`);
  return [
    `Guía de estilo v${g.version}:`,
    guideLines(g, GUIDE_LINES),
    g.palette.length ? `Paleta medida: ${g.palette.join(' ')}` : '',
    `Bloque para imágenes (inglés): ${g.prompt}`,
    liked.length ? `Referencias que le gustan:\n${liked.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export const STYLE_TOOLS = {
  guide: { name: 'ver_guia_estilo', description: 'La guía de estilo visual de la oficina (luz, color, cámara, escena, materiales, qué evitar) y su paleta.', parameters: { type: 'object', properties: {} } },
  review: {
    name: 'revisar_imagen',
    description: 'Revisa una imagen del chat (la última, o la que digas) contra la guía de estilo: notas por apartado, qué está bien, qué falla y cómo arreglarlo, con un prompt corregido.',
    parameters: {
      type: 'object',
      properties: {
        archivo: { type: 'string', description: 'nombre o parte del nombre de la imagen; vacío = la más reciente' },
        foco: { type: 'string', description: 'en qué fijarse sobre todo (opcional)' },
      },
    },
  },
} as const;

/** The pictures in everyone's chats, newest first (what can be reviewed). */
function chatPictures(): { id: string; name: string }[] {
  const out: { id: string; name: string; at: number }[] = [];
  for (const w of getState().workers) for (const l of w.chat?.lines ?? []) for (const f of l.files ?? []) if (f.kind === 'image') out.push({ id: f.id, name: f.name, at: l.at });
  return out.sort((a, b) => b.at - a.at).slice(0, 30);
}

export async function reviewImage(me: Worker, args: Record<string, unknown>): Promise<{ result: string; note: string }> {
  const want = str(args.archivo, 120).toLowerCase();
  const list = chatPictures();
  const pic = want ? list.find((p) => p.id === want || p.name.toLowerCase().includes(want)) : list[0];
  if (!pic) return { note: 'no encontró la imagen', result: 'No hay ninguna imagen así en los chats.' };
  const data = imageData(pic.id);
  if (!data) return { note: 'no pudo abrir la imagen', result: 'La imagen pesa demasiado para revisarla.' };
  const brains = brainOf(me);
  const seeing = eyesFor(typeof brains === 'string' ? [] : brains, true);
  if (!seeing.length) return { note: 'no puede ver imágenes', result: 'Ninguna IA tuya ve imágenes: hace falta Claude o una clave de Groq o NVIDIA.' };
  const out = await think(
    seeing,
    systemFor(me),
    [
      guideText(),
      args.foco ? `Fíjate sobre todo en: ${str(args.foco, 200)}` : '',
      '',
      'Revisa la imagen adjunta contra la guía como directora de arte exigente pero útil. Concreto y verificable.',
      'Responde SOLO JSON: {"veredicto":"encaja|casi|no encaja","puntos":{"luz":1-10,"color":1-10,"composicion":1-10,"escena":1-10,"acabado":1-10},"bien":["…"],"mal":["…"],"arreglos":["…"],"prompt_corregido":"English prompt that fixes it"}',
    ]
      .filter(Boolean)
      .join('\n'),
    [],
    async () => '',
    { maxRounds: 0, maxTokens: 900, pictures: [data] },
  );
  spend(out.tokens);
  const j = parseJson(out.text);
  if (!j) return { note: `revisó ${pic.name}`, result: out.text.slice(0, 1500) };
  const p = obj(j.puntos);
  return {
    note: `revisó ${pic.name}`,
    result: [
      `${pic.name}: ${str(j.veredicto, 20) || 'sin veredicto'}`,
      `Notas: ${['luz', 'color', 'composicion', 'escena', 'acabado'].map((k) => `${k} ${Number(p[k]) || '?'}/10`).join(', ')}`,
      `Bien: ${strs(j.bien, 200).join('; ')}`,
      `Falla: ${strs(j.mal, 200).join('; ')}`,
      `Arreglos: ${strs(j.arreglos, 200).join('; ')}`,
      `Prompt corregido: ${str(j.prompt_corregido, 700)}`,
    ].join('\n'),
  };
}
