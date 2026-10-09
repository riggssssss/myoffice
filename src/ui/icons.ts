import {
  Armchair,
  Star,
  Link as LinkIcon,
  Package,
  Archive,
  ArchiveRestore,
  Bookmark,
  Type,
  Sparkles,
  ChartColumn,
  Contact,
  Wrench,
  Coins,
  Paperclip,
  FileText,
  FileSpreadsheet,
  File as FileIcon,
  Image as ImageIcon,
  Globe,
  ChevronDown,
  Presentation,
  ExternalLink,
  Plug,
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  History,
  Inbox,
  CircleStop,
  Repeat,
  ArrowUp,
  Download,
  MessageCircle,
  ArrowLeft,
  Check,
  Compass,
  Copy,
  Footprints,
  Handshake,
  Route,
  MessageSquareWarning,
  DoorOpen,
  Megaphone,
  MessageCircleQuestion,
  Scale,
  UserPlus,
  GripVertical,
  House,
  RotateCw,
  Lightbulb,
  Settings,
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
  Volume2,
  VolumeX,
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
  Cloud,
  CloudSun,
  CloudRain,
  CloudLightning,
  Users,
  X,
  Palette,
  PanelsTopLeft,
  createElement,
  type IconNode,
} from 'lucide';
import type { Activity, FeedKind, RoleId } from '../sim/types';

function svg(node: IconNode, size = 16): string {
  return createElement(node, { width: size, height: size, 'stroke-width': 1.75, 'aria-hidden': 'true' }).outerHTML;
}

export const icon = {
  back: (s?: number) => svg(ArrowLeft, s),
  talk: (s?: number) => svg(MessageCircle, s),
  send: (s?: number) => svg(ArrowUp, s),
  download: (s?: number) => svg(Download, s),
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
  skyAuto: (s?: number) => svg(CloudSun, s),
  skyClear: (s?: number) => svg(Sun, s),
  skyOvercast: (s?: number) => svg(Cloud, s),
  skyRain: (s?: number) => svg(CloudRain, s),
  skyStorm: (s?: number) => svg(CloudLightning, s),
  soundOn: (s?: number) => svg(Volume2, s),
  soundOff: (s?: number) => svg(VolumeX, s),
  shirt: (s?: number) => svg(Shirt, s),
  shuffle: (s?: number) => svg(Shuffle, s),
  room: (s?: number) => svg(Armchair, s),
  turnLeft: (s?: number) => svg(RotateCcw, s),
  turnRight: (s?: number) => svg(RotateCw, s),
  copy: (s?: number) => svg(Copy, s),
  trash: (s?: number) => svg(Trash2, s),
  tick: (s?: number) => svg(Check, s),
  undo: (s?: number) => svg(Undo2, s),
  settings: (s?: number) => svg(Settings, s),
  home: (s?: number) => svg(House, s),
  userPlus: (s?: number) => svg(UserPlus, s),
  users: (s?: number) => svg(Users, s),
  idea: (s?: number) => svg(Lightbulb, s),
  refresh: (s?: number) => svg(RotateCw, s),
  grip: (s?: number) => svg(GripVertical, s),
  ongoing: (s?: number) => svg(Repeat, s),
  calendar: (s?: number) => svg(CalendarDays, s),
  prev: (s?: number) => svg(ChevronLeft, s),
  next: (s?: number) => svg(ChevronRight, s),
  inbox: (s?: number) => svg(Inbox, s),
  bell: (s?: number) => svg(Bell, s),
  history: (s?: number) => svg(History, s),
  stop: (s?: number) => svg(CircleStop, s),
  critique: (s?: number) => svg(MessageSquareWarning, s),
  search: (s?: number) => svg(Search, s),
  external: (s?: number) => svg(ExternalLink, s),
  plug: (s?: number) => svg(Plug, s),
  attach: (s?: number) => svg(Paperclip, s),
  doc: (s?: number) => svg(FileText, s),
  sheet: (s?: number) => svg(FileSpreadsheet, s),
  slides: (s?: number) => svg(Presentation, s),
  file: (s?: number) => svg(FileIcon, s),
  image: (s?: number) => svg(ImageIcon, s),
  globe: (s?: number) => svg(Globe, s),
  chevron: (s?: number) => svg(ChevronDown, s),
  star: (s?: number) => svg(Star, s),
  link: (s?: number) => svg(LinkIcon, s),
  box: (s?: number) => svg(Package, s),
  archive: (s?: number) => svg(Archive, s),
  unarchive: (s?: number) => svg(ArchiveRestore, s),
  bookmark: (s?: number) => svg(Bookmark, s),
  text: (s?: number) => svg(Type, s),
  sparkles: (s?: number) => svg(Sparkles, s),
  chart: (s?: number) => svg(ChartColumn, s),
  contact: (s?: number) => svg(Contact, s),
  wrench: (s?: number) => svg(Wrench, s),
  coins: (s?: number) => svg(Coins, s),
  code: (s?: number) => svg(CodeXml, s),
  palette: (s?: number) => svg(Palette, s),
  plan: (s?: number) => svg(ListChecks, s),
};

const ROLE_WORK: Record<RoleId, IconNode> = {
  director: Compass,
  organizer: ListChecks,
  interviewer: MessageCircleQuestion,
  research: Search,
  art: Palette,
  design: PenTool,
  uiux: PanelsTopLeft,
  dev: CodeXml,
  marketing: Megaphone,
  skeptic: Scale,
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
    case 'away':
      return svg(House, size);
    case 'patrolling':
      return svg(Footprints, size);
    case 'visiting':
      return svg(MessageSquareWarning, size);
    case 'roaming':
      return svg(Route, size);
    case 'interview':
    case 'interviewing':
      return svg(Handshake, size);
    case 'talking':
      return svg(MessageCircle, size);
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
  away: 'Fuera de la oficina',
  patrolling: 'Rondando fuera',
  visiting: 'Hablando con dirección',
  roaming: 'Recorriendo el equipo',
  interview: 'En su bienvenida',
  interviewing: 'Recibiendo a alguien nuevo',
  talking: 'Conversando',
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
    office: DoorOpen,
    team: UserPlus,
    critique: MessageSquareWarning,
    interview: Handshake,
    talk: MessageCircle,
    question: MessageCircleQuestion,
    calendar: CalendarDays,
  };
  return svg(map[kind], size);
}
