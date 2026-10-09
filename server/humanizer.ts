/**
 * The humanizer: takes the machine fingerprint out of a text that goes out in your name (a
 * LinkedIn post) and scores how human what's left sounds. Ported from the «li-human» skill of
 * linkedin-agent-skill by Jake Schincariol (MIT, see data/LICENSE-linkedin-agent-skill), with a
 * Spanish lexicon and Spanish-aware checks. Everything runs here, on the text alone.
 *
 * Cleaning (automatic): invisible characters, typography (em dash, curly quotes, ellipsis…),
 * stock words and phrases. Structures (the «no es solo X, es Y» kind) are only flagged: changing
 * a sentence's shape needs judgement, so it goes back to whoever wrote it.
 *
 * Five checks, 0-100, higher is more human: burstiness (sentence-length variation),
 * specificity (numbers and names), slop (stock vocabulary), fingerprint (characters no keyboard
 * makes) and voice (person, tone, structural tells). The verdict weighs the weakest check at
 * 40 %, because a detector only needs one signal.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface Entry {
  find: string;
  replace: string;
  family: string;
  flag?: boolean;
}
interface Lexicon {
  words: Entry[];
  phrases: Entry[];
}
interface Structure {
  id: string;
  re: RegExp;
  name: string;
  fix: string;
}

const load = (name: string): Lexicon => JSON.parse(readFileSync(fileURLToPath(new URL(`./data/${name}`, import.meta.url)), 'utf8')) as Lexicon;
let lexicons: Record<Lang, Lexicon> | null = null;
const lexicon = (lang: Lang) => (lexicons ??= { es: load('slop.es.json'), en: load('slop.en.json') })[lang];

export type Lang = 'es' | 'en';

const L = '\\p{L}';
/** A whole word or phrase, accents included, any spacing between words. */
const wordRe = (find: string, flags = 'giu') =>
  new RegExp(`(?<![${L}\\d])${find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?![${L}\\d])`, flags);

const INVISIBLE = /[​-‍⁠﻿­᠎؜‎‏\u{E0000}-\u{E007F}]/gu;
const ODD_SPACES = /[      ]/g;
const FORMAT = /\p{Cf}/gu;

