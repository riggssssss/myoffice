import { guessLocation } from '../scene/sun';
import { DEFAULT_SOFA_COLOR, SOFA_COLORS, DEFAULT_WORK_PER_HOUR, IMAGE_QUALITY, KEYS, MAX_CHAIN, WORK_PACE, type ImageQuality, type ImageUsage, MCP_PRESETS, mcpSecret, modelLabel, NVIDIA_MODELS, PROVIDERS, validModel, type AiChoice, type McpPreset, type McpServer, type Settings, type TextProvider } from '../sim/settings';
import { api, fileUrl, getState, setOfficeInfo } from '../sim/store';
import type { ChatFile } from '../sim/types';
import { esc } from './dom';
import { icon } from './icons';
import { config } from './config';
import { bindKeyFields, hasSecret, keyField, loadSecrets } from './keyField';
import { modelInput } from './modelInput';
import { loadProject, projectChange, projectClick, projectPanel, projectSubmit, watchProject } from './projectSettings';
import { appsChange, appsClick, appsInput, appsPanel, COMPOSIO_KEY, composioKeySection, loadApps } from './appsSettings';
import { brandLogo } from './brandLogos';
import { linkedinChange, linkedinClick, linkedinInput, linkedinPanel } from './linkedinPanel';
import { APP_ACCESS, type AppAccess } from '../sim/apps';

type Tab = 'general' | 'ai' | 'mcp' | 'project';

const COMPASS = [
  [0, 'Norte'],
  [45, 'Noreste'],
  [90, 'Este'],
  [135, 'Sureste'],
  [180, 'Sur'],
  [225, 'Suroeste'],
  [270, 'Oeste'],
  [315, 'Noroeste'],
] as const;

let library: McpServer[] = [];

export async function loadLibrary(): Promise<McpServer[]> {
  library = config.library = await api<McpServer[]>('/api/mcp');
  return library;
}

/** Office preferences, the AI and your connector library. Calls back when settings change. */
/** How each provider's keys start, shown in the empty field so a wrong paste is easy to spot. */
let appsChanged: () => void = () => undefined;
/** Connectors: whether each runs, and the agents' permission with it (from the server). */
let mcpState: Record<string, { state: 'on' | 'failed' | 'idle'; tools: number; why: string; access: AppAccess }> = {};
const mcpTesting = new Set<string>();
const loadMcpState = async () => {
  mcpState = await api<typeof mcpState>('/api/mcp/status').catch(() => mcpState);
};

const KEY_SHAPE: Partial<Record<TextProvider, string>> = { anthropic: 'sk-ant-…', groq: 'gsk_…', nvidia: 'nvapi-…' };

