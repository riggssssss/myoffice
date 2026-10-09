/**
 * Who the project needs next: when you open «Añadir agente» (or ask again), the head looks at
 * the dossier, the team and the open work and suggests two to four concrete hires, each with a
 * reason tied to your product. Without an AI it falls back to the roles nobody covers yet.
 * She also brings it up herself, out loud, when what she knows of the project has changed.
 */
import { getState, headOf, hireBasis, notify, tellOwner } from '../src/sim/ops';
import { REQUIRED_ROLES, ROLE_ORDER, ROLES } from '../src/sim/seed';
import type { HireIdea, RoleId } from '../src/sim/types';
import { brainOf, spend, terse } from './agents';
import { LlmError, think } from './llm';
import { briefText, parseJson } from './meetings';

const HIRE_ROLES = ROLE_ORDER.filter((r) => !REQUIRED_ROLES.includes(r));
const MAX_IDEAS = 4;
/** On her own she rethinks the team at most this often, and only once the dossier has some substance. */
const AUTO_EVERY_MS = 6 * 3600_000;
const AUTO_MIN_ASPECTS = 3;
let busy = false;

const andList = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

const cut = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

const plainText = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9/]+/g, ' ').trim();
/** Words in a job title that say which role it is, when the model names the role its own way. */
const ROLE_HINTS: [RegExp, RoleId][] = [
  [/\barte\b|\bart\b/, 'art'],
  [/\bui\b|\bux\b|interfaz|experiencia de usuario/, 'uiux'],
  [/marketing|redes|community|social|guion|campan|copy|contenido|seo/, 'marketing'],
  [/tendencia|investiga|analis|datos|mercado/, 'research'],
  [/desarroll|program|frontend|backend|codigo/, 'dev'],
  [/disen|ilustra|mockup|imagen|generador|grafic/, 'design'],
];

/** «art», «Dirección de arte» or just a title like «Director de arte»: the role it means, or null. */
function roleFor(raw: unknown, title: string): RoleId | null {
  const v = plainText(typeof raw === 'string' ? raw : '');
  const exact = HIRE_ROLES.find((r) => r === v || plainText(ROLES[r].label) === v);
  if (exact) return exact;
  for (const text of [v, plainText(title)]) {
    const hit = ROLE_HINTS.find(([re, r]) => HIRE_ROLES.includes(r) && re.test(text));
    if (hit) return hit[1];
  }
  return null;
}

/** Without an AI: one per role nobody in the team has yet. */
function basicIdeas(): HireIdea[] {
  const have = new Set(getState().workers.map((w) => w.role));
  return HIRE_ROLES.filter((r) => !have.has(r)).map((r) => ({ role: r, title: ROLES[r].title, name: '', why: ROLES[r].about }));
}

export function hiresTick(publish: () => void): void {
  const st = getState();
  const h = st.hireIdeas;
  const head = headOf(st.workers);
  const basis = hireBasis();
  // Unasked: the project or the team changed since she last thought about it.
  if (
    h.status !== 'asked' && h.status !== 'thinking' && st.working && head?.enabled && h.basis !== basis &&
    Date.now() - h.at > AUTO_EVERY_MS && Object.keys(st.brief.aspects).length >= AUTO_MIN_ASPECTS
  ) {
    h.status = 'asked';
  }
  if (busy || h.status !== 'asked') return;
  const brain = head ? brainOf(head) : 'Sin dirección';
  if (typeof brain === 'string' || !head) {
    Object.assign(h, {
      status: 'ready',
      items: basicIdeas(),
      basis,
      at: Date.now(),
      by: null,
      note: 'Sugerencias básicas por los puestos que faltan. Con una IA en Ajustes, Dirección las adapta a tu proyecto.',
    });
    notify('change');
    return;
  }
  busy = true;
  h.status = 'thinking';
  h.by = head.id;
  notify('change');
  publish();
  void suggest(head.name, brain)
    .then((items) => {
      const before = new Set(h.items.map((i) => i.title.toLowerCase()));
      const fresh = items.filter((i) => !before.has(i.title.toLowerCase()));
      Object.assign(h, {
        status: 'ready',
        items,
        basis,
        at: Date.now(),
        note: items.length ? '' : `${head.name} cree que el equipo actual cubre lo que sabe de tu proyecto.`,
      });
      // She says it out loud (a bubble over her and a note for you), only when there's something new.
      if (!fresh.length) return;
      for (const m of st.inbox) if (!m.closed && m.action?.type === 'ideas') Object.assign(m, { closed: true, read: true });
      tellOwner(
        head.id,
        'ideas',
        `Para tu proyecto yo contrataría ${andList(items.slice(0, 3).map((i) => i.title.toLowerCase()))}${items.length > 3 ? ' y alguien más' : ''}.`,
        items.map((i) => `${i.title}: ${i.why}`).join('\n'),
        { type: 'ideas' },
      );
    })
    .catch((e) => {
      h.status = 'failed';
      h.note = e instanceof LlmError ? e.message : 'No se pudo pensar ahora.';
    })
    .finally(() => {
      busy = false;
      notify('change');
      publish();
    });
}

