import { ROLES } from '../sim/seed';
import { fileUrl, getSelectedId, getState, ownerChat, resetChat, upload, worker } from '../sim/store';
import type { ChatActivity, ChatFile, ChatImage, ChatLine, ToolUse, Worker } from '../sim/types';
import { appLogo } from './brandLogos';
import { esc, stamp } from './dom';
import { linkDossier } from './dossier';
import { icon } from './icons';

/**
 * Your chat with one person, floating over the left of the office: you write (and attach
 * pictures or documents), they answer — with what they did on the way, the apps they used and
 * anything they send you. It opens with whoever you select; ✕ hides it until you select someone
 * (or them) again.
 */
let closedFor: string | null = null;
/** Who was selected last time: picking someone again brings a closed chat back. */
let lastSelected: string | null = null;
/** Whose thread is on screen: a different person scrolls to the bottom and takes the focus. */
let shown: string | null = null;
/** Answers whose steps you've opened (kept across redraws). */
const openTrails = new Set<string>();

/** What you're about to send: uploading, ready, or refused. */
interface Pending {
  key: number;
  name: string;
  size: number;
  preview: string | null;
  progress: number;
  file: ChatFile | null;
  error: string | null;
}
let pending: Pending[] = [];
let pendingKey = 0;
const MAX_ATTACH = 10;

export function chatPerson(): Worker | undefined {
  const id = getSelectedId();
  if (id !== lastSelected) {
    lastSelected = id;
    closedFor = null;
  }
  return id && id !== closedFor ? worker(id) : undefined;
}

export function closeChat(): void {
  closedFor = getSelectedId();
  document.dispatchEvent(new CustomEvent('chat-change'));
}

const face = (w: Worker, hidden = false) =>
  `<span class="talk-dot chat-face${hidden ? ' is-quiet' : ''}" style="--role:${ROLES[w.role].color}" aria-hidden="true">${esc(w.name.charAt(0))}</span>`;

/** Why your last message hasn't been answered yet, when it isn't just them typing. */
function waitingNote(w: Worker): string {
  const s = getState();
  if (s.ai.state === 'off') return 'Para que te conteste hace falta la IA.';
  if (s.meeting && s.meeting.status !== 'ended' && s.meeting.participants.includes(w.id)) return 'Está en la reunión contigo: te contesta al salir.';
  if (!s.working || !w.enabled) return 'Te contestará en cuanto esté en la oficina.';
  return '';
}

// ---------------------------------------------------------------- text

/** Their words, lightly shaped: paragraphs, lists, bold and links. Escaped first, always. */
function rich(text: string): string {
  const inline = (s: string) =>
    linkDossier(
      esc(s)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[\s(])(https:\/\/[^\s<)]+[^\s<).,;:!?])/g, (_, pre: string, url: string) => `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${url.replace(/^https:\/\/(www\.)?/, '').slice(0, 48)}${url.length > 56 ? '…' : ''}</a>`),
    );
  const blocks: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
  const flush = () => {
    if (list) blocks.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const bullet = /^[-•*]\s+(.+)/.exec(line);
    const number = /^\d+[.)]\s+(.+)/.exec(line);
    if (bullet || number) {
      const tag = bullet ? 'ul' : 'ol';
      if (list && list.tag !== tag) flush();
      list ??= { tag, items: [] };
      list.items.push((bullet ?? number)![1]);
      continue;
    }
    flush();
    if (line) blocks.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return blocks.join('');
}

// ---------------------------------------------------------------- files and pictures

/** Chat files already fetched, so a redraw shows them at once. */
const ready = new Map<string, string>();
const fileSrc = (f: ChatFile) => ready.get(f.id) ?? '';

const sizeOf = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const fileIcon = (f: { name: string; type?: string }) => {
  const ext = f.name.toLowerCase().split('.').pop() ?? '';
  if (['csv', 'xlsx'].includes(ext)) return icon.sheet(18);
  if (ext === 'pptx') return icon.slides(18);
  if (['pdf', 'md', 'txt', 'docx', 'json'].includes(ext)) return icon.doc(18);
  return icon.file(18);
};
const extOf = (name: string) => (name.split('.').pop() ?? '').toUpperCase().slice(0, 5);

