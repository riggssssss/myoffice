import type { Look } from './look';
import type { TextProvider, WorkerAi } from './settings';

export type RoleId =
  | 'director'
  | 'organizer'
  | 'interviewer'
  | 'research'
  | 'design'
  | 'dev'
  | 'marketing'
  | 'skeptic';

export type TaskStatus = 'backlog' | 'doing' | 'blocked' | 'review' | 'done';

export type Activity =
  | 'working'
  | 'pairing'
  | 'reviewing'
  | 'meeting'
  | 'coffee'
  | 'blocked'
  | 'idle'
  /** Not in the office: the office is closed or this worker is switched off. */
  | 'away'
  /** The sceptic, walking round the outside of the office. */
  | 'patrolling'
  /** The sceptic, inside beside the head with a criticism. */
  | 'visiting'
  /** The organiser, going round the team's desks. */
  | 'roaming'
  /** New to the office: being interviewed on arrival. */
  | 'interview'
  /** The interviewer, with a newcomer. */
  | 'interviewing'
  /** In a conversation with a colleague (see Worker.talk). */
  | 'talking';

export interface Worker {
  id: string;
  name: string;
  title: string;
  role: RoleId;
  desk: number;
  look: Look;
  /** Boss in the org chart; null for the head of the office (exactly one). */
  reportsTo: string | null;
  /** Outside the chain of command (e.g. the sceptic): answers to the head, supervises nobody. */
  staff: boolean;
  /** Switched off by hand: stays home even while the office works. */
  enabled: boolean;
  activity: Activity;
  taskId: string | null;
  /** Working together at this partner's desk. */
  pairWith: string | null;
  /** The sceptic only: epoch ms until which they are inside talking to the head. */
  visitUntil: number | null;
  /** New hires: the interviewer still has to meet them. */
  needsInterview: boolean;
  /** While being interviewed: when it started (epoch ms). */
  interviewSince: number | null;
  /** Which AI they think with and which connectors they use. */
  ai: WorkerAi;
  /** In a conversation right now: with whom, and whether the other came to them (host). */
  talk: { convId: string; with: string; host: boolean } | null;
  /** What they'll do here, in their own words, from their interview on arrival. */
  brief: string | null;
  /** Heads-down at their desk right now (their AI is working): what on. */
  busyWith: string | null;
  /** Your chat with them, one to one: the last lines, and whether your last message awaits an answer. */
  chat?: DirectChat;
}

export interface DirectChat {
  lines: ChatLine[];
  /** You wrote and they haven't answered yet. */
  pending: boolean;
  /** Answering right now: what they're doing («escribiendo», «mirando las tareas»). */
  thinking: string | null;
  /** The same, for the chat: in words fit to show, the app it's in, what it's looking at. */
  doing?: ChatActivity | null;
  /** Earlier chats you restarted from, newest first: kept to reread, never quoted to their AI. */
  archive?: { at: number; lines: ChatLine[] }[];
}

/** What someone is doing while they answer you. */
export interface ChatActivity {
  label: string;
  /** The app or connector (its id), for its logo. */
  app?: string;
  /** Pictures it's looking at right now. */
  images?: string[];
}

/** A file in a chat: yours, or one they send you. Kept in the office's data folder. */
export interface ChatFile {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: 'image' | 'doc';
}

/** A picture from one of your apps (an address on its site), shown in the chat. */
export interface ChatImage {
  url: string;
  title?: string;
  /** Where it lives (the pin, the post…). */
  link?: string;
}

export type ConversationKind = 'interview' | 'checkin' | 'critique' | 'colleagues' | 'direction' | 'handoff' | 'ask';

/** A tool an agent used while saying something, as shown in the transcript. */
export interface ToolUse {
  name: string;
  /** What it did, in a few words (e.g. «leyó https://…», «creó la tarea …»). */
  note: string;
  /** The app or connector it used (its id), for its logo. */
  app?: string;
  /** Pictures it saw there. */
  images?: string[];
}

export interface ChatLine {
  at: number;
  speaker: string;
  text: string;
  tools: ToolUse[];
  files?: ChatFile[];
  images?: ChatImage[];
}

/** Two agents talking, for real: each line comes from their AI, with their tools. */
export interface Conversation {
  id: string;
  kind: ConversationKind;
  /** Who starts it and goes to the other. */
  a: string;
  /** Who is visited. */
  b: string;
  topic: string;
  startedAt: number;
  endedAt: number | null;
  lines: ChatLine[];
  /** Someone is thinking (calling their AI or a tool) right now. */
  thinking: { who: string; tool: string | null } | null;
  conclusion: string | null;
  /** Why it stopped early, if it did (no key, the office closed…). */
  error: string | null;
  /** Cut because they were going round in circles. */
  looped?: boolean;
}

