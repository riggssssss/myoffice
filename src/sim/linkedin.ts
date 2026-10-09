/**
 * Posting on LinkedIn for you: your voice (how you write), the weekly plan (what goes out which
 * day, with which hook) and how each post went. Nothing is published without your yes.
 */

export type PostType = 'prueba' | 'opinion' | 'ensena' | 'historia' | 'oferta';

export const POST_TYPES: Record<PostType, { label: string; job: string }> = {
  prueba: { label: 'Prueba', job: 'algo que pasó, con una cifra' },
  opinion: { label: 'Opinión', job: 'una postura que podría costarte seguidores' },
  ensena: { label: 'Enseña', job: 'una cosa que el lector puede hacer hoy' },
  historia: { label: 'Historia', job: 'una escena con diálogo y un coste' },
  oferta: { label: 'Oferta', job: 'lo que vendes, dicho claro y sin disculparte' },
};

/** Days as JavaScript numbers them (0 = domingo). */
export const WEEK_DAYS: { n: number; short: string; name: string }[] = [
  { n: 1, short: 'L', name: 'lunes' },
  { n: 2, short: 'M', name: 'martes' },
  { n: 3, short: 'X', name: 'miércoles' },
  { n: 4, short: 'J', name: 'jueves' },
  { n: 5, short: 'V', name: 'viernes' },
  { n: 6, short: 'S', name: 'sábado' },
  { n: 0, short: 'D', name: 'domingo' },
];

export interface PlanSettings {
  on: boolean;
  /** Posts a week: four beat seven; the fifth is usually the weak one. */
  perWeek: number;
  /** Days it may post on (0 = Sunday). */
  days: number[];
  /** Time of day the post is meant for, HH:MM in this computer's time. */
  time: string;
  /** Who runs it (an agent id), or null: whoever fits best. */
  who: string | null;
  /** What you want to be known for, and what happened this week (that's where posts come from). */
  themes: string;
}

export const DEFAULT_PLAN: PlanSettings = { on: false, perWeek: 3, days: [2, 3, 4], time: '08:30', who: null, themes: '' };

export type SlotStatus = 'planeado' | 'escribiendo' | 'esperando' | 'publicado' | 'descartado' | 'fallo';

export interface PlanSlot {
  id: string;
  /** When it's meant to go out (epoch ms). */
  at: number;
  type: PostType;
  /** Hook formula number (1-21). */
  hook: number;
  angle: string;
  status: SlotStatus;
  /** The approval waiting in «Para ti», once written. */
  actionId?: string;
  score?: number;
  note?: string;
  /** Attempts at writing it. */
  tries?: number;
}

export interface PlanWeek {
  /** ISO week, e.g. 2026-W41. */
  week: string;
  at: number;
  by: string;
  slots: PlanSlot[];
  /** Kinds of accounts (or the people you named) worth engaging with, 20 minutes a day. */
  engage: string[];
  note: string;
}

export interface LinkedInView {
  connected: boolean;
  voice: string;
  plan: PlanSettings;
  week: PlanWeek | null;
  /** Writing a post or the plan right now. */
  busy: string | null;
  /** Who would run it now (when `who` is null, the best fit). */
  runner: string | null;
}

/** A post's review, shown on its approval card. */
export interface PostReview {
  score: number;
  verdict: 'pasa' | 'revisar' | 'suena a IA';
  weakest: string;
  flags: string[];
  /** It was planned for this moment (epoch ms). */
  for?: number;
}

export const VOICE_TEMPLATE = `## Quién soy
- Qué hago, en una frase:
- Para quién escribo (concreto: «dueños de agencias pequeñas», no «profesionales»):
- Qué vendo:

## Cómo sueno
- Palabras que uso de verdad:
- Palabras que nunca usaría:
- Frases: (cortas y directas / mezcladas / largas y pensadas)
- Tacos: (sí / suaves / no)
- Emojis: (nunca / uno, de vez en cuando / sin problema)
- Tuteo o usted:

## Lo que defiendo
Tres a cinco cosas que creo y parte de mi público no. De aquí salen los buenos posts.
1.
2.
3.

## Prohibido
- Temas de los que no hablo:
- Clientes o cifras que no puedo nombrar:

## Pruebas que puedo usar
Cifras, resultados e historias reales con mi nombre. Sin esto, cada borrador lleva {{tu cifra}} donde haga falta.
-
`;