function filesView(files: ChatFile[], line: string): string {
  const pics = files.filter((f) => f.kind === 'image');
  const docs = files.filter((f) => f.kind === 'doc');
  return `
    ${pics.length ? `<div class="chat-gallery is-n${pics.length > 4 ? 'x' : pics.length}">${pics.map((f, i) => `<button class="chat-pic" type="button" data-view="${line}" data-view-i="${i}" aria-label="Ver ${esc(f.name)}"><img data-file-src="${f.id}" src="${fileSrc(f)}" alt="${esc(f.name)}" /></button>`).join('')}</div>` : ''}
    ${docs
      .map(
        (f) => `
      <button class="chat-file" type="button" data-file-open="${f.id}" data-file-name="${esc(f.name)}">
        <span class="chat-file-icon">${fileIcon(f)}</span>
        <span class="chat-file-main"><span class="chat-file-name">${esc(f.name)}</span><span class="chat-file-meta">${esc(extOf(f.name))} · ${sizeOf(f.size)}</span></span>
        <span class="chat-file-go" aria-hidden="true">${icon.download(15)}</span>
      </button>`,
      )
      .join('')}`;
}

function imagesView(images: ChatImage[], line: string, offset: number): string {
  if (!images.length) return '';
  return `<div class="chat-gallery is-n${images.length > 4 ? 'x' : images.length}">${images
    .map(
      (img, i) =>
        `<button class="chat-pic" type="button" data-view="${line}" data-view-i="${offset + i}" aria-label="${esc(img.title ?? 'Ver imagen')}"><img src="${esc(img.url)}" alt="${esc(img.title ?? '')}" loading="lazy" referrerpolicy="no-referrer" /></button>`,
    )
    .join('')}</div>`;
}

