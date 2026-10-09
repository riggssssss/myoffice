import type { RoleId, RoleInfo, SimState } from './types';

export const SCHEMA_VERSION = 7;

/** The head's desk is always this seat number, so their office can come furnished. */
export const DIRECTOR_SLOT = -1;
/** Chairs round the meeting table: nobody more sits down. */
export const MEETING_SEATS = 6;

/** Every office has these four, one each: renamable and restylable, not removable. None has a desk. */
export const REQUIRED_ROLES: RoleId[] = ['director', 'organizer', 'interviewer', 'skeptic'];
/** Default names for the four you start with. */
export const REQUIRED_NAMES: Record<string, string> = { director: 'Marta', organizer: 'Óscar', interviewer: 'Inés', skeptic: 'Bruno' };

export const ROLES: Record<RoleId, RoleInfo> = {
  director: {
    id: 'director',
    label: 'Dirección',
    color: '#64748b',
    title: 'Dirección',
    about: 'Fija prioridades, decide al final y te entrega las conclusiones. Trabaja en la sala de reuniones.',
  },
  organizer: {
    id: 'organizer',
    label: 'Organización',
    color: '#5568a6',
    title: 'Organizador de proyectos',
    about: 'Reparte y asigna las tareas, ronda por las mesas del equipo, prepara el orden del día, modera las reuniones y escribe las actas.',
  },
  interviewer: {
    id: 'interviewer',
    label: 'Entrevistas',
    color: '#2f8a8a',
    title: 'Entrevistas y cuentas',
    about: 'Recibe a cada agente nuevo en recepción y lo entrevista para saber al detalle qué hará. También te entrevista a ti y convierte tus respuestas en briefs.',
  },
  research: {
    id: 'research',
    label: 'Investigación',
    color: '#c27f35',
    title: 'Investigación',
    about: 'Competencia, mercado y tendencias, siempre con fuentes.',
  },
  art: {
    id: 'art',
    label: 'Dirección de arte',
    color: '#a4508b',
    title: 'Dirección de arte',
    about: 'Guía el estilo visual: aprende de tus referencias, mantiene la guía de estilo y revisa y dirige cada pieza.',
  },
  design: {
    id: 'design',
    label: 'Diseño',
    color: '#bf5f74',
    title: 'Diseño',
    about: 'Marca, referencias visuales y piezas (imágenes, logos).',
  },
  uiux: {
    id: 'uiux',
    label: 'Diseño UI/UX',
    color: '#3d8fb5',
    title: 'Diseño UI/UX',
    about: 'Interfaces, flujos, prototipos y usabilidad de la web o la app.',
  },
  dev: {
    id: 'dev',
    label: 'Desarrollo',
    color: '#3f7f70',
    title: 'Desarrollo y producto',
    about: 'Viabilidad, coste y revisión de la web y la analítica.',
  },
  marketing: {
    id: 'marketing',
    label: 'Marketing',
    color: '#9a8a2a',
    title: 'Marketing',
    about: 'Contenido, calendario y publicación en redes.',
  },
  skeptic: {
    id: 'skeptic',
    label: 'Escéptico',
    color: '#82629f',
    title: 'Análisis crítico',
    about: 'Ronda por fuera de la oficina criticando lo que ve, y entra a hablar con dirección cuando tiene algo que decir.',
  },
};

export const ROLE_ORDER: RoleId[] = ['director', 'organizer', 'interviewer', 'research', 'art', 'design', 'uiux', 'dev', 'marketing', 'skeptic'];

/** Roles whose work is visual (they draw at the desk, and the style guide is theirs). */
export const VISUAL_ROLES: ReadonlySet<RoleId> = new Set(['art', 'design', 'uiux']);

/** An office with only its three fixed roles; ops.ensureRequired() hires them. */
export function createSeed(now = Date.now()): SimState {
  return {
    version: SCHEMA_VERSION,
    agency: '',
    project: '',
    clock: now,
    working: false,
    workers: [],
    tasks: [],
    feed: [],
    conversations: [],
    requests: [],
    questions: [],
    brief: { aspects: {}, kickedOff: false },
    health: { overall: 0, aspects: [], threshold: 45, crisis: false },
    meeting: null,
    meetings: [],
    events: [],
    inbox: [],
    hireIdeas: { status: 'idle', items: [], basis: '', at: 0, by: null, note: '' },
    ai: { state: 'off', note: '', day: '', tokensToday: 0, limit: 0, resting: [], using: null, reason: null, back: null },
    nextId: 1,
  };
}