const STRUCTURES: Record<Lang, Structure[]> = {
  es: [
    { id: 'no-es-solo', re: /\bno es (?:solo|sólo|solamente|únicamente) [^.!?\n]{2,60}[,.;:] es\b/giu, name: '«No es solo X, es Y»', fix: 'Di lo que de verdad quieres decir y borra la mitad que lo prepara.' },
    { id: 'no-solo-sino', re: /\bno (?:solo|sólo)\b[^.!?\n]{2,80}\bsino (?:también|que)\b/giu, name: '«No solo X, sino también Y»', fix: 'Pártelo en dos frases o quita la mitad más floja.' },
    { id: 'no-se-trata', re: /\bno se trata de [^.!?\n]{2,60}[.,;:] se trata de\b/giu, name: '«No se trata de X. Se trata de Y.»', fix: 'Empieza por Y. El giro es lo que delata.' },
    { id: 'revelacion', re: /^\s*(?:¿?el resultado\??|¿?lo mejor\??|¿?la clave\??|¿?el truco\??|¿?la trampa\??|spoiler:?)\s*$/gimu, name: 'Línea de suspense de una palabra', fix: 'Contéstalo en la misma frase en vez de escenificar la revelación.' },
    { id: 'aprendi', re: /\b(?:esto es lo que (?:he )?aprendí(?:do)?|te cuento lo que (?:he )?aprendí(?:do)?|lo que aprendí:)/giu, name: '«Esto es lo que aprendí»', fix: 'Di la lección directamente, sin anunciarla.' },
    { id: 'triada', re: /(?<![\p{L}])[\p{L}]+, [\p{L}]+ y [\p{L}]+\./gu, name: 'Trío de tres (a, b y c.)', fix: 'Dos o cuatro. Tres es el ritmo por defecto de una IA.' },
    { id: 'emojis', re: /[\u{1F680}\u{1F525}\u{1F4A1}✨\u{1F3AF}\u{1F9F5}\u{1F447}]/gu, name: 'Emojis de cohete, fuego, bombilla, chispas, diana, hilo o dedo abajo', fix: 'Un emoji como mucho, y no de estos.' },
    { id: 'hashtags', re: /(?:#[\p{L}\d_]+[ \t]*){5,}/gu, name: 'Muro de hashtags (5 o más)', fix: 'Tres hashtags como mucho.' },
    { id: 'como-ia', re: /\bcomo (?:una )?(?:ia|inteligencia artificial|modelo de lenguaje)\b/giu, name: 'La IA hablando de sí misma', fix: 'Borra la frase.' },
    { id: 'cierre', re: /^\s*(?:en resumen|en conclusión|para concluir|en definitiva|resumiendo)\b/gimu, name: 'Cierre de redacción escolar', fix: 'Un post no necesita párrafo de conclusión.' },
    { id: 'cebo', re: /(?:¿qué opinas\?|¿estás de acuerdo\?|¿te ha pasado\?|¿y tú\?|¿quién más\b[^?\n]*\?|te leo en (?:los )?comentarios|cuéntamelo en (?:los )?comentarios)\s*$/gimu, name: 'Pregunta cebo de comentarios', fix: 'Haz una pregunta que solo tú podrías hacer, sobre lo concreto de arriba.' },
  ],
  en: [
    { id: 'not-just', re: /\bit'?s not (?:just|only) [^.!?\n]{2,60}[,.] it'?s\b/gi, name: '"It\'s not just X, it\'s Y"', fix: 'Say the one thing you actually mean. Delete the setup half.' },
    { id: 'not-only', re: /\bnot only\b[^.!?\n]{2,80}\bbut also\b/gi, name: '"Not only X but also Y"', fix: 'Split into two sentences, or drop the weaker half.' },
    { id: 'isnt-about', re: /\b(?:this|it) is(?:n'?t| not) about [^.!?\n]{2,60}[.!] it'?s about\b/gi, name: '"It isn\'t about X. It\'s about Y."', fix: 'Lead with Y. The reversal is the tell.' },
    { id: 'the-result', re: /^\s*(?:the result|the best part|the kicker|the catch)\?\s*$/gim, name: 'One-word rhetorical question line', fix: 'Answer it inline instead of staging a reveal.' },
    { id: 'heres-what', re: /\bhere'?s what (?:i|we) learned\b/gi, name: '"Here\'s what I learned"', fix: 'State the lesson. Skip the announcement.' },
    { id: 'triad', re: /\b\w+, \w+, and \w+\./gi, name: 'Rule-of-three triad', fix: 'Two items or four. Three is the model\'s default rhythm.' },
    { id: 'rocket', re: /[\u{1F680}\u{1F525}\u{1F4A1}✨\u{1F3AF}]/gu, name: 'Rocket / fire / bulb / sparkle / dart emoji', fix: 'One emoji max, and not one of these five.' },
    { id: 'hashtag-wall', re: /(?:#\w+[ \t]*){5,}/g, name: 'Hashtag wall (5+)', fix: 'Three hashtags. LinkedIn stopped rewarding the wall.' },
    { id: 'as-an-ai', re: /\bas an ai\b|\bas a language model\b/gi, name: 'Model self-reference', fix: 'Delete the sentence.' },
    { id: 'in-summary', re: /^\s*(?:in summary|to summarize|in conclusion)\b/gim, name: 'Essay-closer opener', fix: 'A post does not need a conclusion paragraph.' },
    { id: 'engagement-bait', re: /\b(?:agree\?|thoughts\?|who else\b|am i wrong\?)\s*$/gim, name: 'Reflex engagement bait', fix: 'Ask a question only you could ask, about the specific thing above it.' },
  ],
};

const STOP: Record<Lang, RegExp> = {
  es: /(?<![\p{L}])(?:que|de|el|la|los|las|y|en|por|para|con|una|es|lo|del|al|pero|como|más|muy)(?![\p{L}])/giu,
  en: /\b(?:the|and|of|to|is|in|that|for|with|you|it|this|but|are|was|my|on)\b/gi,
};

export function langOf(text: string): Lang {
  return (text.match(STOP.en)?.length ?? 0) > (text.match(STOP.es)?.length ?? 0) * 1.2 ? 'en' : 'es';
}

// ---------------------------------------------------------------- cleaning

export interface Change {
  what: string;
  count: number;
  to?: string;
}
export interface Flag {
  name: string;
  count: number;
  fix: string;
}

/** Links and emails are never touched: swapped out, then back in. */
function protect(text: string): { text: string; back: (t: string) => string } {
  const found: string[] = [];
  const out = text.replace(/https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+/g, (m) => `\u0000${found.push(m) - 1}\u0000`);
  return { text: out, back: (t) => t.replace(/\u0000(\d+)\u0000/g, (_, i: string) => found[Number(i)]) };
}

function sameCase(src: string, repl: string): string {
  if (!repl) return repl;
  if (src.length > 1 && src === src.toUpperCase()) return repl.toUpperCase();
  if (src[0] === src[0].toUpperCase() && src[0] !== src[0].toLowerCase()) return repl[0].toUpperCase() + repl.slice(1);
  return repl;
}

function cleanInvisible(text: string, changes: Change[]): string {
  const inv = text.match(INVISIBLE)?.length ?? 0;
  if (inv) changes.push({ what: 'caracteres invisibles', count: inv, to: 'borrados' });
  text = text.replace(INVISIBLE, '');
  const sp = text.match(ODD_SPACES)?.length ?? 0;
  if (sp) changes.push({ what: 'espacios especiales (no separables, finos…)', count: sp, to: 'espacio normal' });
  text = text.replace(ODD_SPACES, ' ');
  const other = text.match(FORMAT)?.length ?? 0;
  if (other) changes.push({ what: 'otros caracteres de formato invisibles', count: other, to: 'borrados' });
  return text.replace(FORMAT, '');
}

function cleanTypography(text: string, changes: Change[]): string {
  const count = (re: RegExp) => text.match(re)?.length ?? 0;
  const note = (what: string, n: number, to: string) => n && changes.push({ what, count: n, to });
  note('rayas largas (—)', count(/—/g), 'coma');
  text = text.replace(/\s*—\s*/g, ', ');
  note('guiones medios (–)', count(/–/g), 'guion');
  text = text.replace(/\s*–\s*(?=\d)/g, '-').replace(/\s+–\s+/g, ', ').replace(/–/g, '-');
  note('comillas curvas', count(/[‘’“”′]/g), 'comillas rectas');
  text = text.replace(/[‘’′]/g, "'").replace(/[“”]/g, '"');
  note('puntos suspensivos de un carácter (…)', count(/…/g), '...');
  text = text.replace(/…/g, '...');
  note('viñetas • y puntos medios ·', count(/[•·]/g), 'guion');
  text = text.replace(/[•·]/g, '-');
  // A comma that landed before other punctuation reads wrong.
  return text.replace(/,\s*([,.;:!?])/g, '$1').replace(/,\s*\n/g, '\n');
}

function cleanLexicon(text: string, lang: Lang, changes: Change[]): string {
  const lex = lexicon(lang);
  // Longest first, so phrases win over the words inside them.
  for (const e of [...lex.phrases, ...lex.words].sort((a, b) => b.find.length - a.find.length)) {
    if (e.flag) continue;
    const re = wordRe(e.find);
    const n = text.match(re)?.length ?? 0;
    if (!n) continue;
    changes.push({ what: `«${e.find}»`, count: n, to: e.replace ? `«${e.replace}»` : 'borrado' });
    text = text.replace(re, (m) => sameCase(m, e.replace));
  }
  // Tidy what deletions left behind.
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]*[,.;:]\s*/gm, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    // Quotes left empty by a deletion go too.
    .replace(/(["«'])\s*(["»'])/g, (m, o: string, c: string) => (o + c === '""' || o + c === '«»' || o + c === "''" ? '' : m))
    .replace(/[ \t]{2,}/g, ' ')
    // A sentence that lost its opener starts with a small letter: capitalise it.
    .replace(/(^|[.!?¡¿]\s+|\n)([a-záéíóúñ])/g, (_, a: string, b: string) => a + b.toUpperCase());
}

const SENT = /[^.!?\n]+[.!?]*/g;
const sentences = (t: string) => (t.match(SENT) ?? []).map((s) => s.trim()).filter((s) => s.split(/\s+/).length > 2);
const wordsOf = (t: string) => t.match(/[\p{L}']+/gu) ?? [];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

export function structures(text: string, lang: Lang): Flag[] {
  const flags: Flag[] = [];
  for (const s of STRUCTURES[lang]) {
    const n = text.match(s.re)?.length ?? 0;
    if (n) flags.push({ name: s.name, count: n, fix: s.fix });
  }
  const lens = sentences(text).map((s) => s.split(/\s+/).length);
  if (lens.length >= 4) {
    const cv = sd(lens) / mean(lens);
    if (cv < 0.35)
      flags.push(
        lang === 'es'
          ? { name: `Frases de largo uniforme (variación ${cv.toFixed(2)})`, count: lens.length, fix: 'Parte una frase en dos y deja otra larga. Las máquinas escriben parejo.' }
          : { name: `Uniform sentence length (variation ${cv.toFixed(2)})`, count: lens.length, fix: 'Break one sentence in half. Let another run long. Machines write even.' },
      );
  }
  return flags;
}

// ---------------------------------------------------------------- scoring

const clamp = (n: number) => Math.max(0, Math.min(100, n));
/** Maps a value onto 0-100: `human` → 100, `machine` → 0. */
const scale = (v: number, human: number, machine: number) => clamp(((v - machine) / (human - machine)) * 100);

export interface Check {
  id: 'variedad' | 'concrecion' | 'muletillas' | 'huella' | 'voz';
  label: string;
  score: number;
  detail: string;
}
export interface Score {
  lang: Lang;
  checks: Check[];
  score: number;
  verdict: 'pasa' | 'revisar' | 'suena a IA';
  weakest: Check['label'];
}

const PERSON: Record<Lang, RegExp> = {
  es: /(?<![\p{L}])(?:yo|me|mi|mis|conmigo|nosotros|nosotras|nos|nuestro|nuestra|nuestros|nuestras|tú|te|ti|tu|tus|contigo|vosotros|vosotras|os|vuestro|vuestra|usted)(?![\p{L}])/giu,
  en: /\b(?:i|me|my|mine|we|us|our|you|your)\b/gi,
};
/** Words ending in -é/-í that aren't first-person verbs. */
const NOT_VERBS = new Set(['también', 'aquí', 'así', 'allí', 'ahí', 'café', 'bebé', 'comité', 'menú', 'según', 'jamás', 'además', 'después', 'quizá', 'quizás', 'través', 'inglés', 'francés', 'interés', 'estrés', 'cliché', 'bidé', 'puré', 'rubí', 'esquí', 'maniquí', 'colibrí', 'jabalí', 'bisturí', 'frenesí', 'marroquí', 'israelí', 'iraquí', 'paquistaní', 'alhelí']);

/** Spanish has hardly any contractions: everyday markers say the same thing about tone. */
const LOOSE: Record<Lang, RegExp> = {
  es: /(?<![\p{L}])(?:pues|vale|oye|mira|o sea|bueno|ojo|la verdad|al final|ya está|ni de broma|de hecho)(?![\p{L}])/giu,
  en: /\b\w+'(?:s|t|re|ve|ll|d|m)\b/gi,
};

export function score(text: string, lang: Lang = langOf(text)): Score {
  const w = wordsOf(text);
  const per100 = 100 / Math.max(w.length, 1);
  const checks: Check[] = [];

  const lens = sentences(text).map((s) => s.split(/\s+/).length);
  if (lens.length < 4) checks.push({ id: 'variedad', label: 'Variedad', score: 50, detail: 'demasiado corto para juzgarlo' });
  else {
    const cv = sd(lens) / mean(lens);
    checks.push({ id: 'variedad', label: 'Variedad', score: scale(cv, 0.7, 0.22), detail: `variación ${cv.toFixed(2)} en ${lens.length} frases (mejor 0,55+)` });
  }

  if (w.length < 25) checks.push({ id: 'concrecion', label: 'Concreción', score: 50, detail: 'demasiado corto para juzgarlo' });
  else {
    const numbers = text.match(/(?<![\p{L}\d])\d[\d.,]*\s?%?|[$€]\s?\d/gu)?.length ?? 0;
    const names = new Set(text.match(/(?<![.!?¡¿]\s)(?<!^)(?<![\p{L}])[A-ZÁÉÍÓÚÑ][a-záéíóúñü]{2,}/gmu) ?? []).size;
    const density = (numbers + names) * per100;
    checks.push({ id: 'concrecion', label: 'Concreción', score: scale(density, 6, 0.5), detail: `${numbers + names} datos concretos (cifras y nombres), ${density.toFixed(1)} por cada 100 palabras (mejor 4+)` });
  }

  const lex = lexicon(lang);
  let hits = 0;
  const found: string[] = [];
  for (const e of [...lex.words, ...lex.phrases]) {
    const n = text.match(wordRe(e.find))?.length ?? 0;
    if (n) (hits += n), found.push(e.find);
  }
  const slop = (hits * 100) / Math.max(w.length, 1);
  checks.push({
    id: 'muletillas',
    label: 'Muletillas',
    score: w.length ? scale(slop, 0, 4) : 50,
    detail: `${hits} muletilla${hits === 1 ? '' : 's'}, ${slop.toFixed(1)} por cada 100 palabras${found.length ? ` (${found.slice(0, 4).join(', ')}${found.length > 4 ? '…' : ''})` : ''}`,
  });

  const invisible = text.match(FORMAT)?.length ?? 0;
  const em = text.match(/—/g)?.length ?? 0;
  const curly = text.match(/[‘’“”]/g)?.length ?? 0;
  const ellipsis = text.match(/…/g)?.length ?? 0;
  const spaces = text.match(ODD_SPACES)?.length ?? 0;
  const per1k = ((invisible * 4 + em * 2 + curly + ellipsis + spaces) * 1000) / Math.max(text.length, 1);
  checks.push({ id: 'huella', label: 'Huella', score: scale(per1k, 0, 12), detail: `${invisible} invisibles, ${em} rayas, ${curly} comillas curvas, ${ellipsis} «…», ${spaces} espacios raros` });

  if (w.length < 25) checks.push({ id: 'voz', label: 'Voz', score: 50, detail: 'demasiado corto para juzgarlo' });
  else {
    const loose = (text.match(LOOSE[lang])?.length ?? 0) * per100;
    // In Spanish the person is in the verb, not a pronoun: «perdí», «mandé», «aprendí» count too.
    const verbs = lang === 'es' ? w.filter((x) => x.length > 3 && /[éí]$/.test(x) && !NOT_VERBS.has(x.toLowerCase())).length : 0;
    const person = ((text.match(PERSON[lang])?.length ?? 0) + verbs) * per100;
    const tells = structures(text, lang).filter((f) => !/uniform|uniforme/i.test(f.name));
    const nTells = tells.reduce((a, f) => a + f.count, 0);
    const bullets = (text.match(/^\s*[-*•]\s+(.+)$/gm) ?? []).map((b) => b.split(/\s+/).length);
    const uniform = bullets.length >= 3 && sd(bullets) < 1.6;
    // Spanish: everyday markers are a bonus, not a must (contractions are, in English).
    let v =
      lang === 'es'
        ? scale(person, 5, 1) * 0.6 + clamp(100 - nTells * 22) * 0.4 + Math.min(10, loose * 5)
        : scale(loose, 3, 0) * 0.3 + scale(person, 8, 1) * 0.4 + clamp(100 - nTells * 22) * 0.3;
    if (uniform) v -= 12;
    checks.push({
      id: 'voz',
      label: 'Voz',
      score: clamp(v),
      detail: `${person.toFixed(1)} palabras en primera o segunda persona por cada 100, ${nTells} giro${nTells === 1 ? '' : 's'} de IA${uniform ? ', viñetas todas iguales' : ''}`,
    });
  }

  const scores = checks.map((c) => c.score);
  const total = mean(scores) * 0.6 + Math.min(...scores) * 0.4;
  const weakest = checks.reduce((a, b) => (b.score < a.score ? b : a));
  return {
    lang,
    checks: checks.map((c) => ({ ...c, score: Math.round(c.score) })),
    score: Math.round(total),
    verdict: total >= 70 && Math.min(...scores) >= 55 ? 'pasa' : total >= 50 ? 'revisar' : 'suena a IA',
    weakest: weakest.label,
  };
}

export interface Humanized {
  text: string;
  changes: Change[];
  flags: Flag[];
  before: Score;
  after: Score;
}

/** Cleans a text and scores it before and after. Links stay as they are. */
export function humanize(input: string): Humanized {
  const lang = langOf(input);
  const changes: Change[] = [];
  const p = protect(input);
  let text = cleanInvisible(p.text, changes);
  text = cleanTypography(text, changes);
  text = cleanLexicon(text, lang, changes);
  text = p.back(text).trim();
  const lex = lexicon(lang);
  // Words that are only flagged (no good swap exists): rewrite them by hand.
  const flagged = lex.words.filter((e) => e.flag && wordRe(e.find).test(text)).map((e) => e.find);
  const flags = structures(text, lang);
  if (flagged.length) flags.push({ name: `Palabras gastadas: ${flagged.slice(0, 5).join(', ')}`, count: flagged.length, fix: 'Cámbialas por lo que concretamente quieres decir (qué cambia, en qué, cuánto).' });
  return { text, changes, flags, before: score(input, lang), after: score(text, lang) };
}

/** The report as an agent reads it: the clean text, the score and what's left to rewrite. */
export function report(h: Humanized): string {
  return [
    `Puntuación humana: ${h.before.score} → ${h.after.score}/100 (${h.after.verdict}). Lo más flojo: ${h.after.weakest}.`,
    ...h.after.checks.map((c) => `- ${c.label} ${c.score}: ${c.detail}`),
    h.changes.length ? `Limpiado: ${h.changes.map((c) => `${c.count}× ${c.what}${c.to ? ` → ${c.to}` : ''}`).join('; ')}.` : 'Nada que limpiar.',
    h.flags.length ? `Reescribe tú (no se arregla solo):\n${h.flags.map((f) => `- ${f.name}: ${f.fix}`).join('\n')}` : '',
    '',
    'Texto limpio:',
    h.text,
  ]
    .filter((x) => x !== '')
    .join('\n');
}