// ---------------------------------------------------------------- what they did

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The steps before an answer: folded into one line (with the apps' marks), open on demand. */
function trail(tools: ToolUse[], key: string): string {
  if (!tools.length) return '';
  const apps = [...new Set(tools.map((t) => t.app).filter((a): a is string => !!a))];
  const open = openTrails.has(key);
  const last = tools.at(-1)!;
  return `
    <div class="chat-trail${open ? ' is-open' : ''}">
      <button class="chat-trail-head" type="button" data-trail="${key}" aria-expanded="${open}">
        ${apps.length ? `<span class="chat-trail-apps">${apps.slice(0, 4).map((a) => appLogo(a, 'is-xs')).join('')}</span>` : `<span class="chat-trail-tick">${icon.tick(12)}</span>`}
        <span class="chat-trail-sum">${tools.length === 1 ? esc(capital(last.note)) : `${tools.length} pasos · ${esc(capital(last.note))}`}</span>
        <span class="chat-trail-caret">${icon.chevron(14)}</span>
      </button>
      ${
        open
          ? `<ol class="chat-steps">${tools
              .map(
                (t) => `
            <li>
              <span class="chat-step-mark">${t.app ? appLogo(t.app, 'is-xs') : '<i></i>'}</span>
              <span>${linkDossier(esc(capital(t.note)))}</span>
              ${t.images?.length ? `<span class="chat-step-pics">${t.images.slice(0, 6).map((u) => `<img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`).join('')}</span>` : ''}
            </li>`,
              )
              .join('')}</ol>`
          : ''
      }
    </div>`;
}

/** While they answer: what they're doing right now, where, and what they're looking at. */
function liveView(w: Worker, doing: ChatActivity): string {
  // The shimmer keeps its pace across redraws.
  const phase = `animation-delay:-${Math.round(performance.now() % 1800)}ms`;
  return `
    <li class="chat-line is-a is-live">
      ${face(w)}
      <div class="chat-live" role="status">
        <span class="chat-live-mark">${doing.app ? appLogo(doing.app, 'is-sm') : '<span class="typing" aria-hidden="true"><i></i><i></i><i></i></span>'}</span>
        <span class="chat-live-text" style="${phase}">${esc(doing.label)}</span>
        ${
          doing.images?.length
            ? `<span class="chat-live-pics">${doing.images
                .slice(0, 6)
                .map((u, i) => `<img src="${esc(u)}" alt="" referrerpolicy="no-referrer" style="--i:${i}" />`)
                .join('')}</span>`
            : ''
        }
      </div>
    </li>`;
}

// ---------------------------------------------------------------- the thread

function lineView(w: Worker, l: ChatLine, prev: ChatLine | undefined, next: ChatLine | undefined): string {
  const mine = l.speaker === 'owner';
  const key = `cl-${l.at}`;
  const grouped = prev?.speaker === l.speaker && l.at - prev.at < 5 * 60_000;
  // The time once per run of messages, under the last one.
  const lastOfRun = !next || next.speaker !== l.speaker || next.at - l.at >= 5 * 60_000;
  const media = `${filesView(l.files ?? [], key)}${imagesView(l.images ?? [], key, (l.files ?? []).filter((f) => f.kind === 'image').length)}`;
  return `
    <li class="chat-line ${mine ? 'is-owner' : 'is-a'}${grouped ? ' is-grouped' : ''}" data-key="${key}">
      ${mine ? '' : face(w, grouped)}
      <div class="chat-stack">
        ${mine ? '' : trail(l.tools, key)}
        ${l.text ? `<div class="chat-body"><div class="chat-text">${mine ? `<p>${linkDossier(esc(l.text)).replace(/\n/g, '<br>')}</p>` : rich(l.text)}</div></div>` : ''}
        ${media ? `<div class="chat-media">${media}</div>` : ''}
        ${lastOfRun ? `<p class="chat-when num">${stamp(l.at)}</p>` : ''}
      </div>
    </li>`;
}

export function renderChat(): string {
  const w = chatPerson();
  if (!w) return '';
  const chat = w.chat;
  const lines = chat?.lines ?? [];
  const wait = chat?.pending && !chat.thinking ? waitingNote(w) : '';
  const s = getState();
  const here = s.working && w.enabled;
  const organizer = s.workers.find((o) => o.role === 'organizer')?.name ?? 'Organización';
  return `
    <header class="chat-float-head">
      ${face(w)}
      <div class="chat-float-who">
        <h2 class="chat-float-name">${esc(w.name)}</h2>
        <p class="meta"><span class="presence${here ? ' is-on' : ''}" aria-hidden="true"></span>${here ? 'En la oficina' : 'Fuera de la oficina'} · ${esc(w.title)}</p>
      </div>
      <button class="btn btn-icon btn-ghost" type="button" data-chat-reset aria-label="Empezar un chat nuevo" title="Chat nuevo: este se guarda en sus Ajustes" ${!lines.length || chat?.thinking ? 'disabled' : ''}>${icon.refresh(15)}</button>
      <button class="btn btn-icon btn-ghost" type="button" data-chat-close aria-label="Cerrar chat">${icon.close(16)}</button>
    </header>
    <div class="chat-float-body" data-chat-scroll>
      ${
        lines.length
          ? ''
          : `<div class="chat-empty">
              ${face(w)}
              <p class="chat-empty-title">${chat?.archive?.length ? 'Chat nuevo' : `Habla con ${esc(w.name)}`}</p>
              ${chat?.archive?.length ? `<p class="section-note">Empieza de cero: no recuerda lo que hablasteis antes. Los chats anteriores están en su ficha, pestaña Ajustes.</p>` : ''}
              <p class="section-note"${chat?.archive?.length ? ' hidden' : ''}>Una duda, una idea o un encargo. Puedes adjuntar imágenes y documentos, y te puede enviar imágenes de tus apps o documentos que prepare. Si no es de su puesto, se lo pasa a ${esc(organizer)}.</p>
            </div>`
      }
      <ol class="chat" aria-live="polite">
        ${lines.map((l, i) => lineView(w, l, lines[i - 1], lines[i + 1])).join('')}
        ${chat?.thinking ? liveView(w, chat.doing ?? { label: capital(chat.thinking) }) : ''}
      </ol>
      ${wait ? `<p class="section-note chat-float-wait">${esc(wait)}</p>` : ''}
    </div>
    <div class="chat-drop" aria-hidden="true">${icon.attach(22)}<span>Suelta aquí para adjuntar</span></div>`;
}

// ---------------------------------------------------------------- your box

/** Your box: built once (so what you're typing survives updates), then kept in step. */
export function chatComposer(): string {
  return `
    <form class="composer chat-float-composer" data-chat-say>
      <ul class="chat-attachments" data-attachments hidden></ul>
      <div class="composer-box">
        <button class="btn btn-icon btn-ghost composer-attach" type="button" data-attach aria-label="Adjuntar imágenes o documentos" title="Adjuntar (o arrastra, o pega una imagen)">${icon.attach(17)}</button>
        <input type="file" data-attach-input multiple hidden accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/markdown,.md,text/csv,.csv,application/json,.docx,.xlsx,.pptx" />
        <label class="sr-only" for="chat-say">Escribe en el chat</label>
        <textarea id="chat-say" name="text" rows="1" maxlength="4000"></textarea>
        <button class="btn btn-icon composer-send" type="submit" aria-label="Enviar">${icon.send(16)}</button>
      </div>
      <p class="composer-note" data-chat-note hidden></p>
    </form>`;
}

function renderAttachments(float: HTMLElement): void {
  const list = float.querySelector<HTMLElement>('[data-attachments]');
  if (!list) return;
  list.hidden = !pending.length;
  list.innerHTML = pending
    .map(
      (p) => `
      <li class="chat-attachment${p.error ? ' is-bad' : p.file ? '' : ' is-loading'}" title="${esc(p.error ?? p.name)}">
        ${p.preview ? `<img src="${p.preview}" alt="" />` : `<span class="chat-attachment-icon">${fileIcon(p)}</span>`}
        <span class="chat-attachment-main">
          <span class="chat-attachment-name">${esc(p.name)}</span>
          <span class="chat-attachment-meta">${p.error ? esc(p.error) : p.file ? sizeOf(p.size) : `Subiendo ${Math.round(p.progress * 100)} %`}</span>
        </span>
        ${p.file || p.error ? '' : `<span class="chat-attachment-bar" style="--p:${p.progress}"></span>`}
        <button class="chat-attachment-x" type="button" data-unattach="${p.key}" aria-label="Quitar ${esc(p.name)}">${icon.close(12)}</button>
      </li>`,
    )
    .join('');
  const send = float.querySelector<HTMLButtonElement>('.composer-send');
  if (send) send.disabled = getState().ai.state === 'off' || pending.some((p) => !p.file && !p.error);
}

function attach(float: HTMLElement, files: FileList | File[]): void {
  for (const f of [...files].slice(0, MAX_ATTACH - pending.length)) {
    const p: Pending = { key: ++pendingKey, name: f.name || 'imagen.png', size: f.size, preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : null, progress: 0, file: null, error: null };
    pending.push(p);
    upload(f, (part) => {
      p.progress = part;
      renderAttachments(float);
    })
      .then((file) => {
        p.file = file;
        if (p.preview && file.kind === 'image') ready.set(file.id, p.preview);
      })
      .catch((e: Error) => (p.error = e.message))
      .finally(() => renderAttachments(float));
  }
  renderAttachments(float);
}

// ---------------------------------------------------------------- the viewer

interface Viewed {
  src: string;
  title: string;
  link?: string;
  file?: ChatFile;
}

function viewer(): HTMLDialogElement {
  let d = document.getElementById('chat-viewer') as HTMLDialogElement | null;
  if (d) return d;
  d = document.createElement('dialog');
  d.id = 'chat-viewer';
  d.className = 'chat-viewer';
  d.setAttribute('aria-label', 'Imagen');
  document.body.append(d);
  d.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === d || t.closest('[data-viewer-close]')) d!.close();
    const step = t.closest<HTMLElement>('[data-viewer-step]');
    if (step) show(Number(step.dataset.viewerStep));
  });
  d.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') show(at + 1);
    if (e.key === 'ArrowLeft') show(at - 1);
  });
  return d;
}

