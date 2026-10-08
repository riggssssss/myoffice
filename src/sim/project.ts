/**
 * Your real project, connected through oficina-link (link/oficina-link.mjs). Shared by the
 * server and the panel: what can be connected, what each permission means, and the texts you
 * paste into the project (the manifest and the prompt for your coding AI).
 *
 * Two locks, both must agree: the project's own manifest (what it allows) and these settings
 * (what you switch on). Writing is off unless both say otherwise.
 */
import type { RoleId } from './types';

/** Where the project lives. SSH and HTTPS are for a project on another machine. */
export type LinkMode = 'local' | 'ssh' | 'https';
export type WriteLevel = 'off' | 'propuesta' | 'directo';
export type ReadPerm = 'arbol' | 'leer' | 'buscar' | 'git' | 'cambios' | 'fuentes';

export interface ProjectConfig {
  enabled: boolean;
  mode: LinkMode;
  /** Local: absolute path of the project's folder on this computer. */
  path: string;
  /** SSH: host (or alias from ~/.ssh/config), port, the project's folder, the link file and node there. */
  ssh: { host: string; port: number; root: string; link: string; node: string };
  /** HTTPS: the link's address, ending in /mcp. Its token lives in the vault. */
  url: string;
  /** sha256 of the manifest you approved. Anything else: nothing runs until you look at it. */
  approved: string | null;
  /** Read permissions you switched off. */
  off: ReadPerm[];
  write: WriteLevel;
}

export const DEFAULT_PROJECT: ProjectConfig = {
  enabled: false,
  mode: 'local',
  path: '',
  ssh: { host: '', port: 22, root: '', link: '~/oficina-link.mjs', node: 'node' },
  url: '',
  approved: null,
  off: [],
  write: 'off',
};

/** What the link reports about itself and the project's manifest. */
export interface LinkInfo {
  version: string;
  name: string;
  manifest: string;
  git: boolean;
  read: { paths: string[]; git: boolean; watch: boolean; sources: string | null };
  write: { mode: WriteLevel; paths: string[]; delete: boolean; maxKb: number };
  fuentes: { nombre: string; descripcion: string }[];
}

export type ProjectState = 'off' | 'connecting' | 'review' | 'ready' | 'error';

export interface AccessEntry {
  at: number;
  /** Agent's name, or «Tú». */
  who: string;
  tool: string;
  target: string;
  ok: boolean;
  note: string;
}

export type ChangeStatus = 'open' | 'applied' | 'rejected' | 'failed' | 'undone';

/** A change to a file of your project, proposed by an agent. */
export interface ProjectChange {
  id: string;
  by: string;
  byName: string;
  path: string;
  reason: string;
  /** null: a new file. */
  before: string | null;
  beforeHash: string | null;
  after: string;
  at: number;
  status: ChangeStatus;
  note: string;
  appliedHash: string | null;
}

export type ChangeSummary = Omit<ProjectChange, 'before' | 'after'> & { added: number; removed: number };

/** Everything the Proyecto tab shows. Never a secret: the token is shown only as its hash. */
export interface ProjectView {
  config: ProjectConfig;
  state: ProjectState;
  error: string;
  info: LinkInfo | null;
  /** The approved manifest differs from the one the project has now. */
  changedSinceApproval: boolean;
  perms: { id: ReadPerm; allowed: boolean; on: boolean }[];
  /** Writing as it really is: the lower of the manifest's and yours. */
  write: WriteLevel;
  linkVersion: string;
  linkSha: string;
  tokenHash: string | null;
  linkLog: string[];
  access: AccessEntry[];
  live: { at: number; paths: string[] }[];
  changes: ChangeSummary[];
}

export const READ_PERMS: { id: ReadPerm; label: string; about: string; needs?: 'git' | 'watch' | 'sources' }[] = [
  { id: 'arbol', label: 'Ver la estructura', about: 'Carpetas y nombres de archivo, solo dentro de las rutas que permite el proyecto.' },
  { id: 'leer', label: 'Leer archivos', about: 'Código, textos y configuración no sensible. Lo que parezca un secreto sale tachado.' },
  { id: 'buscar', label: 'Buscar texto', about: 'Buscar un texto literal en lo legible (hasta 100 resultados).' },
  { id: 'git', label: 'Historial de git', about: 'Estado, commits y diferencias. Solo lectura: nunca push, pull, ramas ni comandos.', needs: 'git' },
  { id: 'cambios', label: 'Cambios en vivo', about: 'Se enteran al momento de lo que guardas en el proyecto.', needs: 'watch' },
  { id: 'fuentes', label: 'Datos de tu app', about: 'Solo las funciones de lectura que tu proyecto publica en su archivo de fuentes. Nunca SQL ni código libre.', needs: 'sources' },
];

