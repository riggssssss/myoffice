import { DEFAULT_LOOK, SEED_LOOKS } from './look';
import type { RoleId, RoleInfo, SimState, Task, Worker } from './types';

export const SCHEMA_VERSION = 5;
export const DAY_START = 9 * 60;
export const DAY_END = 18 * 60;
export const MINUTES_PER_DAY = 24 * 60;

export const ROLES: Record<RoleId, RoleInfo> = {
  research: { id: 'research', label: 'Research', color: '#c27f35' },
  design: { id: 'design', label: 'Diseño UI', color: '#bf5f74' },
  backend: { id: 'backend', label: 'Backend', color: '#3f7f70' },
  pm: { id: 'pm', label: 'Producto', color: '#5568a6' },
  qa: { id: 'qa', label: 'QA', color: '#82629f' },
};

export const ROLE_ORDER: RoleId[] = ['research', 'design', 'backend', 'pm', 'qa'];

/** New work the simulation can invent when a role runs out of backlog. */
export const TASK_POOL: Record<RoleId, string[]> = {
  research: [
    'Entrevistas con 5 usuarios',
    'Análisis de analítica del onboarding',
    'Mapa de proveedores de pago',
    'Auditoría de accesibilidad de la competencia',
    'Resumen de tickets de soporte',
  ],
  design: [
    'Pantalla de perfil',
    'Estados vacíos del listado',
    'Sistema de iconos',
    'Pantalla de ajustes',
    'Flujo de recuperar contraseña',
  ],
  backend: [
    'Endpoint de pedidos',
    'Webhooks de pagos',
    'Caché de catálogo',
    'Migración de base de datos',
    'Rate limiting de la API',
  ],
  pm: [
    'Priorizar backlog del sprint',
    'Specs de notificaciones',
    'Reunión de seguimiento con cliente',
    'Roadmap del trimestre',
  ],
  qa: [
    'Tests end-to-end del checkout',
    'Regresión en móvil',
    'Pruebas de carga de la API',
    'Checklist de accesibilidad',
  ],
};

export const BLOCK_REASONS = [
  'Esperando feedback del cliente',
  'Falta acceso al entorno',
  'Dependencia de otra tarea',
  'Dudas en los requisitos',
  'Bug en el entorno de staging',
];

function w(
  id: string,
  name: string,
  title: string,
  role: RoleId,
  desk: number,
  taskId: string | null,
  pairWith: string | null = null,
): Worker {
  return {
    id,
    name,
    title,
    role,
    desk,
    look: { ...(SEED_LOOKS[id] ?? DEFAULT_LOOK) },
    energy: 70 + Math.round(Math.random() * 30),
    activity: 'working',
    taskId,
    pairWith,
    coffeeUntil: null,
    idleSince: null,
  };
}

function t(
  id: string,
  title: string,
  role: RoleId,
  estimate: number,
  assigneeId: string | null = null,
  progress = 0,
): Task {
  return {
    id,
    title,
    role,
    assigneeId,
    status: assigneeId ? 'doing' : 'backlog',
    progress,
    reviewProgress: 0,
    estimate,
    createdAt: DAY_START,
    doneAt: null,
    blockedUntil: null,
    blockReason: null,
  };
}

export function createSeed(): SimState {
  const start = MINUTES_PER_DAY + DAY_START + 10; // Día 1, 09:10
  const tasks: Task[] = [
    t('t1', 'Búsqueda de información: benchmark de competidores', 'research', 6, 'pepe', 35),
    t('t2', 'Diseño UI: pantalla Home', 'design', 8, 'maria', 55),
    t('t3', 'Diseño UI: pantalla Checkout', 'design', 7, 'manuel', 20),
    t('t4', 'API de autenticación', 'backend', 9, 'lucia', 40),
    t('t5', 'Planificación del sprint y specs', 'pm', 5, 'javier', 60),
    t('t6', 'Plan de pruebas de la app', 'qa', 6, 'sara', 15),
    t('t7', 'Personas y casos de uso', 'research', 4),
    t('t8', 'Diseño UI: pantalla Login', 'design', 4),
    t('t9', 'Guía de componentes', 'design', 6),
    t('t10', 'Modelo de datos de productos', 'backend', 6),
    t('t11', 'Integración pasarela de pago', 'backend', 10),
    t('t12', 'Revisión de presupuesto con cliente', 'pm', 3),
    t('t13', 'Tests de la API de autenticación', 'qa', 4),
    t('t14', 'Encuesta de satisfacción', 'research', 3),
  ];
  for (const task of tasks) task.createdAt = start - 60;

  const workers: Worker[] = [
    w('pepe', 'Pepe', 'Analista de research', 'research', 0, 't1'),
    w('maria', 'María', 'Diseñadora UI', 'design', 1, 't2'),
    w('manuel', 'Manuel', 'Diseñador UI junior', 'design', 2, 't3', 'maria'),
    w('lucia', 'Lucía', 'Desarrolladora backend', 'backend', 3, 't4'),
    w('javier', 'Javier', 'Product manager', 'pm', 4, 't5'),
    w('sara', 'Sara', 'QA', 'qa', 5, 't6'),
  ];

  return {
    version: SCHEMA_VERSION,
    agency: 'Estudio Brasa',
    project: 'App web — Cliente Nórdica',
    clock: start,
    speed: 1,
    lastMeetingDay: 0,
    workers,
    tasks,
    feed: [
      {
        id: 1,
        t: start,
        kind: 'pair',
        text: 'Manuel se sienta con María para sacar la pantalla Checkout',
        workerId: 'manuel',
        taskId: 't3',
      },
    ],
    nextId: 100,
  };
}