let gallery: Viewed[] = [];
let at = 0;

function show(i: number): void {
  const d = viewer();
  at = (i + gallery.length) % gallery.length;
  const v = gallery[at];
  d.innerHTML = `
    <figure class="chat-viewer-fig">
      <img src="${esc(v.src)}" alt="${esc(v.title)}" referrerpolicy="no-referrer" />
      <figcaption>
        <span class="chat-viewer-title">${esc(v.title || 'Imagen')}${gallery.length > 1 ? ` <span class="num">${at + 1} / ${gallery.length}</span>` : ''}</span>
        <span class="chat-viewer-actions">
          ${v.link ? `<a class="btn btn-sm" href="${esc(v.link)}" target="_blank" rel="noopener noreferrer">${icon.external(14)}Abrir original</a>` : ''}
          ${v.file ? `<a class="btn btn-sm" href="${esc(v.src)}" download="${esc(v.file.name)}">${icon.download(14)}Descargar</a>` : !v.link ? `<a class="btn btn-sm" href="${esc(v.src)}" target="_blank" rel="noopener noreferrer">${icon.external(14)}Abrir</a>` : ''}
          <button class="btn btn-icon btn-ghost" type="button" data-viewer-close aria-label="Cerrar">${icon.close(16)}</button>
        </span>
      </figcaption>
      ${
        gallery.length > 1
          ? `<button class="chat-viewer-nav is-prev" type="button" data-viewer-step="${at - 1}" aria-label="Anterior">${icon.prev(20)}</button>
             <button class="chat-viewer-nav is-next" type="button" data-viewer-step="${at + 1}" aria-label="Siguiente">${icon.next(20)}</button>`
          : ''
      }
    </figure>`;
  if (!d.open) d.showModal();
}