export const WRITE_LEVELS: { id: WriteLevel; label: string; about: string }[] = [
  { id: 'off', label: 'Solo lectura (recomendado)', about: 'Los agentes leen y te cuentan; los cambios los haces tú.' },
  { id: 'propuesta', label: 'Proponer cambios', about: 'Preparan el cambio y te llega a «Para ti» con la diferencia. Nada se escribe hasta que pulsas «Aplicar».' },
  { id: 'directo', label: 'Escribir sin preguntar', about: 'Escriben en tu proyecto en el momento. Puedes deshacer cada cambio, pero no lo recomendamos.' },
];

export const WRITE_ORDER: WriteLevel[] = ['off', 'propuesta', 'directo'];
export const lowerWrite = (a: WriteLevel, b: WriteLevel): WriteLevel => WRITE_ORDER[Math.min(WRITE_ORDER.indexOf(a), WRITE_ORDER.indexOf(b))];

/** Who may change files when writing is on. Everyone may read. */
export const WRITE_ROLES: RoleId[] = ['director', 'dev', 'design', 'marketing'];

/** Holds whatever is switched on, enforced by the link itself. */
export const WRITE_RULES = [
  'Solo dentro de las rutas de «write.paths» del manifiesto, y solo archivos de texto.',
  'Un archivo por cambio, con tope de tamaño (write.maxKb).',
  'Si el archivo cambió desde que lo leyeron, el cambio se rechaza: nunca pisan tu trabajo.',
  'Nunca tocan un archivo que contenga algo con forma de secreto, ni escriben uno.',
  'Borrar solo si el manifiesto lo permite (write.delete).',
  'Sin comandos, sin instalar nada, sin git: ni commit, ni push, ni ramas.',
  'Cada cambio queda registrado con su versión anterior y se puede deshacer.',
];

/** Never writable, even with writing on (mirrors PROTECTED in the link). */
export const PROTECTED_LIST = [
  'package.json y lockfiles',
  'CI y hooks (.github, .gitlab-ci, .husky)',
  '.gitignore y .gitattributes',
  'configs de build (*.config.js/ts), Dockerfile, Makefile',
  'scripts de shell',
  'este enlace, su manifiesto y el archivo de fuentes',
];

/** Never readable nor writable (mirrors BLOCKED in the link). */
export const BLOCKED_LIST = [
  '.env y variantes',
  'claves y certificados (.pem, .key, id_rsa…)',
  '.git y node_modules',
  '.ssh, .aws, .gnupg, .docker, .kube',
  '.npmrc, .netrc, .pgpass, credenciales',
  'bases de datos y volcados (.sqlite, .db, .dump)',
  'enlaces simbólicos y todo lo ignorado por git',
];

export const MANIFEST_FILE = 'oficina.link.json';
export const SOURCES_FILE = 'oficina.sources.mjs';
export const TOKEN_ENV = 'OFICINA_LINK_TOKEN_SHA256';

/** A safe starting manifest: read-only, the usual source folders. */
export function manifestTemplate(name = 'Mi proyecto'): string {
  return JSON.stringify(
    {
      name,
      read: { paths: ['src/**', 'docs/**', 'README.md', 'package.json'], git: true, watch: true, sources: null },
      write: { mode: 'off', paths: [], delete: false, maxKb: 100 },
    },
    null,
    2,
  );
}

export const SOURCES_EXAMPLE = `// ${SOURCES_FILE}: datos de tu app que la oficina puede consultar. SOLO lectura.
// Cada función exportada es una fuente. Recibe un objeto pequeño y devuelve JSON.
// Puede cargar su propia configuración (p. ej. process.loadEnvFile()), pero
// NUNCA devuelvas datos personales, secretos ni tablas enteras: solo agregados.

export const about = {
  ventasHoy: 'Pedidos e ingresos de hoy',
};

export async function ventasHoy() {
  // const { rows } = await db.query('select count(*)::int as pedidos, sum(total) as ingresos from orders where created_at::date = current_date');
  // return rows[0];
  return { pedidos: 0, ingresos: 0 };
}
`;

