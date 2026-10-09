/**
 * The office's visual style, learnt by its art director: the reference pictures you send them,
 * each analysed the way a production crew would (to shoot it again tomorrow), and a living style
 * guide that sums them up and steers every picture the office makes.
 */

export type StyleSection = 'luz' | 'color' | 'composicion' | 'escena' | 'materiales' | 'tipografia' | 'evitar';

export const STYLE_SECTIONS: { id: StyleSection; label: string }[] = [
  { id: 'luz', label: 'Luz' },
  { id: 'color', label: 'Color y etalonaje' },
  { id: 'composicion', label: 'Composición y cámara' },
  { id: 'escena', label: 'Escena y atrezo' },
  { id: 'materiales', label: 'Materiales y texturas' },
  { id: 'tipografia', label: 'Tipografía' },
  { id: 'evitar', label: 'Evitar' },
];

/** A colour measured from the picture itself, and how much of it there is (0-1). */
export interface Swatch {
  hex: string;
  share: number;
}

export interface RefAnalysis {
  summary: string;
  composition: { shot: string; angle: string; lens: string; depthOfField: string; layout: string; negativeSpace: string };
  lighting: { key: string; fill: string; rim: string; hardness: string; colorTemp: string; timeOfDay: string; shadows: string; reflections: string };
  color: { palette: string[]; contrast: string; saturation: string; whiteBalance: string; grading: string; grain: string };
  materials: string[];
  scene: { setting: string; props: string[]; styling: string };
  mood: string;
  typography: string;
  works: string[];
  avoid: string[];
  tags: string[];
  /** An English style fragment that brings this look back in an image model (no subject). */
  promptEn: string;
}

export interface StyleRef {
  id: string;
  fileId: string;
  name: string;
  from: 'chat' | 'upload';
  at: number;
  note: string;
  /** What you think of it: liked ones weigh double in the guide, disliked ones only teach what to avoid. */
  verdict: 'like' | 'dislike' | null;
  palette: Swatch[];
  status: 'pending' | 'analyzing' | 'ready' | 'failed';
  error?: string;
  analysis: RefAnalysis | null;
  /** The AI that looked at it. */
  model?: string;
}

export interface StyleGuide {
  version: number;
  at: number;
  sections: Record<StyleSection, string[]>;
  /** English style block added to every picture the office makes. */
  prompt: string;
  palette: string[];
  /** Lines you wrote or fixed yourself: the art director keeps them as they are. */
  owner: Partial<Record<StyleSection, string[]>>;
  ownerPrompt: boolean;
  /** References it was built from. */
  basedOn: string[];
}

export interface StyleView {
  refs: StyleRef[];
  guide: StyleGuide | null;
  /** Rewriting the guide right now. */
  thinking: boolean;
  /** Who leads the look (the art director), if there's one. */
  director: string | null;
}

export const MAX_REFS = 80;
export const GUIDE_LINES = 8;
export const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
