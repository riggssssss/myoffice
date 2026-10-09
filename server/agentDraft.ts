/**
 * A new agent from your words: you explain what they'll do, the head of the office organises it
 * into a card (name, post, role, boss, what they do, who they are, what they put first) and you
 * edit it before they join. Nothing is created here: the draft goes back to the browser.
 */
import { depthOf, getState, headOf, MAX_DEPTH, PROFILE_MAX } from '../src/sim/ops';
import { REQUIRED_NAMES, REQUIRED_ROLES, ROLE_ORDER, ROLES } from '../src/sim/seed';
import type { AgentDraft, RoleId } from '../src/sim/types';
import { brainOf, overDailyCap, spend } from './agents';
import { LlmError, think } from './llm';
import { briefText, parseJson } from './meetings';

const HIRE_ROLES = ROLE_ORDER.filter((r) => !REQUIRED_ROLES.includes(r));
let busy = false;

const cut = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/[ \t]+/g, ' ').slice(0, max) : '');
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** A role id the AI got slightly wrong («diseño», «Design») becomes the closest one. */
function roleOf(v: unknown): RoleId {
  const t = norm(typeof v === 'string' ? v : '');
  const exact = HIRE_ROLES.find((r) => r === t);
  if (exact) return exact;
  return HIRE_ROLES.find((r) => t && (norm(ROLES[r].label).includes(t) || t.includes(norm(ROLES[r].label)))) ?? 'research';
}

export async function draftAgent(text: string): Promise<AgentDraft> {
  const what = text.trim();
  if (what.length < 10) throw new LlmError('Cuéntalo un poco más: qué hará y para qué', 0);
  if (what.length > 2000) throw new LlmError('Demasiado largo: resúmelo en unas líneas', 0);
  if (busy) throw new LlmError('Ya estoy organizando otro agente: espera un momento', 429);
  if (overDailyCap()) throw new LlmError('La oficina ha llegado al límite de tokens de hoy (Ajustes → IA → Gasto)', 0);
  const st = getState();
  const head = headOf(st.workers);
  if (!head) throw new LlmError('La oficina no tiene dirección', 0);
  const brain = brainOf(head);
  if (typeof brain === 'string') throw new LlmError(brain, 0);
  // Only bosses they could really have: not the sceptic, and the chart stays three levels deep.
  const bosses = st.workers.filter((w) => !w.staff && depthOf(st.workers, w.id) + 1 <= MAX_DEPTH);
  const taken = new Set([...st.workers.map((w) => norm(w.name)), ...Object.values(REQUIRED_NAMES).map(norm)]);
  busy = true;
  try {
    const out = await think(
      brain,
      `Eres ${head.name}, dirección de «${st.agency || 'la oficina'}», una oficina de agentes de IA que trabaja para el propietario. Conviertes lo que te cuenta en la ficha de un agente nuevo, lista para trabajar.`,
      [
        `Producto: ${st.project || '(sin nombre aún)'}`,
        `Dossier:\n${briefText() || '(casi vacío)'}`,
        `Equipo: ${st.workers.map((w) => `${w.id} · ${w.name} · ${w.title} (${ROLES[w.role].label})`).join('; ')}`,
        `Roles: ${HIRE_ROLES.map((r) => `${r} (${ROLES[r].label}: ${ROLES[r].about})`).join('; ')}.`,
        `Jefes posibles (id): ${bosses.map((w) => `${w.id} ${w.name} (${w.title})`).join('; ')}.`,
        '',
        `Lo que te ha dicho el propietario:\n«${what}»`,
        '',
        'Escribe su ficha:',
        '- puesto: concreto y especializado (máx. 60 caracteres).',
        '- rol: el id que mejor encaje.',
        '- responde_a: id del jefe más lógico (el responsable de su área si lo hay; si no, dirección).',
        '- resumen: qué hará aquí y para qué, 1-2 frases claras.',
        '- persona: quién es, como una persona real: trayectoria, carácter, cómo habla y qué no tolera. 3-5 frases, sin inventar logros con cifras ni empresas reales.',
        '- enfoque: 4-6 prácticas concretas con las que trabaja (frases cortas).',
        '- nombre: nombre de pila español que no esté en el equipo.',
        'Respeta lo que pidió el propietario; complétalo con criterio de experto, sin añadir tareas que no encajen. Español de España.',
        'Responde SOLO JSON: {"nombre":"…","puesto":"…","rol":"design","responde_a":"w1","resumen":"…","persona":"…","enfoque":["…"]}',
      ].join('\n'),
      [],
      async () => '',
      { maxRounds: 0, maxTokens: 1100 },
    );
    spend(out.tokens);
    const j = parseJson(out.text);
    if (!j) throw new LlmError('La IA no devolvió una ficha válida: prueba otra vez', 0);
    const name = cut(j.nombre, 40);
    const boss = bosses.find((w) => w.id === j.responde_a) ?? head;
    const focus = (Array.isArray(j.enfoque) ? j.enfoque : []).map((f: unknown) => cut(f, PROFILE_MAX.focusItem)).filter(Boolean).slice(0, PROFILE_MAX.focus);
    const summary = cut(j.resumen, PROFILE_MAX.summary);
    if (!summary) throw new LlmError('La IA no devolvió una ficha válida: prueba otra vez', 0);
    const role = roleOf(j.rol);
    return {
      name: taken.has(norm(name)) ? '' : name,
      title: cut(j.puesto, 60) || ROLES[role].title,
      role,
      reportsTo: boss.id,
      profile: { summary, persona: cut(j.persona, PROFILE_MAX.persona), focus },
    };
  } finally {
    busy = false;
  }
}