async function openViewer(w: Worker, lineKey: string, i: number): Promise<void> {
  const l = w.chat?.lines.find((x) => `cl-${x.at}` === lineKey);
  if (!l) return;
  const pics = (l.files ?? []).filter((f) => f.kind === 'image');
  gallery = [
    ...(await Promise.all(pics.map(async (f) => ({ src: ready.get(f.id) ?? (await fileUrl(f.id)), title: f.name, file: f })))),
    ...(l.images ?? []).map((img) => ({ src: img.url, title: img.title ?? '', link: img.link })),
  ];
  // The index counts your pictures first, then the app's images, as they're drawn.
  show(i);
}

async function openFile(id: string, name: string): Promise<void> {
  const url = await fileUrl(id);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}

// ---------------------------------------------------------------- keeping it in step

/** Shows or hides the float and keeps the thread and the box in step with the state. */
export function syncChat(float: HTMLElement, render: (force: boolean) => void): void {
  const w = chatPerson();
  float.hidden = !w;
  document.body.classList.toggle('chat-open', !!w);
  if (!w) {
    shown = null;
    return;
  }
  const scroller = () => float.querySelector<HTMLElement>('[data-chat-scroll]');
  const before = scroller();
  const atBottom = !before || before.scrollHeight - before.scrollTop - before.clientHeight < 80;
  render(shown !== w.id);
  // Chat files load with the session's token, then show.
  for (const img of float.querySelectorAll<HTMLImageElement>('img[data-file-src]')) {
    const id = img.dataset.fileSrc!;
    if (img.getAttribute('src')) continue;
    void fileUrl(id).then((url) => {
      ready.set(id, url);
      img.src = url;
    });
  }
  const box = float.querySelector<HTMLTextAreaElement>('#chat-say')!;
  const off = getState().ai.state === 'off';
  box.placeholder = `Escribe a ${w.name}…`;
  box.disabled = off;
  float.querySelector<HTMLButtonElement>('.composer-attach')!.disabled = off;
  renderAttachments(float);
  const note = float.querySelector<HTMLElement>('[data-chat-note]')!;
  note.hidden = !off;
  note.innerHTML = off ? 'Para hablar con el equipo hace falta la IA. <button class="link" type="button" data-open-settings="ai">Configurarla</button>' : '';
  // Follow the thread, unless you scrolled up to reread.
  const after = scroller();
  if (after && (shown !== w.id || atBottom)) after.scrollTop = after.scrollHeight;
  // Pictures that load later push the thread: stay at the bottom if you were there.
  for (const img of float.querySelectorAll<HTMLImageElement>('.chat img')) {
    if (!img.complete) img.addEventListener('load', () => atBottom && after && (after.scrollTop = after.scrollHeight), { once: true });
  }
  if (shown !== w.id && !off) box.focus();
  shown = w.id;
}

