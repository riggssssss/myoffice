import {
  siInstagram,
  siModelcontextprotocol,
  siReddit,
  siX,
  siPinterest,
  siYoutube,
  siGoogleanalytics,
  siNotion,
  siGithub,
  siGmail,
  siTiktok,
  siFacebook,
  siThreads,
  siDiscord,
  siTelegram,
  siFigma,
  siDribbble,
  siBehance,
  siShopify,
  siWordpress,
  siYcombinator,
  siRss,
  siGoogledrive,
  siGooglesearchconsole,
  siMailchimp,
  siHubspot,
  siAirtable,
  siTrello,
  siAsana,
  siLinear,
  siJira,
  siSupabase,
  siStripe,
  siWhatsapp,
  siBluesky,
  siMedium,
  siSubstack,
  siCloudflare,
} from 'simple-icons';
import { config } from './config';
import { icon } from './icons';

/**
 * Logos for the connector templates, drawn here (simple-icons, CC0) rather than loaded from
 * anyone's server. Brands simple-icons doesn't carry get their initial on their brand colour.
 */
type Mark = { path: string; hex: string } | { letter: string; hex: string };
const MARKS: Record<string, Mark> = {
  x: siX,
  reddit: siReddit,
  meta: siInstagram,
  fetch: siModelcontextprotocol,
  exa: { letter: 'E', hex: '1F40ED' },
  tavily: { letter: 'T', hex: '4F46E5' },
  firecrawl: { letter: 'F', hex: 'FF4C00' },
};

/** Brands a custom connector may be named after: its name picks the logo. */
const BY_NAME: [RegExp, Mark][] = [
  [/pinterest/i, siPinterest],
  [/linkedin/i, { letter: 'in', hex: '0A66C2' }],
  [/figma/i, siFigma],
  [/youtube/i, siYoutube],
  [/analytics|\bga4\b/i, siGoogleanalytics],
  [/search console|\bgsc\b/i, siGooglesearchconsole],
  [/notion/i, siNotion],
  [/slack/i, { letter: 'S', hex: '4A154B' }],
  [/github/i, siGithub],
  [/gmail/i, siGmail],
  [/tiktok/i, siTiktok],
  [/facebook/i, siFacebook],
  [/threads/i, siThreads],
  [/instagram|\bmeta\b/i, siInstagram],
  [/reddit/i, siReddit],
  [/twitter|\bx\b/i, siX],
  [/discord/i, siDiscord],
  [/telegram/i, siTelegram],
  [/figma/i, siFigma],
  [/dribbble/i, siDribbble],
  [/behance/i, siBehance],
  [/shopify/i, siShopify],
  [/wordpress/i, siWordpress],
  [/hacker ?news|\bhn\b/i, siYcombinator],
  [/\brss\b|feeds?\b/i, siRss],
  [/drive/i, siGoogledrive],
  [/mailchimp/i, siMailchimp],
  [/hubspot/i, siHubspot],
  [/airtable/i, siAirtable],
  [/trello/i, siTrello],
  [/asana/i, siAsana],
  [/linear/i, siLinear],
  [/jira/i, siJira],
  [/supabase/i, siSupabase],
  [/stripe/i, siStripe],
  [/whatsapp/i, siWhatsapp],
  [/bluesky/i, siBluesky],
  [/medium/i, siMedium],
  [/substack/i, siSubstack],
  [/canva/i, { letter: 'C', hex: '00C4CC' }],
  [/cloudflare/i, siCloudflare],
];

/** A connector's logo tile: its template's, else a brand its name mentions, else the MCP mark. */
export function brandLogo(preset: string | null, name: string): string {
  const m = MARKS[preset ?? ''] ?? BY_NAME.find(([re]) => re.test(name))?.[1] ?? (preset ? { letter: name.charAt(0).toUpperCase(), hex: '6B7280' } : siModelcontextprotocol);
  if ('path' in m) {
    // Black marks (X, MCP) take the text colour, so they show in the dark theme too.
    const fill = m.hex === '000000' ? 'var(--ink)' : `#${m.hex}`;
    return `<span class="app-logo brand-logo" style="--brand:${fill}" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18"><path d="${m.path}" /></svg></span>`;
  }
  return `<span class="app-logo brand-logo brand-letter${m.letter.length > 1 ? ' is-pair' : ''}" style="--brand:#${m.hex}" aria-hidden="true">${m.letter}</span>`;
}

/**
 * The small mark of where an agent is working, for the chat: one of your apps (by its id), one of
 * your connectors (`mcp:<id>`) or the open web. Brands drawn here when we have them; otherwise
 * Composio's own logo for that app (no referrer sent).
 */
export function appLogo(app: string, cls = ''): string {
  const base = `app-logo brand-logo app-mark${cls ? ` ${cls}` : ''}`;
  if (app === 'web') return `<span class="${base} is-web" aria-hidden="true">${icon.globe(13)}</span>`;
  if (app.startsWith('mcp:')) {
    const srv = config.library.find((s) => s.id === app.slice(4));
    return brandLogo(srv?.preset ?? null, srv?.name ?? 'MCP').replace('app-logo brand-logo', base);
  }
  const m = BY_NAME.find(([re]) => re.test(app.replace(/[_-]+/g, ' ')))?.[1];
  if (m && 'path' in m) {
    const fill = m.hex === '000000' ? 'var(--ink)' : `#${m.hex}`;
    return `<span class="${base}" style="--brand:${fill}" aria-hidden="true"><svg viewBox="0 0 24 24" width="13" height="13"><path d="${m.path}" /></svg></span>`;
  }
  return `<img class="${base} is-img" src="https://logos.composio.dev/api/${encodeURIComponent(app)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
}
