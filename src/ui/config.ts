/** What the panel knows of the office settings and connector library (no secrets). */
import { DEFAULT_SETTINGS, type McpServer, type Settings } from '../sim/settings';

export const config = {
  settings: DEFAULT_SETTINGS as Settings,
  library: [] as McpServer[],
};

/** Asks the page to open Ajustes on a tab (main.ts owns the dialog and the light). */
export const openSettingsAt = (tab: 'general' | 'ai' | 'mcp' | 'project') => document.dispatchEvent(new CustomEvent('open-settings', { detail: tab }));
