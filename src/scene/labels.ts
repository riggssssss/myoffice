import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { ambience } from './ambience';
import { ROLES } from '../sim/seed';
import type { SimState, Worker } from '../sim/types';
import { esc as escapeHtml, fill } from '../ui/dom';
import { ACTIVITY_LABEL, activityIcon } from '../ui/icons';

interface Tag {
  obj: CSS2DObject;
  el: HTMLButtonElement;
  icon: HTMLElement;
  bar: HTMLElement;
  task: HTMLElement;
  name: HTMLElement;
  lastIconKey: string;
  bubble: HTMLButtonElement;
  bubbleKey: string;
}

/** What someone is saying (or that they're thinking) over their head. */
export interface Bubble {
  convId: string;
  /** say: their last line; think: calling their AI or a tool. */
  kind: 'say' | 'think';
  text: string;
}

/** Longer lines are cut in the bubble; the whole thing is in the panel. */
const BUBBLE_CHARS = 140;

/** Name tags floating over each head. They are real buttons: keyboard can select people too. */
export class Labels {
  private tags = new Map<string, Tag>();
  private visible = true;

  constructor(private onSelect: (id: string) => void) {}

  /** A tag for someone new; returns its 3D object so the scene can add it. */
  add(w: Worker): CSS2DObject {
    {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'tag';
      el.style.setProperty('--role', ROLES[w.role].color);
      el.innerHTML = `
        <span class="tag-row">
          <span class="tag-icon"></span>
          <span class="tag-name"></span>
        </span>
        <span class="tag-task"></span>
        <span class="tag-bar"><i></i></span>`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onSelect(w.id);
      });
      // Labels sit over the canvas: keep drags on them from reaching OrbitControls oddly.
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      const obj = new CSS2DObject(el);
      obj.center.set(0.5, 1);
      obj.visible = this.visible;
      // The speech bubble rides on the tag, just above it.
      const bubble = document.createElement('button');
      bubble.type = 'button';
      bubble.className = 'bubble';
      bubble.style.setProperty('--role', ROLES[w.role].color);
      bubble.hidden = true;
      bubble.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = bubble.dataset.conv;
        // Conversations open in the panel; your requests (q…) live under Tareas.
        if (id) document.dispatchEvent(id.startsWith('q') ? new CustomEvent('open-tasks') : new CustomEvent('open-conversation', { detail: id }));
      });
      bubble.addEventListener('pointerdown', (e) => e.stopPropagation());
      const holder = document.createElement('div');
      holder.className = 'bubble-anchor';
      holder.append(bubble);
      const bubbleObj = new CSS2DObject(holder);
      bubbleObj.center.set(0.5, 1);
      obj.add(bubbleObj);
      this.tags.set(w.id, {
        obj,
        el,
        icon: el.querySelector('.tag-icon')!,
        bar: el.querySelector('.tag-bar i')!,
        task: el.querySelector('.tag-task')!,
        name: el.querySelector('.tag-name')!,
        lastIconKey: '',
        bubble,
        bubbleKey: '',
      });
      return obj;
    }
  }

  /** Someone left: returns the object for the scene to take out. */
  remove(id: string): CSS2DObject | undefined {
    const t = this.tags.get(id);
    this.tags.delete(id);
    t?.el.remove();
    return t?.obj;
  }

  setVisible(on: boolean): void {
    this.visible = on;
    for (const t of this.tags.values()) {
      t.obj.visible = on;
      for (const c of t.obj.children) c.visible = on;
    }
  }

  /** Bubbles by person; anyone missing from the map has none. They fade in and out. */
  setBubbles(bubbles: Map<string, Bubble>): void {
    for (const [id, t] of this.tags) {
      const b = bubbles.get(id);
      const key = b ? `${b.kind}:${b.convId}:${b.text}` : '';
      if (key === t.bubbleKey) continue;
      const was = t.bubbleKey !== '';
      t.bubbleKey = key;
      const el = t.bubble;
      if (!b) {
        el.classList.remove('is-shown');
        // Leave the DOM once the fade-out has played.
        window.setTimeout(() => {
          if (!t.bubbleKey) el.hidden = true;
        }, 400);
        continue;
      }
      // A new line said out loud: a murmur of talk with it.
      if (b.kind !== 'think' && b.text) ambience.talk(id, b.text.length);
      el.dataset.conv = b.convId;
      el.classList.toggle('is-thinking', b.kind === 'think');
      const short = b.text.length > BUBBLE_CHARS ? `${b.text.slice(0, BUBBLE_CHARS).replace(/\s+\S*$/, '')}…` : b.text;
      el.innerHTML =
        b.kind === 'think'
          ? `<span class="typing" aria-hidden="true"><i></i><i></i><i></i></span>${b.text ? `<span class="bubble-tool">${escapeHtml(b.text)}</span>` : ''}`
          : escapeHtml(short);
      el.setAttribute('aria-label', b.kind === 'think' ? `Pensando${b.text ? `: ${b.text}` : ''}. Ver conversación` : `Dice: ${b.text}. Ver conversación`);
      if (was && el.classList.contains('is-shown')) {
        // Already up: the new words cross-fade in.
        el.classList.remove('is-swap');
        void el.offsetWidth;
        el.classList.add('is-swap');
      } else {
        el.hidden = false;
        void el.offsetWidth;
        el.classList.add('is-shown');
      }
    }
  }

  /** One tag on or off (people out of the office have none). Editing hides them all. */
  show(id: string, on: boolean): void {
    const t = this.tags.get(id);
    // visibility, not display: the label renderer owns display.
    if (t) t.el.style.visibility = on ? '' : 'hidden';
  }

  place(id: string, x: number, y: number, z: number): void {
    this.tags.get(id)?.obj.position.set(x, y, z);
  }

  refresh(state: SimState, selectedId: string | null): void {
    for (const w of state.workers) {
      const tag = this.tags.get(w.id);
      if (!tag) continue;
      const shown = state.tasks.find((t) => t.id === w.taskId);
      const pct = shown?.progress ?? 0;

      const iconKey = `${w.activity}-${w.role}`;
      if (iconKey !== tag.lastIconKey) {
        tag.icon.innerHTML = activityIcon(w.activity, w.role, 13);
        tag.lastIconKey = iconKey;
      }
      tag.name.textContent = w.name;
      tag.el.style.setProperty('--role', ROLES[w.role].color);
      tag.el.classList.toggle('is-selected', w.id === selectedId);
      tag.el.classList.toggle('is-blocked', w.activity === 'blocked');
      tag.el.classList.toggle('is-away', w.activity === 'coffee' || w.activity === 'meeting' || w.activity === 'away');
      tag.el.classList.toggle('has-task', !!shown);
      tag.bar.style.transform = fill(pct);
      tag.task.textContent = shown ? shown.title : ACTIVITY_LABEL[w.activity];
      tag.el.setAttribute(
        'aria-label',
        `${w.name}, ${ACTIVITY_LABEL[w.activity]}${shown ? `: ${shown.title}, ${Math.round(pct)}%` : ''}`,
      );
    }
  }
}