/** The prompt you paste into the AI that works on your project (Claude Code, Cursor…). */
export function installPrompt(mode: LinkMode, linkSha: string, tokenHash: string | null): string {
  const steps = [
    `Vas a conectar este proyecto con «Oficina 3D», un equipo de agentes de IA, mediante oficina-link. La conexión es de SOLO LECTURA por defecto. El objetivo es que los agentes lean el código, la documentación y algunos datos agregados, sin poder dañar el proyecto ni ver secretos. Sé conservador: ante la duda, deja algo fuera.`,
    '',
    `1. Crea en la raíz del proyecto el archivo ${MANIFEST_FILE} con esta forma (es JSON estricto: cualquier clave desconocida lo invalida):`,
    '',
    manifestTemplate('<nombre del proyecto>'),
    '',
    '   Ajusta solo "name" y "read.paths":',
    '   - Incluye código fuente, documentación y configuración no sensible (p. ej. "src/**", "app/**", "docs/**", "README.md").',
    '   - NUNCA incluyas .env, claves, certificados, volcados o copias de bases de datos, carpetas de subidas de usuarios, logs, backups ni nada con datos personales.',
    '   - Nada de "**" a secas ni rutas con "..". Rutas relativas a la raíz, separadas con "/".',
    '   - "git": true si el proyecto usa git; "watch": true para avisar de cambios en vivo.',
    '',
    '2. Deja "write" EXACTAMENTE así: { "mode": "off", "paths": [], "delete": false, "maxKb": 100 }. No actives la escritura aunque parezca útil: solo la decide el propietario, que verá el aviso de riesgo en la oficina.',
    '',
    `3. Opcional, datos de la app: si el proyecto tiene métricas útiles para el negocio (ventas, altas, uso), crea ${SOURCES_FILE} en la raíz con funciones de SOLO lectura que devuelvan agregados (recuentos, sumas, tendencias), nunca filas con datos personales ni secretos, y pon "sources": "${SOURCES_FILE}" en el manifiesto. Ejemplo:`,
    '',
    SOURCES_EXAMPLE,
    '   Si no hay nada claro que exponer, deja "sources": null.',
    '',
  ];
  if (mode === 'ssh') {
    steps.push(
      '4. En el servidor donde vive el proyecto, con Node 20 o superior:',
      '   - Copia el archivo oficina-link.mjs que te paso a ~/oficina-link.mjs (fuera del proyecto). No lo modifiques.',
      `   - Comprueba su huella: «shasum -a 256 ~/oficina-link.mjs» (o «sha256sum») debe dar exactamente ${linkSha}. Si no coincide, PARA y avísame.`,
      `   - Valida: «node ~/oficina-link.mjs --root <ruta del proyecto> --check».`,
      '   - Dime la ruta completa de node («command -v node»): si usas nvm, por SSH sin terminal puede no estar en el PATH.',
      '   - No abras puertos ni instales servicios: la oficina se conecta por SSH con mis claves.',
      '',
    );
  } else if (mode === 'https') {
    steps.push(
      '4. En el servidor donde vive el proyecto, con Node 20 o superior:',
      '   - Copia el archivo oficina-link.mjs que te paso fuera de la carpeta pública del proyecto. No lo modifiques.',
      `   - Comprueba su huella: «sha256sum oficina-link.mjs» debe dar exactamente ${linkSha}. Si no coincide, PARA y avísame.`,
      `   - Valida: «node oficina-link.mjs --root <ruta del proyecto> --check».`,
      `   - Arráncalo como servicio (systemd, pm2…) con la variable ${TOKEN_ENV}=${tokenHash ?? '<el hash que da la oficina en Ajustes → Proyecto>'}`,
      '     y el comando «node oficina-link.mjs --root <ruta del proyecto> --http --port 8790». Escucha solo en 127.0.0.1.',
      '   - Publícalo SOLO por HTTPS con un proxy (Caddy, nginx) en una ruta propia, p. ej. https://tudominio/oficina/mcp → http://127.0.0.1:8790/mcp, y también /mcp/events. Nunca por http plano.',
      '   - Esa variable es un hash: el token real solo lo tiene la oficina. No lo pidas ni lo inventes.',
      '',
    );
  } else {
    steps.push(
      `4. Comprueba que ${MANIFEST_FILE} es JSON válido. No hace falta instalar nada más: la oficina trae el enlace y lo ejecuta contra esta carpeta.`,
      '',
    );
  }
  steps.push(
    `5. No hagas commit ni push sin preguntarme. ${MANIFEST_FILE} sí debe ir al repositorio (sin secretos); así el equipo ve qué se comparte.`,
    '',
    '6. Al terminar, resúmeme: qué rutas has incluido y por qué, qué has dejado fuera a propósito y, si hay fuentes, qué devuelve cada una.',
  );
  return steps.join('\n');
}