export function bindChat(float: HTMLElement): void {
  float.addEventListener('submit', (e) => {
    const form = (e.target as HTMLElement).closest<HTMLFormElement>('[data-chat-say]');
    if (!form) return;
    e.preventDefault();
    const box = form.querySelector<HTMLTextAreaElement>('textarea')!;
    const text = box.value.trim();
    const w = chatPerson();
    if (!w || box.disabled || pending.some((p) => !p.file && !p.error)) return box.focus();
    const files = pending.filter((p) => p.file).map((p) => p.file!.id);
    if (!text && !files.length) return box.focus();
    ownerChat(w.id, text, files);
    pending = [];
    renderAttachments(float);
    box.value = '';
    box.style.height = '';
  });
  float.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-chat-close]')) return closeChat();
    if (t.closest('[data-chat-reset]')) {
      const w = chatPerson();
      if (w) resetChat(w.id);
      openTrails.clear();
      return;
    }
    if (t.closest('[data-attach]')) return float.querySelector<HTMLInputElement>('[data-attach-input]')!.click();
    const un = t.closest<HTMLElement>('[data-unattach]');
    if (un) {
      const p = pending.find((x) => x.key === Number(un.dataset.unattach));
      if (p?.preview && !p.file) URL.revokeObjectURL(p.preview);
      pending = pending.filter((x) => x !== p);
      return renderAttachments(float);
    }
    const tr = t.closest<HTMLElement>('[data-trail]');
    if (tr) {
      const key = tr.dataset.trail!;
      if (!openTrails.delete(key)) openTrails.add(key);
      return document.dispatchEvent(new CustomEvent('chat-change'));
    }
    const view = t.closest<HTMLElement>('[data-view]');
    const w = chatPerson();
    if (view && w) return void openViewer(w, view.dataset.view!, Number(view.dataset.viewI));
    const file = t.closest<HTMLElement>('[data-file-open]');
    if (file) return void openFile(file.dataset.fileOpen!, file.dataset.fileName ?? 'archivo');
  });
  float.addEventListener('change', (e) => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>('[data-attach-input]');
    if (!input?.files?.length) return;
    attach(float, input.files);
    input.value = '';
  });
  // Pictures pasted into the box come along as attachments.
  float.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (!files.length || getState().ai.state === 'off') return;
    e.preventDefault();
    attach(float, files);
  });
  // Dropped onto the chat: attached.
  let depth = 0;
  float.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    depth++;
    float.classList.add('is-drop');
  });
  float.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) float.classList.remove('is-drop');
  });
  float.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
  float.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    depth = 0;
    float.classList.remove('is-drop');
    if (getState().ai.state !== 'off') attach(float, e.dataTransfer.files);
  });
  float.addEventListener('input', (e) => {
    const box = (e.target as HTMLElement).closest<HTMLTextAreaElement>('textarea');
    if (!box) return;
    box.style.height = '';
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
  });
  float.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeChat();
      return;
    }
    const box = (e.target as HTMLElement).closest<HTMLTextAreaElement>('textarea');
    if (!box || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    box.form?.requestSubmit();
  });
  // Clicks and wheel on the chat aren't for the 3D view behind it.
  for (const type of ['pointerdown', 'wheel'] as const) float.addEventListener(type, (e) => e.stopPropagation());
}
