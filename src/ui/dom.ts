import { ROLES } from '../sim/seed';
import { dayOf, formatClock } from '../sim/store';
import type { RoleId } from '../sim/types';

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const pct = (n: number) => `${Math.round(Math.min(100, Math.max(0, n)))}%`;

/** Progress fills scale instead of resizing, so updates never trigger layout. */
export const fill = (n: number) => `scaleX(${(Math.min(100, Math.max(0, n)) / 100).toFixed(4)})`;

export const stamp = (clock: number) => `Día ${dayOf(clock)} · ${formatClock(clock)}`;

export const roleDot = (role: RoleId) => `<span class="dot" style="--role:${ROLES[role].color}"></span>`;

export function bar(taskId: string, value: number, extra = ''): string {
  return `<span class="bar ${extra}"><i data-progress="${taskId}" style="transform:${fill(value)}"></i></span>`;
}

/**
 * A region that rebuilds from state. Rebuilds wait while the user is pressing
 * or typing inside it, so a structural change never eats a click or a selection.
 */
export class Region {
  private dirty = false;
  private pressing = false;

  constructor(
    readonly el: HTMLElement,
    private renderFn: () => string,
    private afterRender?: (el: HTMLElement) => void,
  ) {
    el.addEventListener('pointerdown', () => (this.pressing = true));
    window.addEventListener('pointerup', () => {
      if (!this.pressing) return;
      // Let the click land on the current DOM first.
      setTimeout(() => {
        this.pressing = false;
        if (this.dirty) this.render();
      }, 0);
    });
    el.addEventListener('focusout', () => setTimeout(() => this.dirty && this.render(), 0));
  }

  private get busy(): boolean {
    const a = document.activeElement;
    const editing = !!a && this.el.contains(a) && a.matches('input, select, textarea');
    return this.pressing || editing;
  }

  render(force = false): void {
    if (!force && this.busy) {
      this.dirty = true;
      return;
    }
    this.dirty = false;
    const focusKey = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-key]')?.dataset.key;
    const hadFocus = !!focusKey && this.el.contains(document.activeElement);
    this.el.innerHTML = this.renderFn();
    this.afterRender?.(this.el);
    if (hadFocus) this.el.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey!)}"]`)?.focus();
  }
}