export async function openSettings(current: Settings, onSaved: (s: Settings) => void, start: Tab = 'general'): Promise<void> {
  const d = document.getElementById('settings-dialog') as HTMLDialogElement;
  let settings = current;
  let tab: Tab = start;
  /** Connectors tab: the library, the preset picker, or one connector being set up. */
  let mcpView: { mode: 'list' } | { mode: 'pick' } | { mode: 'edit'; id: string; preset: McpPreset | null } = { mode: 'list' };
  /** «Probar con una imagen»: how it went (ok: the picture's address on this page). */
  let imageTest: { state: 'idle' | 'busy' | 'ok' | 'bad'; text: string } = { state: 'idle', text: '' };
  /** Today's free Cloudflare allowance, kept fresh while the IA tab is open. */
  let usage: ImageUsage | null = null;
  const loadImageUsage = async () => {
    usage = await api<ImageUsage>('/api/images/usage').catch(() => usage);
  };
  /** The provider picked in "Añadir IA". */
  let addProvider: TextProvider = current.ai.chain.some((c) => c.provider === 'groq') ? 'anthropic' : 'groq';
  try {
    await Promise.all([loadSecrets(), loadLibrary(), loadProject(), loadImageUsage()]);
  } catch {
    /* shown as unconfigured; saving will report the problem */
  }

  const save = async (patch: Partial<Settings>) => {
    settings = config.settings = await api<Settings>('/api/settings', 'PUT', patch);
    onSaved(settings);
  };

  // ---------------------------------------------------------------- general

  const general = () => {
    const loc = settings.location ?? { ...guessLocation(), guessed: true };
    const north = ((Math.round(settings.north / 45) * 45) % 360 + 360) % 360;
    return `
      <form class="settings-form" data-general novalidate>
        <section class="settings-section">
          <h3 class="section-title">Tu oficina</h3>
          <div class="field">
            <label for="s-agency">Nombre de la oficina</label>
            <input id="s-agency" name="agency" maxlength="60" value="${esc(getState().agency)}" placeholder="Mi oficina" autocomplete="off" />
          </div>
          <div class="field">
            <label for="s-project">Producto en el que trabaja</label>
            <input id="s-project" name="project" maxlength="80" value="${esc(getState().project)}" placeholder="Ej. Tienda online de cerámica" autocomplete="off" />
          </div>
        </section>
        <section class="settings-section">
          <h3 class="section-title">Ubicación de la oficina</h3>
          <p class="section-note">El sol entra por las ventanas como lo hace ahora mismo aquí: amanecer, atardecer y noche.${
            loc.guessed ? ' Por ahora se deduce de tu zona horaria.' : ''
          }</p>
          <div class="field">
            <label for="s-place">Lugar</label>
            <input id="s-place" name="place" maxlength="80" value="${esc(loc.place)}" autocomplete="off" />
          </div>
          <div class="field-row">
            <div class="field">
              <label for="s-lat">Latitud</label>
              <input id="s-lat" name="lat" type="number" min="-90" max="90" step="0.01" inputmode="decimal" value="${loc.lat}" />
            </div>
            <div class="field">
              <label for="s-lon">Longitud</label>
              <input id="s-lon" name="lon" type="number" min="-180" max="180" step="0.01" inputmode="decimal" value="${loc.lon}" />
            </div>
          </div>
          <button class="btn" type="button" data-locate>Usar mi ubicación</button>
          <div class="field">
            <label for="s-north">La pared del fondo mira al…</label>
            <select id="s-north" name="north">${COMPASS.map(([deg, name]) => `<option value="${deg}" ${deg === north ? 'selected' : ''}>${name}</option>`).join('')}</select>
          </div>
        </section>
        <section class="settings-section">
          <h3 class="section-title">Sofá de la recepción</h3>
          <p class="section-note">Terciopelo. Elige un color: lo ves en la oficina al momento y queda al guardar.</p>
          <div class="sofa-swatches" role="group" aria-label="Colores de terciopelo">
            ${SOFA_COLORS.map(([hex, name]) => `<button class="sofa-swatch" type="button" data-sofa-swatch="${hex}" style="--swatch:${hex}" aria-pressed="${(settings.sofaColor ?? DEFAULT_SOFA_COLOR) === hex}" title="${name}" aria-label="${name}"></button>`).join('')}
            <label class="sofa-custom" title="Otro color">
              <span class="sr-only">Otro color</span>
              <input id="s-sofa" name="sofaColor" type="color" value="${esc(settings.sofaColor ?? DEFAULT_SOFA_COLOR)}" />
            </label>
          </div>
        </section>
        <p class="field-error" id="s-error" role="alert" hidden></p>
        <footer class="dialog-foot">
          <button class="btn btn-primary" type="submit">Guardar</button>
        </footer>
      </form>`;
  };

  // ---------------------------------------------------------------- AI

  /** Your AIs in order: drag the grip (or use the arrow keys on it) to reorder. */
  const chainList = () => {
    const { chain } = settings.ai;
    const status = getState().ai;
    const time = (t: number) => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(t);
    const restOf = (c: AiChoice) => status.resting.find((r) => r.provider === c.provider && r.model === c.model && r.until > Date.now());
    const keyless = (c: AiChoice) => !!PROVIDERS[c.provider].key && !hasSecret(PROVIDERS[c.provider].key!);
    // The one they think with now: the first with its key that isn't resting.
    const current = chain.findIndex((c) => !restOf(c) && !keyless(c));
    return `<ol class="chain" data-chain>${chain
      .map((c, i) => {
        const info = PROVIDERS[c.provider];
        const rest = restOf(c);
        const noKey = keyless(c);
        const now = i === current;
        const meta = noKey
          ? `<span class="danger">falta la clave de ${esc(info.label)}</span> · <button class="link" type="button" data-key-for="${c.provider}">Ponerla</button>`
          : rest
            ? `<span class="chain-rest">en pausa: ${esc(rest.why)} · vuelve ${time(rest.until)}</span>`
            : now
              ? '<span class="chain-now">piensan con esta</span>'
              : 'de reserva';
        const label = `${modelLabel(c)}, ${info.label}`;
        return `
          <li class="chain-row${rest || noKey ? ' is-off' : ''}" data-chain-i="${i}">
            <button class="chain-grip" type="button" data-chain-grip aria-label="Mover ${esc(label)}: posición ${i + 1} de ${chain.length}. Flechas arriba y abajo para cambiarla">${icon.grip(16)}</button>
            <span class="chain-num num" aria-hidden="true">${i + 1}</span>
            <span class="mcp-main">
              <span class="mcp-name">${esc(modelLabel(c))}</span>
              <span class="meta">${esc(info.label)} · ${meta}</span>
            </span>
            <button class="btn btn-ghost btn-sm btn-danger-text" type="button" data-chain-del="${i}" aria-label="Quitar ${esc(label)}" ${chain.length < 2 ? 'disabled' : ''}>${icon.trash(14)}</button>
          </li>`;
      })
      .join('')}</ol>`;
  };

  const saveChain = async (chain: AiChoice[], focus: number | null = null) => {
    await save({ ai: { chain } as Settings['ai'] });
    render();
    if (focus === null) return;
    body.querySelectorAll<HTMLElement>('[data-chain-grip]')[focus]?.focus();
    const say = body.querySelector<HTMLElement>('[data-chain-say]');
    if (say) say.textContent = `${modelLabel(chain[focus])}, ahora en la posición ${focus + 1} de ${chain.length}`;
  };

  const ai = () => {
    const provider = settings.ai.provider;
    const image = settings.image.provider;
    return `
      <div class="settings-form">
        <p class="settings-lead">Estas claves sirven a toda la oficina: cada agente usa la de su proveedor salvo que le pongas una propia en su ficha. Se guardan cifradas en este ordenador; ni esta página puede volver a leerlas.</p>
        <section class="settings-section">
          <h3 class="section-title">IA de texto, por prioridad</h3>
          <p class="section-note">Piensan con la primera. Si llega a un límite (por minuto, del día o sin saldo) o falla, pasan a la siguiente sin pararse, y vuelven a ella en cuanto se recupera. Arrastra para cambiar el orden.</p>
          ${chainList()}
          <p class="sr-only" aria-live="polite" data-chain-say></p>
          <div class="chain-add">
            <div class="field">
              <label for="s-add-provider">Añadir IA</label>
              <select id="s-add-provider" data-add-provider>
                ${(Object.keys(PROVIDERS) as TextProvider[]).map((p) => `<option value="${p}" ${p === addProvider ? 'selected' : ''}>${PROVIDERS[p].label}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label for="s-add-model">Modelo</label>
              ${modelInput('s-add-model', addProvider, null, 'data-add-model')}
            </div>
            <button class="btn" type="button" data-chain-add ${settings.ai.chain.length >= MAX_CHAIN ? 'disabled' : ''}>${icon.plus(15)}Añadir</button>
          </div>
          ${
            PROVIDERS[addProvider].key
              ? `<div class="chain-key">${keyField(PROVIDERS[addProvider].key!, `Clave de ${PROVIDERS[addProvider].label}`, { help: PROVIDERS[addProvider].help, test: addProvider, placeholder: KEY_SHAPE[addProvider] })}</div>`
              : ''
          }
          <p class="field-error" id="chain-error" role="alert" hidden></p>
          ${addProvider === 'ollama' ? '<p class="section-note">Los modelos locales usan peor las herramientas en varios pasos que Claude.</p>' : ''}
          ${
            addProvider === 'nvidia'
              ? `<p class="section-note">NVIDIA es gratis para desarrolladores: con una sola clave usas todos sus modelos (<a href="https://build.nvidia.com/moonshotai/kimi-k3" target="_blank" rel="noopener noreferrer">consíguela aquí</a>). Cada modelo tiene su propio límite, así que lo mejor es meter varios: cuando uno está ocupado o limitado, responde el siguiente.</p>
                 <button class="btn btn-sm" type="button" data-chain-nvidia ${settings.ai.chain.length >= MAX_CHAIN ? 'disabled' : ''}>${icon.plus(14)}Añadir varios de NVIDIA para que se turnen</button>`
              : ''
          }
          ${addProvider === 'groq' ? `<p class="section-note">Groq cambia a menudo su catálogo: puedes escribir cualquier modelo de <a href="https://console.groq.com/docs/models" target="_blank" rel="noopener noreferrer">su lista</a>. Cada modelo tiene su propio cupo: dos modelos de Groq en la lista suman cupos.</p>` : ''}
        </section>
        <section class="settings-section">
          <h3 class="section-title">Gasto</h3>
          <div class="field">
            <label for="s-daily">Límite diario de tokens para toda la oficina</label>
            <span class="daily-row">
              <input id="s-daily" data-ai="dailyTokens" type="number" min="10000" max="50000000" step="10000" inputmode="numeric" value="${settings.ai.dailyTokens || 300_000}" ${settings.ai.dailyTokens ? '' : 'disabled'} />
              <label class="check"><input type="checkbox" data-unlimited ${settings.ai.dailyTokens ? '' : 'checked'} /> Sin límite</label>
            </span>
            <p class="section-note">Hoy van <span class="num">${getState().ai.tokensToday.toLocaleString('es-ES')}</span>. ${settings.ai.dailyTokens ? 'Al llegar al límite los agentes dejan de conversar hasta mañana.' : 'Sin límite: trabajan hasta donde dejen tus IAs (los planes gratis tienen sus propios topes).'} Una conversación suele gastar entre 3.000 y 15.000.</p>
          </div>
          <div class="field">
            <label for="s-pace">Ritmo de trabajo del equipo</label>
            <select id="s-pace" data-ai="workPerHour">
              ${WORK_PACE.map((p) => `<option value="${p.perHour}" ${(settings.ai.workPerHour ?? DEFAULT_WORK_PER_HOUR) === p.perHour ? 'selected' : ''}>${esc(p.label)}${p.perHour ? ` · ${p.perHour} turnos de trabajo a la hora` : ''} (${esc(p.note)})</option>`).join('')}
            </select>
            <p class="section-note">Cuántas veces a la hora se pone a trabajar alguien del equipo, entre todos. Con equipos grandes, es lo que más marca el gasto.</p>
          </div>
          <div class="field">
            <label for="s-terse">Cómo hablan entre ellos</label>
            <select id="s-terse" data-ai="terse">
              <option value="true" ${settings.ai.terse ? 'selected' : ''}>Al grano (gasta mucho menos)</option>
              <option value="false" ${settings.ai.terse ? '' : 'selected'}>Con naturalidad</option>
            </select>
            <p class="section-note">Al grano, entre ellos y en sus notas usan frases telegráficas, sin relleno ni cortesías. Contigo, y en los textos que entregan, siguen escribiendo con frases completas.</p>
          </div>
        </section>
        <section class="settings-section">
          <h3 class="section-title">IA en tu ordenador</h3>
          <div class="field">
            <label for="s-ollama">Dirección de Ollama${provider === 'ollama' ? '' : ' <span class="muted">(opcional)</span>'}</label>
            <input id="s-ollama" data-ai="ollamaUrl" value="${esc(settings.ai.ollamaUrl)}" autocomplete="off" spellcheck="false" />
          </div>
        </section>
        <section class="settings-section">
          <h3 class="section-title">Imágenes</h3>
          <div class="field">
            <label for="s-image">Para generar piezas de diseño</label>
            <select id="s-image" data-image>
              <option value="none" ${image === 'none' ? 'selected' : ''}>Sin generación de imágenes</option>
              <option value="cloudflare" ${image === 'cloudflare' ? 'selected' : ''}>Cloudflare Workers AI (gratis cada día)</option>
              <option value="fal" ${image === 'fal' ? 'selected' : ''}>fal.ai (muchos modelos con una clave)</option>
              <option value="recraft" ${image === 'recraft' ? 'selected' : ''}>Recraft (logos y vectores)</option>
            </select>
          </div>
          ${image === 'cloudflare' ? cloudflareFields() : ''}
          ${image === 'fal' ? keyField(KEYS.fal, 'Clave de fal.ai', { help: 'https://fal.ai/dashboard/keys' }) : ''}
          ${image === 'recraft' ? keyField(KEYS.recraft, 'Clave de Recraft', { help: 'https://www.recraft.ai/profile/api' }) : ''}
        </section>
        ${composioKeySection()}
      </div>`;
  };

  /** Cloudflare: account, token, quality, today's allowance and a test picture. */
  const cloudflareFields = () => {
    const q = settings.image.quality ?? 'equilibrada';
    const ready = hasSecret(KEYS.cfAccount) && hasSecret(KEYS.cfToken);
    return `
      <p class="section-note">Gratis hasta 10.000 «neuronas» al día. Crea una cuenta gratis en Cloudflare; el ID de cuenta está en el panel (Workers AI → «Use REST API») y el token, en Mi perfil → Tokens de API → plantilla «Workers AI». Para ver aquí tu saldo real, añade al token el permiso «Account Analytics: Read».</p>
      ${keyField(KEYS.cfAccount, 'ID de cuenta de Cloudflare', { help: 'https://dash.cloudflare.com/?to=/:account/ai/workers-ai', placeholder: '32 caracteres' })}
      ${keyField(KEYS.cfToken, 'Token de API de Cloudflare', { help: 'https://dash.cloudflare.com/profile/api-tokens' })}
      ${ready ? `<div class="cf-usage" data-cf-usage aria-live="polite">${usageMeter()}</div>` : ''}
      ${
        ready
          ? `<div class="field">
              <label for="s-image-usd">Gasto máximo al día, además de lo gratis (USD)</label>
              <input id="s-image-usd" data-image-usd type="number" inputmode="decimal" min="0" max="50" step="0.05" value="${settings.image.dailyUsd ?? 0}" />
              <p class="section-note">0 = nunca pasar del cupo gratis. Cloudflare cobra 0,011 $ por cada 1.000 neuronas de más: unos 0,03 $ por imagen Profesional y 0,015 $ por una Alta. Necesita su plan Workers Paid (5 $ al mes).</p>
            </div>`
          : ''
      }
      <div class="field">
        <label for="s-image-q">Calidad</label>
        <select id="s-image-q" data-image-quality>
          ${IMAGE_QUALITY.map((x) => `<option value="${x.id}" ${x.id === q ? 'selected' : ''}>${esc(x.label)} · ${ready && usage ? `te quedan ${usage.fits[x.id]} hoy` : `unas ${x.perDay} al día`} (${esc(x.note)})</option>`).join('')}
        </select>
      </div>
      ${
        ready
          ? `<div class="image-test">
              <button class="btn btn-sm" type="button" data-image-test ${imageTest.state === 'busy' ? 'disabled' : ''}>${icon.image(14)}${imageTest.state === 'busy' ? 'Generando…' : 'Probar con una imagen'}</button>
              ${imageTest.state === 'bad' ? `<p class="field-error">${esc(imageTest.text)}</p>` : ''}
              ${imageTest.state === 'ok' ? `<img class="image-test-pic" src="${imageTest.text}" alt="Imagen de prueba generada" />` : ''}
            </div>`
          : ''
      }`;
  };

  /** Today's free allowance: what's left, what it's enough for and when it comes back. */
  const usageMeter = () => {
    if (!usage) return '<p class="meta">Consultando tu saldo en Cloudflare…</p>';
    const left = Math.max(0, usage.free - usage.used);
    const share = left / usage.free;
    const pick = IMAGE_QUALITY.find((x) => x.id === usage!.quality) ?? IMAGE_QUALITY[1];
    const fits = usage.fits[pick.id];
    const until = Math.max(0, new Date(usage.resetsAt).getTime() - Date.now());
    const h = Math.floor(until / 3_600_000);
    const m = Math.floor((until % 3_600_000) / 60_000);
    const back = new Date(usage.resetsAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const checked = new Date(usage.checkedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const n = (v: number) => v.toLocaleString('es-ES');
    const usd = (v: number) => `${v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
    return `
      <div class="cf-usage-head">
        <span class="cf-usage-title">Saldo gratis de hoy</span>
        <span class="cf-usage-num"><b>${n(left)}</b> de ${n(usage.free)} neuronas</span>
      </div>
      <div class="bar bar-lg cf-usage-bar ${share < 0.15 ? 'is-low' : ''}" role="meter" aria-valuemin="0" aria-valuemax="${usage.free}" aria-valuenow="${left}" aria-label="Neuronas gratis que te quedan hoy"><i style="transform:scaleX(${share.toFixed(3)})"></i></div>
      <p class="cf-usage-line">${
        fits > 0
          ? `Te llega para <b>${fits} ${fits === 1 ? 'imagen' : 'imágenes'}</b> más en ${esc(pick.label)}`
          : `No queda para ninguna imagen más en ${esc(pick.label)}`
      } · se renueva a las ${back} (en ${h ? `${h} h ` : ''}${m} min)${usage.pictures ? ` · hoy has hecho ${usage.pictures}` : ''}</p>
      <p class="cf-usage-line">${
        usage.budgetUsd > 0
          ? `Gasto de hoy: <b>${usd(usage.spentUsd)}</b> de ${usd(usage.budgetUsd)}`
          : 'Sin gasto: al acabarse lo gratis, se para hasta el día siguiente'
      }</p>
      <p class="meta">${
        usage.source === 'cloudflare'
          ? `${icon.tick(12)}Datos de tu cuenta de Cloudflare · actualizado a las ${checked}`
          : esc(usage.why ? `${usage.why}. Mientras, es la cuenta de lo hecho desde esta app.` : 'Cuenta de lo hecho desde esta app.')
      }</p>`;
  };
  /** While the IA tab shows Cloudflare, the meter refreshes itself (just the meter: typing isn't interrupted). */
  let usageTimer = 0;
  const watchUsage = () => {
    window.clearInterval(usageTimer);
    const refresh = async () => {
      const box = body.querySelector<HTMLElement>('[data-cf-usage]');
      if (!d.open || !box) return window.clearInterval(usageTimer);
      if (document.hidden) return;
      await loadImageUsage();
      if (!box.isConnected) return;
      box.innerHTML = usageMeter();
      body.querySelectorAll<HTMLOptionElement>('[data-image-quality] option').forEach((o) => {
        const x = IMAGE_QUALITY.find((v) => v.id === o.value);
        if (x && usage) o.textContent = `${x.label} · te quedan ${usage.fits[x.id]} hoy (${x.note})`;
      });
    };
    usageTimer = window.setInterval(refresh, 20_000);
    if (!usage) void refresh();
  };

  // ---------------------------------------------------------------- connectors

  const fieldsOf = (srv: McpServer | undefined, preset: McpPreset | null) =>
    preset?.fields ??
    Object.keys({ ...srv?.env, ...srv?.headers }).map((key) =>
      key === 'Authorization' ? { key, label: 'Token de acceso', optional: true } : { key, label: key, optional: false },
    );
  const missing = (srv: McpServer) => {
    const preset = MCP_PRESETS.find((p) => p.id === srv.preset) ?? null;
    return fieldsOf(srv, preset).filter((f) => !f.optional && !hasSecret(mcpSecret(srv.id, f.key)));
  };

  const usersOf = (id: string) => getState().workers.filter((w) => w.ai.mcps.includes(id)).map((w) => w.name);
  const stateLine = (srv: McpServer) => {
    const st = mcpState[srv.id];
    if (mcpTesting.has(srv.id)) return '<span class="meta">Arrancando…</span>';
    if (st?.state === 'on') return `<span class="meta ok-text">${icon.tick(13)}Funciona · ${st.tools} herramienta${st.tools === 1 ? '' : 's'}</span>`;
    if (st?.state === 'failed') return `<span class="meta danger">${esc(st.why)}</span>`;
    return '<span class="meta">Sin probar: arranca cuando un agente lo necesite</span>';
  };

  const mcpList = () => `
    <div class="settings-form">
      <p class="settings-lead">Las apps donde trabajas (correo, redes, documentos, tareas…), conectadas con Composio: el equipo lee lo que necesite y, con tu permiso, escribe, envía o publica. Cada app se conecta en su propia página y el acceso queda en tu cuenta de Composio: si compartes la oficina, nadie se lleva tus apps.</p>
      ${appsPanel()}
      ${linkedinPanel()}
      <section class="settings-section">
        <h3 class="section-title">Servidores MCP <span class="muted">(avanzado)</span></h3>
        <p class="section-note">Programas en tu ordenador o servidores https que dan herramientas a los agentes (buscadores, lectores de webs…). Cada uno recibe solo sus propias claves. Márcalos en la ficha de cada agente (pestaña IA): solo quien lo tenga marcado lo usa.</p>
      ${
        library.length
          ? `<ul class="mcp-list">${library
              .map((srv) => {
                const preset = MCP_PRESETS.find((p) => p.id === srv.preset);
                const lack = missing(srv);
                const who = usersOf(srv.id);
                const access = mcpState[srv.id]?.access ?? 'ask';
                const readOnly = preset?.access === 'lectura';
                return `
                  <li class="mcp-row app-row">
                    ${brandLogo(srv.preset, srv.name)}
                    <span class="mcp-main">
                      <span class="mcp-name">${esc(srv.name)}</span>
                      ${lack.length ? `<span class="meta danger">Falta ${esc(lack.map((f) => f.label.toLowerCase()).join(', '))}</span>` : stateLine(srv)}
                      <span class="meta">${who.length ? `Lo usa${who.length > 1 ? 'n' : ''} ${esc(who.join(', '))}` : 'Ningún agente lo tiene marcado'} · ${srv.transport === 'http' ? 'remoto' : 'en tu ordenador'}</span>
                    </span>
                    <span class="mcp-actions">
                    ${
                      readOnly
                        ? '<span class="meta">Solo lee</span>'
                        : `<select class="app-access" data-mcp-access="${srv.id}" aria-label="Qué pueden hacer con ${esc(srv.name)}">
                            ${APP_ACCESS.map((x) => `<option value="${x.id}" ${x.id === access ? 'selected' : ''} title="${esc(x.note)}">${esc(x.label)}</option>`).join('')}
                          </select>`
                    }
                    <button class="btn btn-ghost btn-sm" type="button" data-mcp-test="${srv.id}" ${lack.length || mcpTesting.has(srv.id) ? 'disabled' : ''}>Probar</button>
                    <button class="btn btn-ghost btn-sm" type="button" data-mcp-edit="${srv.id}">Configurar</button>
                    <button class="btn btn-ghost btn-sm btn-danger-text" type="button" data-mcp-del="${srv.id}" aria-label="Quitar ${esc(srv.name)}">${icon.trash(14)}</button>
                    </span>
                  </li>`;
              })
              .join('')}</ul>
            <p class="section-note">Leer va directo. Lo que escriba o publique sigue el permiso de cada conector, y siempre te pregunta justo después de haber leído algo de fuera.</p>`
          : ''
      }
      <button class="btn" type="button" data-mcp-pick>${icon.plus(15)}Añadir servidor MCP</button>
      </section>
    </div>`;

  const mcpPick = () => {
    const free = MCP_PRESETS.filter((p) => !library.some((s) => s.id === p.id));
    return `
      <div class="settings-form">
        <button class="btn btn-ghost back" type="button" data-mcp-back>${icon.back(16)}Conectores</button>
        <p class="settings-lead">Servidores MCP revisados, con su versión fijada. Para tus cuentas (LinkedIn, Pinterest, Instagram…) usa las apps de Composio de la página anterior: los MCP que entran en ellas por scraping no están, porque arriesgan tu cuenta.</p>
        <ul class="mcp-presets">
          ${free
            .map(
              (p) => `
              <li><button class="mcp-preset" type="button" data-mcp-new="${p.id}">
                <span class="app-card-head">${brandLogo(p.id, p.name)}<span class="mcp-main"><span class="mcp-name">${esc(p.name)}</span><span class="meta">${esc(p.access)}</span></span></span>
                <span class="mcp-about">${esc(p.about)}</span>
              </button></li>`,
            )
            .join('')}
          <li><button class="mcp-preset" type="button" data-mcp-new="">
            <span class="app-card-head">${brandLogo(null, 'MCP')}<span class="mcp-main"><span class="mcp-name">Personalizado</span><span class="meta">cualquier servidor MCP</span></span></span>
            <span class="mcp-about">Un comando que se ejecuta en tu ordenador o una dirección https.</span>
          </button></li>
        </ul>
      </div>`;
  };

  const mcpEdit = (id: string, preset: McpPreset | null) => {
    const srv = library.find((s) => s.id === id);
    const custom = !preset;
    const vars = Object.keys({ ...srv?.env, ...srv?.headers });
    return `
      <form class="settings-form" data-mcp-form novalidate>
        <button class="btn btn-ghost back" type="button" data-mcp-back>${icon.back(16)}Conectores</button>
        <h3 class="mcp-title">${esc(preset?.name ?? srv?.name ?? 'Conector personalizado')}</h3>
        ${preset ? `<p class="section-note">${esc(preset.about)} <a href="${esc(preset.help)}" target="_blank" rel="noopener noreferrer">Más información</a></p>` : ''}
        ${preset?.note ? `<p class="settings-note">${esc(preset.note)}</p>` : ''}
        ${
          custom
            ? `<div class="field">
                 <label for="m-name">Nombre</label>
                 <input id="m-name" name="name" maxlength="60" value="${esc(srv?.name ?? '')}" autocomplete="off" />
               </div>
               <div class="field">
                 <label for="m-transport">Cómo se conecta</label>
                 <select id="m-transport" name="transport">
                   <option value="stdio" ${srv?.transport !== 'http' ? 'selected' : ''}>Comando en tu ordenador</option>
                   <option value="http" ${srv?.transport === 'http' ? 'selected' : ''}>Dirección https</option>
                 </select>
               </div>
               <div class="field">
                 <label for="m-target">Comando o dirección</label>
                 <input id="m-target" name="target" maxlength="400" value="${esc(srv ? (srv.transport === 'http' ? srv.url : [srv.command, ...srv.args].join(' ')) : '')}" placeholder="npx -y paquete@1.2.3  ·  https://…" autocomplete="off" spellcheck="false" />
               </div>
               <div class="field">
                 <label for="m-vars">Variables con claves, separadas por comas (solo para comandos; las direcciones llevan un token opcional)</label>
                 <input id="m-vars" name="vars" maxlength="300" value="${esc(vars.join(', '))}" placeholder="MI_API_KEY, OTRA_VARIABLE" autocomplete="off" spellcheck="false" />
               </div>`
            : ''
        }
        ${
          srv || preset
            ? fieldsOf(srv, preset)
                .map((f) => keyField(mcpSecret(id, f.key), f.label, { optional: f.optional }))
                .join('')
            : ''
        }
        <p class="field-error" id="m-error" role="alert" hidden></p>
        <footer class="dialog-foot">
          <button class="btn btn-primary" type="submit">${srv ? 'Guardar' : 'Añadir a la biblioteca'}</button>
        </footer>
      </form>`;
  };

  const panel = () => {
    if (tab === 'general') return general();
    if (tab === 'ai') return ai();
    if (tab === 'project') return projectPanel();
    if (mcpView.mode === 'pick') return mcpPick();
    if (mcpView.mode === 'edit') return mcpEdit(mcpView.id, mcpView.preset);
    return mcpList();
  };

  d.innerHTML = `
    <div class="settings">
      <header class="dialog-head">
        <h2 id="settings-title">Ajustes</h2>
        <button class="btn btn-icon" type="button" data-close aria-label="Cerrar">${icon.close(16)}</button>
      </header>
      <div class="tabs settings-tabs" role="tablist" aria-label="Ajustes">
        <button role="tab" data-tab="general">General</button>
        <button role="tab" data-tab="ai">IA</button>
        <button role="tab" data-tab="mcp">Conectores</button>
        <button role="tab" data-tab="project">Proyecto</button>
      </div>
      <div class="settings-body" role="tabpanel"></div>
    </div>`;
  const body = d.querySelector<HTMLElement>('.settings-body')!;
  const render = () => {
    // Conectores only once there's a Composio key (Ajustes → IA).
    const composio = hasSecret(COMPOSIO_KEY);
    if (tab === 'mcp' && !composio) tab = 'ai';
    d.querySelector<HTMLElement>('[data-tab="mcp"]')!.hidden = !composio;
    d.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    body.innerHTML = panel();
    if (body.querySelector('[data-cf-usage]')) watchUsage();
  };
  const fail = (id: string, text: string) => {
    const el = body.querySelector<HTMLElement>(`#${id}`);
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
  };
  bindKeyFields(body, render);
  watchProject(() => d.open && tab === 'project', render);

  d.onclick = async (e) => {
    const t = e.target as HTMLElement;
    if (t === d || t.closest('[data-close]')) return d.close();
    const tb = t.closest<HTMLElement>('[data-tab], [data-go-tab]');
    if (tb) {
      tab = (tb.dataset.tab ?? tb.dataset.goTab) as Tab;
      mcpView = { mode: 'list' };
      if (tab === 'project') await loadProject();
      if (tab === 'mcp') {
        render();
        await Promise.all([loadApps(), loadMcpState()]);
      }
      return render();
    }
    if (tab === 'project' && (await projectClick(t, render))) return;
    if (tab === 'mcp' && (await linkedinClick(t, render))) return;
    if (tab === 'mcp' && (await appsClick(t, render))) return;
    if (t.closest('[data-locate]')) return locate();
    const swatch = t.closest<HTMLElement>('[data-sofa-swatch]');
    if (swatch) {
      const box = d.querySelector<HTMLInputElement>('#s-sofa')!;
      box.value = swatch.dataset.sofaSwatch!;
      box.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (t.closest('[data-image-test]')) {
      imageTest = { state: 'busy', text: '' };
      render();
      try {
        const f = await api<ChatFile>('/api/images/test', 'POST');
        imageTest = { state: 'ok', text: await fileUrl(f.id) };
      } catch (e) {
        imageTest = { state: 'bad', text: e instanceof Error ? e.message : 'No salió' };
      }
      await loadImageUsage();
      return render();
    }
    const delAi = t.closest<HTMLElement>('[data-chain-del]');
    if (delAi) return saveChain(settings.ai.chain.filter((_, i) => i !== Number(delAi.dataset.chainDel)));
    const keyFor = t.closest<HTMLElement>('[data-key-for]');
    if (keyFor) {
      // The add box switches to that provider, with its key field ready.
      addProvider = keyFor.dataset.keyFor as TextProvider;
      render();
      body.querySelector<HTMLInputElement>('.chain-key [data-key-input]')?.focus();
      return;
    }
    if (t.closest('[data-chain-nvidia]')) {
      // The bigger ones first, as many as fit, skipping any already there.
      const have = (m: string) => settings.ai.chain.some((c) => c.provider === 'nvidia' && c.model === m);
      const room = MAX_CHAIN - settings.ai.chain.length;
      const add = NVIDIA_MODELS.filter((m) => !have(m.id)).slice(0, Math.min(4, room)).map((m) => ({ provider: 'nvidia' as const, model: m.id }));
      if (!add.length) return fail('chain-error', room ? 'Ya están en la lista.' : 'La lista está llena: quita alguna antes.');
      return saveChain([...settings.ai.chain, ...add]);
    }
    if (t.closest('[data-chain-add]')) {
      const model = body.querySelector<HTMLInputElement | HTMLSelectElement>('[data-add-model]')!.value.trim() || PROVIDERS[addProvider].defaultModel;
      if (settings.ai.chain.some((c) => c.provider === addProvider && c.model === model)) return fail('chain-error', 'Esa IA ya está en la lista.');
      if (!validModel(addProvider, model)) return fail('chain-error', 'Ese nombre de modelo no vale: copia el identificador tal cual de la lista del proveedor.');
      return saveChain([...settings.ai.chain, { provider: addProvider, model }]);
    }
    if (t.closest('[data-mcp-pick]')) {
      mcpView = { mode: 'pick' };
      return render();
    }
    if (t.closest('[data-mcp-back]')) {
      mcpView = { mode: 'list' };
      return render();
    }
    const nw = t.closest<HTMLElement>('[data-mcp-new]');
    if (nw) {
      const preset = MCP_PRESETS.find((p) => p.id === nw.dataset.mcpNew) ?? null;
      mcpView = { mode: 'edit', id: preset?.id ?? `c${Date.now().toString(36).slice(-6)}`, preset };
      return render();
    }
    const test = t.closest<HTMLElement>('[data-mcp-test]');
    if (test) {
      const id = test.dataset.mcpTest!;
      mcpTesting.add(id);
      render();
      await api(`/api/mcp/${id}/test`, 'POST').catch(() => undefined);
      mcpTesting.delete(id);
      await loadMcpState();
      return render();
    }
    const ed = t.closest<HTMLElement>('[data-mcp-edit]');
    if (ed) {
      const srv = library.find((s) => s.id === ed.dataset.mcpEdit)!;
      mcpView = { mode: 'edit', id: srv.id, preset: MCP_PRESETS.find((p) => p.id === srv.preset) ?? null };
      return render();
    }
    const del = t.closest<HTMLElement>('[data-mcp-del]');
    if (del) {
      library = config.library = await api<McpServer[]>(`/api/mcp/${del.dataset.mcpDel}`, 'DELETE');
      await loadSecrets();
      await loadMcpState();
      return render();
    }
  };

  d.onchange = async (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (tab === 'project' && (await projectChange(t as HTMLInputElement, render))) return;
    if (tab === 'mcp' && (await linkedinChange(t, render))) return;
    if (tab === 'mcp' && (await appsChange(t, render))) return;
    if (t.dataset.mcpAccess) {
      mcpState = await api<typeof mcpState>(`/api/mcp/${t.dataset.mcpAccess}/access`, 'PUT', { access: t.value }).catch(() => mcpState);
      return render();
    }
    if (t.dataset.ai) {
      // Only what changed: the server picks the new provider's usual model itself.
      await save({ ai: { [t.dataset.ai]: t.value.trim() } as unknown as Settings['ai'] });
      if (t.dataset.ai === 'provider') render();
    } else if (t.matches('[data-unlimited]')) {
      const off = (t as HTMLInputElement).checked;
      await save({ ai: { dailyTokens: off ? 0 : 300_000 } as unknown as Settings['ai'] });
      render();
    } else if (t.matches('[data-add-provider]')) {
      addProvider = t.value as TextProvider;
      render();
      body.querySelector<HTMLElement>('[data-add-provider]')?.focus();
    } else if (t.matches('[data-image-usd]')) {
      const v = Math.max(0, Math.min(50, Number((t as HTMLInputElement).value) || 0));
      await save({ image: { provider: settings.image.provider, dailyUsd: v < 0.01 ? 0 : v } });
      await loadImageUsage();
      render();
    } else if (t.matches('[data-image-quality]')) {
      await save({ image: { provider: settings.image.provider, quality: t.value as ImageQuality } });
      await loadImageUsage();
      render();
    } else if (t.matches('[data-image]')) {
      await save({ image: { provider: t.value as Settings['image']['provider'] } });
      render();
    }
  };

  d.oninput = (e) => {
    if (tab === 'mcp' && linkedinInput(e.target as HTMLElement)) return;
    if (tab === 'mcp') appsInput(e.target as HTMLInputElement, render);
  };
  // One listener whichever time the dialog was opened: the latest render.
  document.removeEventListener('apps-change', appsChanged);
  appsChanged = () => d.open && (tab === 'ai' || (tab === 'mcp' && mcpView.mode === 'list')) && render();
  document.addEventListener('apps-change', appsChanged);

  d.onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    if (tab === 'project' && (await projectSubmit(form, render))) return;
    if (form.matches('[data-general]')) return saveGeneral(form);
    if (form.matches('[data-mcp-form]') && mcpView.mode === 'edit') return saveMcp(form, mcpView.id, mcpView.preset);
  };

  async function saveGeneral(form: HTMLFormElement): Promise<void> {
    const v = (n: string) => form.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${n}"]`)!.value.trim();
    const lat = Number(v('lat'));
    const lon = Number(v('lon'));
    if (!v('lat') || !Number.isFinite(lat) || lat < -90 || lat > 90) return fail('s-error', 'La latitud va de −90 a 90.');
    if (!v('lon') || !Number.isFinite(lon) || lon < -180 || lon > 180) return fail('s-error', 'La longitud va de −180 a 180.');
    setOfficeInfo(v('agency'), v('project'));
    try {
      await save({ location: { lat, lon, place: v('place'), guessed: false }, north: Number(v('north')), sofaColor: v('sofaColor') });
      d.close();
    } catch {
      fail('s-error', 'No se pudo guardar. ¿Está en marcha el servidor local?');
    }
  }

  async function saveMcp(form: HTMLFormElement, id: string, preset: McpPreset | null): Promise<void> {
    const v = (n: string) => form.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${n}"]`)?.value.trim() ?? '';
    const ref = (key: string) => `\${secret:${mcpSecret(id, key)}}`;
    const env: Record<string, string> = {};
    const headers: Record<string, string> = {};
    let server: Partial<McpServer>;
    if (preset) {
      // Only values you've saved go in; optional ones you skipped stay out.
      for (const f of preset.fields) {
        if (!hasSecret(mcpSecret(id, f.key))) continue;
        if (f.header) headers[f.header.name] = f.header.template.replace('{}', ref(f.key));
        else env[f.key] = ref(f.key);
      }
      server = { id, name: preset.name, preset: preset.id, transport: preset.transport, command: preset.command ?? '', args: preset.args ?? [], url: preset.url ?? '', env, headers };
    } else {
      const target = v('target');
      const vars = v('vars')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      if (!v('name')) return fail('m-error', 'Ponle un nombre.');
      if (!target) return fail('m-error', 'Falta el comando o la dirección.');
      if (vars.some((x) => !/^[A-Z][A-Z0-9_]*$/.test(x))) return fail('m-error', 'Las variables van en mayúsculas, p. ej. MI_API_KEY.');
      const http = v('transport') === 'http';
      // Remote servers take one optional token as a bearer header; commands take variables.
      if (http) headers.Authorization = `Bearer ${ref('AUTHORIZATION')}`;
      else for (const x of vars) env[x] = ref(x);
      const [command, ...args] = target.split(/\s+/);
      server = http
        ? { id, name: v('name'), preset: null, transport: 'http', command: '', args: [], url: target, env: {}, headers }
        : { id, name: v('name'), preset: null, transport: 'stdio', command, args, url: '', env, headers: {} };
    }
    try {
      const isNew = !library.some((s) => s.id === id);
      library = config.library = await api<McpServer[]>(`/api/mcp/${id}`, 'PUT', server);
      // A new custom connector with variables stays open so you can paste their values.
      const vars = Object.keys({ ...server.env, ...server.headers }).length;
      mcpView = !preset && isNew && vars ? { mode: 'edit', id, preset } : { mode: 'list' };
      render();
    } catch {
      fail('m-error', 'No se pudo guardar: revisa el comando o la dirección (https, o http solo en tu ordenador).');
    }
  }

  function locate(): void {
    if (!navigator.geolocation) return fail('s-error', 'Este navegador no da la ubicación. Escribe la latitud y la longitud.');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const set = (n: string, x: string) => {
          const el = body.querySelector<HTMLInputElement>(`[name="${n}"]`);
          if (el) el.value = x;
        };
        set('lat', p.coords.latitude.toFixed(2));
        set('lon', p.coords.longitude.toFixed(2));
        set('place', 'Mi ubicación');
      },
      () => fail('s-error', 'No se pudo obtener la ubicación. Escribe la latitud y la longitud.'),
      { timeout: 10_000, maximumAge: 3_600_000 },
    );
  }

  // ---------------------------------------------------------------- reordering the AIs

  /** Rows that moved slide to their new place instead of jumping. */
  const slide = (rows: HTMLElement[], before: Map<HTMLElement, number>) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const r of rows) {
      const dy = (before.get(r) ?? 0) - r.getBoundingClientRect().top;
      if (dy) r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 180, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' });
    }
  };

  d.onpointerdown = (e) => {
    const grip = (e.target as HTMLElement).closest<HTMLElement>('[data-chain-grip]');
    if (!grip || e.button !== 0) return;
    const row = grip.closest<HTMLElement>('.chain-row')!;
    const list = row.parentElement!;
    const grab = e.clientY - row.getBoundingClientRect().top;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    row.classList.add('is-dragging');
    list.classList.add('is-sorting');
    const follow = (y: number) => {
      row.style.transform = '';
      row.style.transform = `translateY(${y - grab - row.getBoundingClientRect().top}px)`;
    };
    const move = (ev: PointerEvent) => {
      const others = [...list.children].filter((x): x is HTMLElement => x !== row);
      const next = others.find((x) => ev.clientY < x.getBoundingClientRect().top + x.offsetHeight / 2) ?? null;
      if (row.nextElementSibling !== next || (!next && list.lastElementChild !== row)) {
        const before = new Map(others.map((x) => [x, x.getBoundingClientRect().top]));
        list.insertBefore(row, next);
        slide(others, before);
      }
      follow(ev.clientY);
    };
    const drop = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', drop);
      grip.removeEventListener('pointercancel', drop);
      row.classList.remove('is-dragging');
      list.classList.remove('is-sorting');
      row.style.transform = '';
      const order = [...list.children].map((x) => Number((x as HTMLElement).dataset.chainI));
      if (order.every((v, i) => v === i)) return;
      const chain = order.map((i) => settings.ai.chain[i]);
      void saveChain(chain, order.indexOf(Number(row.dataset.chainI)));
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', drop);
    grip.addEventListener('pointercancel', drop);
  };

  d.onkeydown = (e) => {
    const grip = (e.target as HTMLElement).closest<HTMLElement>('[data-chain-grip]');
    if (!grip || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const i = Number(grip.closest<HTMLElement>('.chain-row')!.dataset.chainI);
    const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
    const chain = [...settings.ai.chain];
    if (j < 0 || j >= chain.length) return;
    [chain[i], chain[j]] = [chain[j], chain[i]];
    void saveChain(chain, j);
  };

  render();
  if (!d.open) d.showModal();
  if (tab === 'mcp') void Promise.all([loadApps(), loadMcpState()]).then(render);
}
