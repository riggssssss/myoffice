/**
 * Composio Connect: Composio for people rather than developers, keyed by a ck_… key (Composio →
 * Settings → Sessions & API Key). It has no SDK: it's an MCP server at connect.composio.dev, so the
 * office speaks MCP to it. The apps are the same ones and connect the same way (their own sign-in
 * page); the key travels only in its one header, to that one address.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getJson, setJson } from './db';

const ENDPOINT = 'https://connect.composio.dev/mcp';
const TIMEOUT = 60_000;
const IDLE = 10 * 60_000;

let open: { key: string; client: Client; used: number } | null = null;

async function session(key: string): Promise<Client> {
  if (open && (open.key !== key || Date.now() - open.used > IDLE)) {
    void open.client.close().catch(() => undefined);
    open = null;
  }
  if (!open) {
    const client = new Client({ name: 'oficina-3d', version: '1.0.0' });
    // No redirects: the key goes to connect.composio.dev and nowhere else.
    const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), { requestInit: { headers: { 'x-consumer-api-key': key }, redirect: 'error' } });
    await client.connect(transport, { timeout: TIMEOUT });
    open = { key, client, used: Date.now() };
  }
  open.used = Date.now();
  return open.client;
}

/** One of Connect's tools; its answer as JSON (`{successful, data, error}`). */
async function call(key: string, name: string, args: Record<string, unknown>): Promise<{ successful?: boolean; data?: Record<string, unknown>; error?: unknown }> {
  let client = await session(key);
  let r;
  try {
    r = await client.callTool({ name, arguments: args }, undefined, { timeout: TIMEOUT });
  } catch (e) {
    // A dropped session: once more on a fresh one.
    open = null;
    client = await session(key);
    r = await client.callTool({ name, arguments: args }, undefined, { timeout: TIMEOUT }).catch(() => {
      throw e;
    });
  }
  const text = (r.content as { type: string; text?: string }[] | undefined)?.find((c) => c.type === 'text')?.text ?? '';
  if (r.isError) throw new Error(text.slice(0, 300) || 'Composio no respondió');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 300) || 'Respuesta de Composio no válida');
  }
}

/** Apps connected from here: Connect only lists the ones it's asked about. */
const mine = () => getJson<string[]>('apps:connect') ?? [];
const remember = (slug: string, on: boolean) => setJson('apps:connect', on ? [...new Set([...mine(), slug])] : mine().filter((s) => s !== slug));

/** The apps you connected on Composio's own site, as Connect tells the agents. */
async function connectedThere(key: string): Promise<string[]> {
  const client = await session(key);
  const { tools } = await client.listTools(undefined, { timeout: TIMEOUT });
  const about = tools.find((t) => t.name === 'COMPOSIO_SEARCH_TOOLS')?.description ?? '';
  const m = /connected the apps:\s*([a-z0-9_,\s-]+)/i.exec(about);
  return m ? m[1].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
}

export interface ConnectAccount {
  slug: string;
  id: string;
  status: string;
}

/** Your connections: the ones made on Composio's site plus the ones started here (and `also`). */
export async function connectList(key: string, also: string[] = []): Promise<ConnectAccount[]> {
  const slugs = [...new Set([...(await connectedThere(key)), ...mine(), ...also])].slice(0, 100);
  if (!slugs.length) return [];
  const r = await call(key, 'COMPOSIO_MANAGE_CONNECTIONS', { toolkits: slugs.map((name) => ({ name, action: 'list' })) });
  const results = (r.data?.results ?? {}) as Record<string, { status?: string; accounts?: { id: string; status?: string; is_default?: boolean }[] }>;
  const out: ConnectAccount[] = [];
  for (const slug of slugs) {
    const accounts = results[slug]?.accounts ?? [];
    // Asked about but never connected: Connect says "initiated" with no account.
    if (!accounts.length) continue;
    const best = accounts.find((a) => a.status?.toUpperCase() === 'ACTIVE') ?? accounts.find((a) => a.is_default) ?? accounts[0];
    out.push({ slug, id: best.id, status: (best.status ?? results[slug]?.status ?? '').toUpperCase() });
  }
  return out;
}