async function suggest(headName: string, brain: Exclude<ReturnType<typeof brainOf>, string>): Promise<HireIdea[]> {
  const st = getState();
  const wanted = st.brief.wanted ?? [];
  // What you asked for comes first: room for all of it, up to a sensible handful.
  const max = Math.max(MAX_IDEAS, Math.min(8, wanted.length));
  const team = st.workers.map((w) => `${w.name}: ${w.title} (${ROLES[w.role].label})`).join('; ');
  const open = st.tasks
    .filter((t) => t.status !== 'done')
    .slice(0, 10)
    .map((t) => `- ${t.title} [${ROLES[t.role].label}${t.status === 'blocked' ? ', bloqueada' : ''}]`)
    .join('\n');
  const out = await think(
    brain,
    `Eres ${headName}, dirección de «${st.agency || 'la oficina'}», una oficina de agentes de IA que trabaja para el propietario. Decides qué perfiles necesita el equipo.`,
    [
      `Producto: ${st.project || '(sin nombre aún)'}`,
      `Dossier:\n${briefText() || '(casi vacío: aún sabéis poco del producto)'}`,
      `Equipo: ${team}`,
      open ? `Trabajo abierto:\n${open}` : 'Sin tareas abiertas.',
      `Roles que se pueden contratar: ${HIRE_ROLES.map((r) => `${r} (${ROLES[r].label}: ${ROLES[r].about})`).join('; ')}.`,
      wanted.length ? `Puestos que el propietario ha pedido para el equipo (van primero, uno por idea, con su mismo nombre y el rol más cercano; salvo los que ya cubra alguien):\n${wanted.map((p) => `- ${p}`).join('\n')}` : '',
      '',
      `¿Qué 2-${max} agentes nuevos aportarían más ahora a ESTE producto? Puesto concreto y especializado (p. ej. «SEO y contenidos», no «Marketing»); un rol puede repetirse con otra especialidad. Nada que ya cubra alguien del equipo. Si el dossier está casi vacío, lo básico para arrancar. Por orden de importancia.`,
      `motivo: una frase clara para el propietario, ligada a su producto${terse() ? ', máx. 20 palabras' : ', máx. 28 palabras'}. nombre: nombre de pila español que no esté en el equipo.`,
      'Responde SOLO JSON: {"ideas": [{"rol": "design", "puesto": "…", "nombre": "…", "motivo": "…"}]}',
    ].join('\n'),
    [],
    async () => '',
    { maxRounds: 0, maxTokens: 600 + max * 150 },
  );
  spend(out.tokens);
  const json = parseJson(out.text);
  const list = Array.isArray(json?.ideas) ? (json.ideas as Record<string, unknown>[]) : [];
  const names = new Set(st.workers.map((w) => w.name.toLowerCase()));
  const ideas: HireIdea[] = [];
  for (const x of list) {
    const title = cut(x?.puesto, 60);
    const why = cut(x?.motivo, 280);
    const role = roleFor(x?.rol, title);
    if (!role || !title || !why) continue;
    if (ideas.some((i) => i.title.toLowerCase() === title.toLowerCase())) continue;
    const name = cut(x?.nombre, 40);
    ideas.push({ role, title, why, name: names.has(name.toLowerCase()) ? '' : name });
    if (ideas.length === max) break;
  }
  if (!ideas.length && list.length) throw new LlmError('La respuesta no traía sugerencias válidas. Prueba otra vez.', 0);
  return ideas;
}
