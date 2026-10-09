/** Office-wide preferences kept by the local server. Keys never live here: only in the vault. */

export type TextProvider = 'anthropic' | 'groq' | 'nvidia' | 'ollama';
export type ImageProvider = 'none' | 'fal' | 'recraft' | 'cloudflare';

/** Cloudflare's image models, by what you get: the free allowance (10,000 a day) goes further with the quicker ones. */
export type ImageQuality = 'rapida' | 'equilibrada' | 'alta' | 'pro';
export const IMAGE_QUALITY: { id: ImageQuality; label: string; model: string; perDay: number; note: string }[] = [
  { id: 'rapida', label: 'Rápida', model: '@cf/black-forest-labs/flux-1-schnell', perDay: 170, note: 'Flux 1 Schnell: bocetos y pruebas' },
  { id: 'equilibrada', label: 'Equilibrada', model: '@cf/black-forest-labs/flux-2-klein-4b', perDay: 95, note: 'Flux 2 Klein 4B: borradores correctos' },
  { id: 'alta', label: 'Alta', model: '@cf/black-forest-labs/flux-2-klein-9b', perDay: 7, note: 'Flux 2 Klein 9B: más detalle y mejor luz' },
  { id: 'pro', label: 'Profesional', model: '@cf/leonardo/lucid-origin', perDay: 3, note: 'Leonardo Lucid Origin: mockups y textos nítidos' },
];

/** Today's free Cloudflare allowance, as the server reads it. */
export interface ImageUsage {
  /** Neurons used today, the free ones a day, and the most allowed today (free + your budget). */
  used: number;
  free: number;
  cap: number;
  /** Your daily budget beyond the free allowance, and what's gone of it today (USD). */
  budgetUsd: number;
  spentUsd: number;
  /** Pictures made from this app today. */
  pictures: number;
  /** How many more square pictures fit today, at each quality. */
  fits: Record<ImageQuality, number>;
  quality: ImageQuality;
  /** When the allowance starts again (ISO). */
  resetsAt: string;
  /** Where `used` comes from: Cloudflare's own figures, or this app's sums when they can't be read. */
  source: 'cloudflare' | 'app';
  /** Why Cloudflare's figures couldn't be read, said plainly. */
  why?: string;
  checkedAt: number;
}

/**
 * One AI in the office's priority list. The first one that works is used; when it hits a limit
 * (per minute, per day, out of credit) or fails, the call moves on to the next. `provider` and
 * `model` in the settings are always the first of the list.
 */
export interface AiChoice {
  provider: TextProvider;
  model: string;
}

/** Longest priority list. */
export const MAX_CHAIN = 8;

export interface Settings {
  /** Where the office stands, for the sun. Guessed from the time zone until someone sets it. */
  location: { lat: number; lon: number; place: string; guessed: boolean } | null;
  /** Compass bearing (degrees) the office's back wall (−z) faces. 0 = north. */
  north: number;
  /**
   * The text AI every agent uses unless they have their own. `terse`: among themselves they talk
   * like a clever caveman (no filler, fragments) to spend far fewer tokens; to you, clear and brief.
   */
  ai: { provider: TextProvider; model: string; ollamaUrl: string; dailyTokens: number; terse: boolean; chain: AiChoice[]; workPerHour?: number };
  /**
   * Image generation for design work. `dailyUsd`: what you allow to spend a day beyond the free
   * allowance (0: never past it).
   */
  image: { provider: ImageProvider; quality?: ImageQuality; dailyUsd?: number };
  /** The reception sofa's velvet, as #rrggbb. */
  sofaColor?: string;
}

/** Velvets for the sofa, offered as swatches (any other colour can be picked too). */
export const SOFA_COLORS: [string, string][] = [
  ['#8b8378', 'Gris cálido'],
  ['#e2d9c8', 'Marfil'],
  ['#6b6a3e', 'Verde oliva'],
  ['#2f4a3a', 'Verde botella'],
  ['#2e3a52', 'Azul noche'],
  ['#a65a3c', 'Terracota'],
  ['#8a5a32', 'Coñac'],
  ['#c49a8f', 'Rosa empolvado'],
  ['#b8922f', 'Mostaza'],
];
export const DEFAULT_SOFA_COLOR = SOFA_COLORS[0][0];

export const DEFAULT_SETTINGS: Settings = {
  location: null,
  north: 0,
  ai: { provider: 'anthropic', model: 'claude-sonnet-5-5', ollamaUrl: 'http://127.0.0.1:11434', dailyTokens: 300_000, terse: true, chain: [{ provider: 'anthropic', model: 'claude-sonnet-5-5' }] },
  image: { provider: 'none', dailyUsd: 0 },
};

/** How many stretches of desk work the whole team does an hour at most (0: no limit). */
export const WORK_PACE: { perHour: number; label: string; note: string }[] = [
  { perHour: 12, label: 'Tranquilo', note: 'gasta poco' },
  { perHour: 30, label: 'Normal', note: 'el habitual' },
  { perHour: 60, label: 'Intenso', note: 'más avance, más gasto' },
  { perHour: 0, label: 'Sin límite', note: 'cada uno a su ritmo' },
];
export const DEFAULT_WORK_PER_HOUR = 30;

