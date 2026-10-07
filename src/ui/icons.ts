import {
  Armchair,
  ArrowLeft,
  Check,
  Copy,
  RotateCw,
  Trash2,
  Undo2,
  CircleCheck,
  ClipboardCheck,
  CodeXml,
  Coffee,
  Hourglass,
  ListChecks,
  MessagesSquare,
  Moon,
  OctagonAlert,
  Pause,
  PenTool,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Shirt,
  Shuffle,
  Sun,
  Users,
  X,
  createElement,
  type IconNode,
} from 'lucide';
import type { Activity, FeedKind, RoleId } from '../sim/types';

function svg(node: IconNode, size = 16): string {
  return createElement(node, { width: size, height: size, 'stroke-width': 1.75, 'aria-hidden': 'true' }).outerHTML;
}

export const icon = {
  back: (s?: number) => svg(ArrowLeft, s),
  close: (s?: number) => svg(X, s),
  edit: (s?: number) => svg(Pencil, s),
  plus: (s?: number) => svg(Plus, s),
  reset: (s?: number) => svg(RotateCcw, s),
  pause: (s?: number) => svg(Pause, s),
  coffee: (s?: number) => svg(Coffee, s),
  check: (s?: number) => svg(CircleCheck, s),
  alert: (s?: number) => svg(OctagonAlert, s),
  sun: (s?: number) => svg(Sun, s),
  moon: (s?: number) => svg(Moon, s),
  shirt: (s?: number) => svg(Shirt, s),
  shuffle: (s?: number) => svg(Shuffle, s),
  room: (s?: number) => svg(Armchair, s),
  turnLeft: (s?: number) => svg(RotateCcw, s),
  turnRight: (s?: number) => svg(RotateCw, s),
  copy: (s?: number) => svg(Copy, s),
  trash: (s?: number) => svg(Trash2, s),
  tick: (s?: number) => svg(Check, s),
  undo: (s?: number) => svg(Undo2, s),
};

const ROLE_WORK: Record<RoleId, IconNode> = {
  research: Search,
  design: PenTool,
  backend: CodeXml,
  pm: ListChecks,
  qa: ClipboardCheck,
};

export function activityIcon(activity: Activity, role: RoleId, size = 14): string {
  switch (activity) {
    case 'working':
      return svg(ROLE_WORK[role], size);
    case 'pairing':
      return svg(Users, size);
    case 'reviewing':
      return svg(ClipboardCheck, size);
    case 'meeting':
      return svg(MessagesSquare, size);
    case 'coffee':
      return svg(Coffee, size);
    case 'blocked':
      return svg(OctagonAlert, size);
    case 'idle':
      return svg(Hourglass, size);
  }
}

export const ACTIVITY_LABEL: Record<Activity, string> = {
  working: 'Trabajando',
  pairing: 'Colaborando',
  reviewing: 'Revisando',
  meeting: 'En la daily',
  coffee: 'Pausa café',
  blocked: 'Con bloqueo',
  idle: 'Sin tarea',
};

export function feedIcon(kind: FeedKind, size = 14): string {
  const map: Record<FeedKind, IconNode> = {
    start: PenTool,
    done: CircleCheck,
    review: ClipboardCheck,
    blocked: OctagonAlert,
    unblocked: CircleCheck,
    pair: Users,
    unpair: Users,
    coffee: Coffee,
    meeting: MessagesSquare,
    create: Plus,
    edit: Pencil,
    day: Sun,
  };
  return svg(map[kind], size);
}