/** Something you ask the office for, in your words: the organiser turns it into tasks. */
export interface WorkRequest {
  id: string;
  text: string;
  at: number;
  status: 'waiting' | 'working' | 'done' | 'failed';
  /** What the organiser did with it, in their words (or why it failed). */
  reply: string | null;
  tools: ToolUse[];
  /** While working: the tool in use. */
  tool: string | null;
  doneAt: number | null;
  /** Written to this agent: they take it to the organiser. null: straight to the organiser. */
  via: string | null;
}

/** Something an agent needs from you to do their work, put into words by their boss. */
export interface Question {
  id: string;
  /** Who needs it. */
  workerId: string;
  /** Who asked you: their boss (null: they asked you themselves). */
  byId: string | null;
  /** The task they paused until you answer. */
  taskId: string | null;
  /** information: details only you know; connector: a tool (MCP) or access they lack. */
  kind: 'information' | 'connector';
  text: string;
  at: number;
  answer: string | null;
  answeredAt: number | null;
  /** The answer has reached the agent's notes. */
  delivered: boolean;
}

/** Something on the calendar: a call, a deadline, a launch… */
export interface CalendarEvent {
  id: string;
  title: string;
  /** When it starts (for an all-day event, any time that day). */
  start: number;
  allDay: boolean;
  note: string;
  /** 'owner' if you put it there, else the agent who did. */
  by: string;
  /** Reminders already given, so they're said once: 'eve' the day before, 'day' that morning, 'soon' an hour before. */
  told: ('eve' | 'day' | 'soon')[];
}

/** What you can do straight from a message. */
export type MessageAction =
  | { type: 'hire'; role: RoleId; title: string; name: string }
  | { type: 'answer'; questionId: string }
  | { type: 'calendar'; eventId: string | null }
  | { type: 'meeting' }
  | { type: 'ideas' }
  | { type: 'change'; changeId: string }
  | { type: 'app'; actionId: string };

/** Something an agent tells you directly: a reminder, a question, a suggestion to hire… */
export interface OwnerMessage {
  id: string;
  at: number;
  /** The agent who says it. */
  from: string;
  kind: 'reminder' | 'question' | 'hire' | 'reply' | 'meeting' | 'ideas' | 'change' | 'app';
  text: string;
  /** Why, in more detail (a hire's reasons, a question's context). */
  detail: string;
  action: MessageAction | null;
  read: boolean;
  /** Acted on or set aside: it stays in the list but asks for nothing more. */
  closed: boolean;
}

/** Someone the head thinks your project needs, offered in «Añadir agente». */
export interface HireIdea {
  role: RoleId;
  title: string;
  name: string;
  /** Why, for you: one plain sentence tied to your product. */
  why: string;
}

/** Who the office would hire next, from what it knows of your project. */
export interface HireIdeas {
  /** asked: waiting for the head's AI; thinking: on it; ready / failed: done. */
  status: 'idle' | 'asked' | 'thinking' | 'ready' | 'failed';
  items: HireIdea[];
  /** What they were drawn from (dossier, team), to tell when they've gone out of date. */
  basis: string;
  at: number;
  /** Who suggested them (the head). */
  by: string | null;
  /** Why there are none, or that they're the basic ones (no AI). */
  note: string;
}

/** How the office's AI is doing, for the panel. */
export interface AiStatus {
  /** off: nobody has a working AI; ready: conversations run; paused: daily limit or an error. */
  state: 'off' | 'ready' | 'paused';
  note: string;
  day: string;
  tokensToday: number;
  limit: number;
  /** AIs of the priority list that are resting after a limit or a failure, and until when. */
  resting: { provider: TextProvider; model: string; until: number; why: string }[];
  /** The one that answered last, when it isn't the first of the list. */
  using: { provider: TextProvider; model: string } | null;
  /**
   * Why it isn't thinking, in a word the panel explains: no key set, your own daily cap, the
   * provider's free daily allowance, its per-minute limit, no credit, a bad key, a missing
   * model, the provider down. Null when all is well.
   */
  reason: AiReason | null;
  /** When it should work again on its own (epoch ms), if it will. */
  back: number | null;
}

export type AiReason = 'nokey' | 'office-limit' | 'daily' | 'minute' | 'credits' | 'key' | 'model' | 'down';

export interface Task {
  id: string;
  title: string;
  role: RoleId;
  assigneeId: string | null;
  status: TaskStatus;
  /** 0–100, as reported by whoever does it. */
  progress: number;
  estimate: number;
  createdAt: number;
  doneAt: number | null;
  blockReason: string | null;
  /** What was produced while working on it, newest last. */
  notes: WorkNote[];
  /** Paused for the whole office (health below the threshold), to resume afterwards. */
  heldByCrisis?: boolean;
  /**
   * Ongoing: no end and no percentage (keeping the socials going, watching the competition).
   * It runs alongside whatever they're on until you stop it; it never takes their queue.
   */
  ongoing?: boolean;
  /** Place in their queue (lower goes first): set when you reorder it by hand. */
  order?: number;
}

