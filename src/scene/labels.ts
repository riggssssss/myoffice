import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { ROLES } from '../sim/seed';
import type { SimState, Worker } from '../sim/types';
import { fill } from '../ui/dom';
import { ACTIVITY_LABEL, activityIcon } from '../ui/icons';

interface Tag {
  obj: CSS2DObject;
  el: HTMLButtonElement;
  icon: HTMLElement;
  bar: HTMLElement;
  task: HTMLElement;
  lastIconKey: string;
}

/** Name tags floating over each head. They are real buttons: keyboard can select people too. */
export class Labels {
  private tags = new Map<string, Tag>();

  constructor(
    workers: Worker[],
    private onSelect: (id: string) => void,
  ) {
    for (const w of workers) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'tag';
      el.style.setProperty('--role', ROLES[w.role].color);
      el.innerHTML = `
        <span class="tag-row">
          <span class="tag-icon"></span>
          <span class="tag-name">${w.name}</span>
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
      this.tags.set(w.id, {
        obj,
        el,
        icon: el.querySelector('.tag-icon')!,
        bar: el.querySelector('.tag-bar i')!,
        task: el.querySelector('.tag-task')!,
        lastIconKey: '',
      });
    }
  }

  objects(): CSS2DObject[] {
    return [...this.tags.values()].map((t) => t.obj);
  }

  setVisible(on: boolean): void {
    for (const t of this.tags.values()) t.obj.visible = on;
  }

  place(id: string, x: number, y: number, z: number): void {
    this.tags.get(id)?.obj.position.set(x, y, z);
  }

  refresh(state: SimState, selectedId: string | null): void {
    for (const w of state.workers) {
      const tag = this.tags.get(w.id);
      if (!tag) continue;
      const task = state.tasks.find((t) => t.id === w.taskId);
      const reviewing = w.activity === 'reviewing' ? state.tasks.find((t) => t.status === 'review') : undefined;
      const shown = reviewing ?? task;
      const pct = reviewing ? reviewing.reviewProgress : (task?.progress ?? 0);

      const iconKey = `${w.activity}-${w.role}`;
      if (iconKey !== tag.lastIconKey) {
        tag.icon.innerHTML = activityIcon(w.activity, w.role, 13);
        tag.lastIconKey = iconKey;
      }
      tag.el.classList.toggle('is-selected', w.id === selectedId);
      tag.el.classList.toggle('is-blocked', w.activity === 'blocked');
      tag.el.classList.toggle('is-away', w.activity === 'coffee' || w.activity === 'meeting');
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