/** What Cloudflare charges beyond the free allowance. */
export const USD_PER_1000_NEURONS = 0.011;

export interface ModelInfo {
  id: string;
  label: string;
  note: string;
}

export const TEXT_MODELS: ModelInfo[] = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Equilibrado: el habitual para trabajar' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'El más capaz: decisiones y dirección' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', note: 'Escritura con voz propia' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', note: 'Rápido y barato: charla y tareas cortas' },
];

/** Groq serves open models very fast. Its catalogue changes often, so any model id is accepted too. */
export const GROQ_MODELS: ModelInfo[] = [
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', note: 'El más capaz de Groq, con razonamiento' },
  { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', note: 'Rapidísimo y barato' },
  { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B', note: 'En pruebas: puede desaparecer' },
];

/**
 * NVIDIA's API catalog (build.nvidia.com): free for developers, one key for every model, each
 * model with its own limits. Several of them in the list take turns: when one is busy or
 * limited, the next answers. Chat models that handle tools, biggest first.
 */
export const NVIDIA_MODELS: ModelInfo[] = [
  { id: 'moonshotai/kimi-k3', label: 'Kimi K3', note: 'Muy capaz, con razonamiento' },
  { id: 'z-ai/glm-5.3', label: 'GLM 5.3', note: 'Muy capaz' },
  { id: 'deepseek-ai/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', note: 'Capaz y rápido' },
  { id: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6', note: 'Capaz' },
  { id: 'nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super', note: 'De NVIDIA, suele estar libre' },
  { id: 'z-ai/glm-5.3-flash', label: 'GLM 5.3 Flash', note: 'Rápido' },
  { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', note: 'Rapidísimo' },
];

/** Names of the office-wide keys in the vault. */
export const KEYS = {
  anthropic: 'anthropic_api_key',
  groq: 'groq_api_key',
  nvidia: 'nvidia_api_key',
  fal: 'fal_api_key',
  recraft: 'recraft_api_key',
  cfAccount: 'cloudflare_account_id',
  cfToken: 'cloudflare_api_token',
} as const;

export interface ProviderInfo {
  label: string;
  /** Vault name of the office's key; Ollama runs here and needs none. */
  key: 'anthropic_api_key' | 'groq_api_key' | 'nvidia_api_key' | null;
  help: string;
  /** Suggested models. Anthropic: only these; the others take any id. */
  models: ModelInfo[];
  defaultModel: string;
}

export const PROVIDERS: Record<TextProvider, ProviderInfo> = {
  anthropic: { label: 'Claude (Anthropic)', key: KEYS.anthropic, help: 'https://console.anthropic.com/settings/keys', models: TEXT_MODELS, defaultModel: 'claude-sonnet-5-5' },
  groq: { label: 'Groq', key: KEYS.groq, help: 'https://console.groq.com/keys', models: GROQ_MODELS, defaultModel: 'openai/gpt-oss-120b' },
  nvidia: { label: 'NVIDIA', key: KEYS.nvidia, help: 'https://build.nvidia.com/moonshotai/kimi-k3', models: NVIDIA_MODELS, defaultModel: 'moonshotai/kimi-k3' },
  ollama: { label: 'Ollama, en tu ordenador', key: null, help: 'https://ollama.com/library', models: [], defaultModel: 'qwen3:14b' },
};

/** "GPT-OSS 20B", or the id itself for a model we don't list. */
export const modelLabel = (c: AiChoice) => PROVIDERS[c.provider].models.find((m) => m.id === c.model)?.label ?? c.model;

export const isProvider = (v: unknown): v is TextProvider => typeof v === 'string' && Object.hasOwn(PROVIDERS, v);

/** Claude only takes the models it lists; Groq and Ollama take any short model id. */
export const validModel = (provider: TextProvider, model: unknown): model is string =>
  typeof model === 'string' &&
  model.length > 0 &&
  model.length <= 80 &&
  (provider === 'anthropic' ? TEXT_MODELS.some((m) => m.id === model) : /^[\w.:/-]+$/.test(model));

/** An agent's own key for one provider, when they don't use the office's. */
export const agentKey = (workerId: string, provider: TextProvider = 'anthropic') =>
  provider === 'anthropic' ? `agent_${workerId}_key` : `agent_${workerId}_${provider}_key`;

// ---------------------------------------------------------------- connectors (MCP)

/** One value a connector needs. Stored in the vault; the config only refers to it. */
export interface McpField {
  key: string;
  label: string;
  optional?: boolean;
  /** HTTP connectors: sent as this header, `{}` replaced by the value. Otherwise an env variable. */
  header?: { name: string; template: string };
}

export interface McpPreset {
  id: string;
  name: string;
  about: string;
  /** What agents can do with it. */
  access: 'lectura' | 'escritura' | 'lectura y escritura';
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  fields: McpField[];
  note?: string;
  help: string;
}

/** Reviewed connectors, with their versions pinned. See docs/agentes.md for why these. */
export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'exa',
    name: 'Exa (búsqueda web)',
    about: 'Búsqueda web pensada para agentes, con fuentes.',
    access: 'lectura',
    transport: 'http',
    url: 'https://mcp.exa.ai/mcp',
    fields: [{ key: 'EXA_API_KEY', label: 'Clave de API de Exa', header: { name: 'Authorization', template: 'Bearer {}' } }],
    help: 'https://dashboard.exa.ai/api-keys',
  },
  {
    id: 'tavily',
    name: 'Tavily (búsqueda y extracción)',
    about: 'Busca en la web y extrae el contenido de páginas.',
    access: 'lectura',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'tavily-mcp@0.2.22'],
    fields: [{ key: 'TAVILY_API_KEY', label: 'Clave de API de Tavily' }],
    help: 'https://app.tavily.com',
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl (leer webs)',
    about: 'Lee y resume páginas web completas.',
    access: 'lectura',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'firecrawl-mcp@3.28.2'],
    fields: [{ key: 'FIRECRAWL_API_KEY', label: 'Clave de API de Firecrawl' }],
    help: 'https://www.firecrawl.dev/app/api-keys',
  },
  {
    id: 'fetch',
    name: 'Fetch (leer una URL)',
    about: 'El conector oficial de MCP para leer una página concreta. Gratis.',
    access: 'lectura',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    fields: [],
    note: 'Necesita uv instalado (https://docs.astral.sh/uv/).',
    help: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },
  {
    id: 'x',
    name: 'X (oficial)',
    about: 'Leer y publicar en X con la API oficial. Pago por uso: un post con enlace cuesta bastante más.',
    access: 'lectura y escritura',
    transport: 'http',
    url: 'http://127.0.0.1:8000/mcp',
    fields: [],
    note: 'Es el servidor oficial xdevplatform/xmcp: se arranca aparte con tus claves de X y escucha en tu ordenador. Limita sus herramientas con X_API_TOOL_ALLOWLIST.',
    help: 'https://github.com/xdevplatform/xmcp',
  },
  {
    id: 'reddit',
    name: 'Reddit',
    about: 'Leer subreddits, publicar y responder con la API oficial.',
    access: 'lectura y escritura',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'reddit-mcp-server@1.6.3'],
    fields: [
      { key: 'REDDIT_CLIENT_ID', label: 'Client ID de tu app de Reddit' },
      { key: 'REDDIT_CLIENT_SECRET', label: 'Client secret' },
      { key: 'REDDIT_USERNAME', label: 'Usuario (para publicar)', optional: true },
      { key: 'REDDIT_PASSWORD', label: 'Contraseña (para publicar)', optional: true },
    ],
    note: 'Las apps nuevas de Reddit necesitan su aprobación manual (2–4 semanas).',
    help: 'https://www.reddit.com/prefs/apps',
  },
  {
    id: 'meta',
    name: 'Instagram y Threads',
    about: 'Publicar, comentarios y estadísticas con la Graph API oficial de Meta.',
    access: 'lectura y escritura',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mikusnuz/meta-mcp@2.1.1'],
    fields: [
      { key: 'INSTAGRAM_ACCESS_TOKEN', label: 'Token de Instagram', optional: true },
      { key: 'INSTAGRAM_USER_ID', label: 'ID de la cuenta de Instagram', optional: true },
      { key: 'THREADS_ACCESS_TOKEN', label: 'Token de Threads', optional: true },
      { key: 'THREADS_USER_ID', label: 'ID de usuario de Threads', optional: true },
    ],
    note: 'Proyecto de la comunidad: revisa su código antes de darle tokens. Ojo, el paquete sin «@mikusnuz/» es de otro autor.',
    help: 'https://github.com/mikusnuz/meta-mcp',
  },
];

/** A connector in your library, reusable by any agent. Values are `${secret:…}` references. */
export interface McpServer {
  id: string;
  name: string;
  preset: string | null;
  transport: 'stdio' | 'http';
  command: string;
  args: string[];
  url: string;
  env: Record<string, string>;
  headers: Record<string, string>;
}

/** Vault name for one of a connector's values. */
export const mcpSecret = (serverId: string, key: string) => `mcp_${serverId}_${key.toLowerCase()}`.slice(0, 64);

/** What each agent uses. Their connectors will be chosen by the agent itself once its AI runs. */
export interface WorkerAi {
  /** null: the office's provider. */
  provider: TextProvider | null;
  /** true: the office's key from Ajustes; false: their own (`agentKey`). */
  sharedKey: boolean;
  /** null: the office's model (or their provider's usual one, if it differs from the office's). */
  model: string | null;
  /** Connector ids from the library. */
  mcps: string[];
}

export const DEFAULT_WORKER_AI: WorkerAi = { provider: null, sharedKey: true, model: null, mcps: [] };