/** One stretch of real work on a task: what they did and what came out. */
export interface WorkNote {
  at: number;
  by: string;
  text: string;
  tools: ToolUse[];
}

/** What the office knows about the product, aspect by aspect, from talking to you. */
export type BriefAspect = 'que' | 'para_quien' | 'problema' | 'objetivos' | 'estado' | 'canales' | 'marca' | 'restricciones' | 'prioridades';

export interface ProjectBrief {
  aspects: Partial<Record<BriefAspect, { text: string; confidence: number; at: number }>>;
  /** The first meeting with you has happened. */
  kickedOff: boolean;
  /**
   * What you've ruled on, in your words: who does what, how often, what's not up for discussion.
   * It outranks everything else the team knows; nobody asks about it again.
   */
  rulings?: { text: string; at: number }[];
  /** Things you've said you handle yourself («la indexación es cosa mía»): the team drops them. */
  yours?: string[];
  /** Webs you've passed to the office, to read and go back to. */
  links?: { url: string; title: string; at: number }[];
}

/** One of the things the office's health is made of (0–100). */
export interface HealthAspect {
  id: 'claridad' | 'foco' | 'orden' | 'avance' | 'bloqueos';
  label: string;
  value: number;
  weight: number;
  note: string;
}

export interface Health {
  overall: number;
  aspects: HealthAspect[];
  /** Below this the office stops and calls you in. */
  threshold: number;
  crisis: boolean;
  /** When the last crisis began. */
  crisisAt?: number;
  /** When you last finished a meeting with them (also one closed before anyone spoke). */
  lastMeetingEnd?: number;
  /** No alarms until then: after a meeting, they get time to put it to work. */
  calmUntil?: number;
}

export interface MeetingLine {
  at: number;
  /** A worker id, or 'owner' (you). */
  speaker: string;
  text: string;
  tools: ToolUse[];
}

/** You and the office's top rows, around the meeting table. */
export interface Meeting {
  id: string;
  /** kickoff: the story begins (head and Entrevistas); review: called by you; crisis: called because health fell. */
  kind: 'kickoff' | 'review' | 'crisis';
  participants: string[];
  /** gathering: walking to the table; live: talking; closing: writing the minutes. */
  status: 'gathering' | 'live' | 'closing' | 'ended';
  startedAt: number;
  endedAt: number | null;
  lines: MeetingLine[];
  /** Whose turn it is: yours, or theirs (an AI is answering). */
  waitingFor: 'owner' | 'agents';
  thinking: { who: string; tool: string | null } | null;
  /** The minutes: decisions and next steps. */
  summary: string | null;
  /** Topics you've answered or closed in this meeting («fechas», «presupuesto»): not asked again. */
  closed?: string[];
  /** What you told someone at the table to do, already a task: the minutes' next steps. */
  orders?: string[];
}

export type FeedKind =
  | 'start'
  | 'done'
  | 'review'
  | 'blocked'
  | 'unblocked'
  | 'pair'
  | 'unpair'
  | 'coffee'
  | 'meeting'
  | 'create'
  | 'edit'
  | 'day'
  | 'office'
  | 'team'
  | 'critique'
  | 'interview'
  | 'talk'
  | 'question'
  | 'calendar'
  | 'meeting';

export interface FeedEvent {
  id: number;
  /** Epoch ms. */
  t: number;
  kind: FeedKind;
  text: string;
  workerId: string | null;
  taskId: string | null;
}

export interface SimState {
  version: number;
  agency: string;
  project: string;
  /** Epoch ms of the last server tick (real time, no speed-up). */
  clock: number;
  /** The office switch: everyone enabled comes in to work. */
  working: boolean;
  workers: Worker[];
  tasks: Task[];
  feed: FeedEvent[];
  /** Live conversations and the latest finished ones. */
  conversations: Conversation[];
  /** Your requests to the organiser, newest first. */
  requests: WorkRequest[];
  /** What agents need from you; answered ones stay a while as a record. */
  questions: Question[];
  brief: ProjectBrief;
  health: Health;
  /** The meeting going on with you, if any. */
  meeting: Meeting | null;
  /** Past meetings with you (their minutes), newest first. */
  meetings: Meeting[];
  /** What's on the calendar: yours, and what the agents schedule. */
  events: CalendarEvent[];
  /** Everything the agents say to you directly, newest first. */
  inbox: OwnerMessage[];
  hireIdeas: HireIdeas;
  ai: AiStatus;
  nextId: number;
}

export interface RoleInfo {
  id: RoleId;
  label: string;
  color: string;
  /** Default job title for a new agent in this role. */
  title: string;
  /** What the role brings, shown when choosing it. */
  about: string;
}
