/**
 * Your apps, connected through Composio (1000+ of them: Gmail, Slack, Notion, Drive, GitHub,
 * Instagram…). Composio keeps each app's sign-in (OAuth) on its side, tied to your Composio
 * account; this office keeps only your Composio key (in the vault), an anonymous id for you, and
 * how far each app may be used. Reading is free; anything that writes, sends or publishes waits
 * for your approval unless you say otherwise, app by app.
 */

/** One app in the catalog. */
export interface AppInfo {
  slug: string;
  name: string;
  about: string;
  logo: string;
  categories: string[];
  /** How many actions it offers. */
  tools: number;
  /** Connects in one click (Composio signs you in, or it needs no sign-in at all). */
  ready: boolean;
}

/** How far the agents may go in one app. */
export type AppAccess = 'read' | 'ask' | 'auto';
export const APP_ACCESS: { id: AppAccess; label: string; note: string }[] = [
  { id: 'read', label: 'Solo leer', note: 'Pueden consultar, nunca escribir ni enviar' },
  { id: 'ask', label: 'Escribir con tu permiso', note: 'Lo que escriba, envíe o publique te llega para aprobar' },
  { id: 'auto', label: 'Escribir sin preguntar', note: 'Actúan solos (salvo justo después de leer algo de fuera: entonces te preguntan)' },
];
export const DEFAULT_ACCESS: AppAccess = 'ask';

/** An app you've connected (or are connecting). */
export interface AppConnection {
  slug: string;
  /** Composio's connected-account id. */
  id: string;
  status: 'active' | 'pending' | 'failed' | 'expired' | 'off';
  access: AppAccess;
}

/** What Ajustes → Conectores shows: never a key, never a token. */
export interface AppsView {
  /** Your Composio key is in the vault. */
  key: boolean;
  /** Which Composio: a project's (ak_, the full catalog) or Composio Connect (ck_). */
  via?: 'project' | 'connect';
  connections: AppConnection[];
  /** Something went wrong talking to Composio (bad key, no network…). */
  error: string | null;
}

/** Something an agent wants to do in one of your apps that needs your yes. */
export interface AppAction {
  id: string;
  at: number;
  by: string;
  byName: string;
  /** Through Composio (an app) or one of your MCP connectors. */
  via: 'composio' | 'mcp';
  /** The app's slug, or the connector's id. */
  app: string;
  /** The action, e.g. GMAIL_SEND_EMAIL, or the connector's tool name. */
  tool: string;
  /** What it does, in plain words (from the agent). */
  why: string;
  args: Record<string, unknown>;
  status: 'open' | 'done' | 'rejected' | 'failed';
  result: string | null;
}

/** Valid app slug (Composio's toolkit ids are lowercase words, digits, dashes and underscores). */
export const APP_SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