/** The first https address anywhere in an answer under a key that says it's the link. */
function linkIn(x: unknown): string | null {
  if (!x || typeof x !== 'object') return null;
  for (const [k, v] of Object.entries(x)) {
    if (typeof v === 'string' && /redirect|url|link/i.test(k) && /^https:\/\//.test(v)) return v;
    const deeper = linkIn(v);
    if (deeper) return deeper;
  }
  return null;
}

/** The page where you sign in to an app. */
export async function connectAdd(key: string, slug: string): Promise<string> {
  const r = await call(key, 'COMPOSIO_MANAGE_CONNECTIONS', { toolkits: [{ name: slug, action: 'add' }] });
  const url = linkIn(r.data);
  if (!url) throw new Error(typeof r.error === 'string' && r.error ? r.error : 'Composio no ha dado enlace para conectar: puede que esa app no exista o ya esté conectada');
  remember(slug, true);
  return url;
}

export async function connectRemove(key: string, slug: string): Promise<void> {
  const list = await call(key, 'COMPOSIO_MANAGE_CONNECTIONS', { toolkits: [{ name: slug, action: 'list' }] });
  const accounts = ((list.data?.results as Record<string, { accounts?: { id: string }[] }> | undefined)?.[slug]?.accounts ?? []).map((a) => a.id);
  if (accounts.length) await call(key, 'COMPOSIO_MANAGE_CONNECTIONS', { toolkits: accounts.map((account_id) => ({ name: slug, action: 'remove', account_id })) });
  remember(slug, false);
}

export interface ConnectTool {
  slug: string;
  description: string;
  parameters: { properties?: Record<string, { type?: unknown; description?: string }>; required?: string[] } | undefined;
}

/** The actions for something, within one app. */
export async function connectSearch(key: string, app: string, what: string): Promise<ConnectTool[]> {
  const r = await call(key, 'COMPOSIO_SEARCH_TOOLS', { queries: [{ use_case: `${what} in ${app}`.slice(0, 1000) }], session: { generate_id: true } });
  const schemas = (r.data?.tool_schemas ?? {}) as Record<string, { toolkit?: string; description?: string; input_schema?: ConnectTool['parameters'] }>;
  const results = (r.data?.results ?? []) as { primary_tool_slugs?: string[]; related_tool_slugs?: string[] }[];
  const order = [...new Set(results.flatMap((x) => [...(x.primary_tool_slugs ?? []), ...(x.related_tool_slugs ?? [])]))];
  const prefix = `${app.replace(/-/g, '_').toUpperCase()}_`;
  const slugs = order.filter((s) => s.startsWith(prefix)).slice(0, 6);
  // Some come without their full input: ask for those.
  const lacking = slugs.filter((s) => !schemas[s]?.input_schema);
  if (lacking.length) Object.assign(schemas, await schemasOf(key, lacking));
  return slugs.map((slug) => ({ slug, description: schemas[slug]?.description ?? '', parameters: schemas[slug]?.input_schema }));
}

async function schemasOf(key: string, slugs: string[]): Promise<Record<string, { description?: string; input_schema?: ConnectTool['parameters'] }>> {
  const r = await call(key, 'COMPOSIO_GET_TOOL_SCHEMAS', { tool_slugs: slugs });
  return (r.data?.tool_schemas ?? {}) as Record<string, { description?: string; input_schema?: ConnectTool['parameters'] }>;
}

/** Whether an action exists. */
export async function connectHas(key: string, slug: string): Promise<boolean> {
  return !!(await schemasOf(key, [slug]).catch(() => ({}) as Record<string, unknown>))[slug];
}

/** Run one action: the same shape of answer as the SDK's. */
export async function connectRun(key: string, slug: string, args: Record<string, unknown>): Promise<{ data: Record<string, unknown>; error: string | null; successful: boolean }> {
  const r = await call(key, 'COMPOSIO_MULTI_EXECUTE_TOOL', { tools: [{ tool_slug: slug, arguments: args }], sync_response_to_workbench: false });
  const one = ((r.data?.results ?? []) as { response?: { successful?: boolean; data?: Record<string, unknown>; error?: string | null }; error?: string }[])[0];
  if (one?.response) return { data: one.response.data ?? {}, error: one.response.error ?? null, successful: one.response.successful !== false };
  return { data: {}, error: one?.error ?? (typeof r.error === 'string' ? r.error : 'error desconocido'), successful: false };
}

/** Composio Connect's well-used apps, for the catalog (Connect can't list its own). */
export const CONNECT_APPS: { slug: string; name: string; category: string; about: string }[] = [
  ['gmail', 'Gmail', 'Correo', 'Leer, buscar y enviar correos.'],
  ['outlook', 'Outlook', 'Correo', 'Correo y calendario de Microsoft.'],
  ['googlecalendar', 'Google Calendar', 'Productividad', 'Ver y crear eventos.'],
  ['googledrive', 'Google Drive', 'Documentos', 'Buscar, leer y subir archivos.'],
  ['googledocs', 'Google Docs', 'Documentos', 'Leer y escribir documentos.'],
  ['googlesheets', 'Google Sheets', 'Documentos', 'Leer y escribir hojas de cálculo.'],
  ['googleslides', 'Google Slides', 'Documentos', 'Presentaciones.'],
  ['googletasks', 'Google Tasks', 'Productividad', 'Listas de tareas.'],
  ['googlemeet', 'Google Meet', 'Productividad', 'Reuniones.'],
  ['googlephotos', 'Google Photos', 'Diseño', 'Álbumes y fotos.'],
  ['google_analytics', 'Google Analytics', 'Analítica', 'Visitas y conversiones de tu web.'],
  ['google_search_console', 'Search Console', 'Analítica', 'Cómo te encuentran en Google.'],
  ['googleads', 'Google Ads', 'Marketing', 'Campañas de anuncios.'],
  ['youtube', 'YouTube', 'Redes', 'Vídeos, canales y estadísticas.'],
  ['linkedin', 'LinkedIn', 'Redes', 'Publicar como tú y ver estadísticas.'],
  ['pinterest', 'Pinterest', 'Redes', 'Tableros y pines: leer y crear.'],
  ['reddit', 'Reddit', 'Redes', 'Buscar, leer y publicar en comunidades.'],
  ['twitter', 'X (Twitter)', 'Redes', 'Leer y publicar posts.'],
  ['instagram', 'Instagram', 'Redes', 'Publicaciones y estadísticas.'],
  ['facebook', 'Facebook', 'Redes', 'Páginas y publicaciones.'],
  ['metaads', 'Meta Ads', 'Marketing', 'Anuncios de Facebook e Instagram.'],
  ['tiktok', 'TikTok', 'Redes', 'Vídeos y estadísticas.'],
  ['discord', 'Discord', 'Mensajes', 'Servidores y canales.'],
  ['slack', 'Slack', 'Mensajes', 'Canales y mensajes del equipo.'],
  ['telegram', 'Telegram', 'Mensajes', 'Mensajes y canales.'],
  ['whatsapp', 'WhatsApp', 'Mensajes', 'Mensajes de WhatsApp Business.'],
  ['microsoft_teams', 'Microsoft Teams', 'Mensajes', 'Chats y canales.'],
  ['zoom', 'Zoom', 'Productividad', 'Reuniones.'],
  ['calendly', 'Calendly', 'Productividad', 'Citas y agendas.'],
  ['notion', 'Notion', 'Documentos', 'Páginas y bases de datos.'],
  ['confluence', 'Confluence', 'Documentos', 'Wiki del equipo.'],
  ['dropbox', 'Dropbox', 'Documentos', 'Archivos en la nube.'],
  ['one_drive', 'OneDrive', 'Documentos', 'Archivos de Microsoft.'],
  ['airtable', 'Airtable', 'Documentos', 'Bases de datos en tablas.'],
  ['typeform', 'Typeform', 'Marketing', 'Formularios y respuestas.'],
  ['figma', 'Figma', 'Diseño', 'Archivos, comentarios y componentes.'],
  ['canva', 'Canva', 'Diseño', 'Diseños y plantillas.'],
  ['dribbble', 'Dribbble', 'Diseño', 'Tus shots.'],
  ['miro', 'Miro', 'Diseño', 'Pizarras.'],
  ['trello', 'Trello', 'Tareas', 'Tableros y tarjetas.'],
  ['asana', 'Asana', 'Tareas', 'Proyectos y tareas.'],
  ['linear', 'Linear', 'Tareas', 'Incidencias y proyectos.'],
  ['jira', 'Jira', 'Tareas', 'Incidencias y sprints.'],
  ['clickup', 'ClickUp', 'Tareas', 'Tareas y documentos.'],
  ['monday', 'monday.com', 'Tareas', 'Tableros de trabajo.'],
  ['todoist', 'Todoist', 'Tareas', 'Listas de tareas.'],
  ['github', 'GitHub', 'Desarrollo', 'Repositorios, incidencias y PR.'],
  ['gitlab', 'GitLab', 'Desarrollo', 'Repositorios e incidencias.'],
  ['vercel', 'Vercel', 'Desarrollo', 'Despliegues de tu web.'],
  ['supabase', 'Supabase', 'Desarrollo', 'Base de datos y usuarios.'],
  ['sentry', 'Sentry', 'Desarrollo', 'Errores de tu app.'],
  ['shopify', 'Shopify', 'Ventas', 'Tienda, productos y pedidos.'],
  ['stripe', 'Stripe', 'Ventas', 'Pagos y clientes.'],
  ['gumroad', 'Gumroad', 'Ventas', 'Productos y ventas.'],
  ['hubspot', 'HubSpot', 'Ventas', 'Contactos y CRM.'],
  ['salesforce', 'Salesforce', 'Ventas', 'CRM.'],
  ['pipedrive', 'Pipedrive', 'Ventas', 'Embudo de ventas.'],
  ['apollo', 'Apollo', 'Ventas', 'Contactos y prospección.'],
  ['intercom', 'Intercom', 'Ventas', 'Atención al cliente.'],
  ['zendesk', 'Zendesk', 'Ventas', 'Soporte.'],
  ['mailchimp', 'Mailchimp', 'Marketing', 'Listas y campañas de correo.'],
  ['buffer', 'Buffer', 'Marketing', 'Programar publicaciones.'],
  ['semrush', 'Semrush', 'Marketing', 'SEO y palabras clave.'],
  ['ahrefs', 'Ahrefs', 'Marketing', 'SEO y enlaces.'],
  ['wordpress', 'WordPress', 'Marketing', 'Entradas y páginas.'],
  ['webflow', 'Webflow', 'Marketing', 'Tu web y su CMS.'],
  ['hackernews', 'Hacker News', 'Investigación', 'Noticias y debates de tecnología.'],
  ['perplexityai', 'Perplexity', 'Investigación', 'Búsqueda con fuentes.'],
  ['exa', 'Exa', 'Investigación', 'Buscador para IA.'],
  ['tavily', 'Tavily', 'Investigación', 'Buscador para IA.'],
  ['firecrawl', 'Firecrawl', 'Investigación', 'Leer webs enteras.'],
  ['elevenlabs', 'ElevenLabs', 'Diseño', 'Voces y audio.'],
].map(([slug, name, category, about]) => ({ slug, name, category, about }));
