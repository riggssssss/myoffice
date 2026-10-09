/**
 * What the team can make or find and hand over, kind by kind: the word you see and the hint
 * the agents get. Shared by the server (tools, reviews) and the panel (Entregas, Inventario).
 */
import type { Item, ItemKind } from './types';

export const ITEM_KINDS: Record<ItemKind, { label: string; hint: string }> = {
  doc: { label: 'Documento', hint: 'informe largo, brief, guía, acta, manual' },
  image: { label: 'Imagen', hint: 'una imagen generada o elegida' },
  link: { label: 'Enlace', hint: 'una web útil que han encontrado' },
  reference: { label: 'Referencia', hint: 'ejemplo o inspiración visual, de la competencia o de estilo' },
  code: { label: 'Script', hint: 'código, script, automatización, fórmula' },
  copy: { label: 'Texto', hint: 'post, copy, guion de vídeo, email, descripción' },
  prompt: { label: 'Prompt', hint: 'prompt para generar imágenes o texto' },
  data: { label: 'Datos', hint: 'tabla, lista, CSV, comparativa' },
  idea: { label: 'Idea', hint: 'propuesta o idea concreta' },
  plan: { label: 'Plan', hint: 'plan, calendario, hoja de ruta, pasos' },
  report: { label: 'Informe', hint: 'análisis, conclusiones de una investigación' },
  contact: { label: 'Contacto', hint: 'persona, empresa, proveedor o cliente posible' },
  tool: { label: 'Herramienta', hint: 'app, servicio o API que sirve al proyecto' },
  budget: { label: 'Presupuesto', hint: 'costes, precios, estimación' },
  palette: { label: 'Estilo', hint: 'paleta, tipografías, moodboard' },
};

export const ITEM_KIND_IDS = Object.keys(ITEM_KINDS) as ItemKind[];

/** Still on its way: in someone's hands, not yet yours nor set aside. */
export const onTheWay = (i: Item) => i.status === 'held' || i.status === 'review' || i.status === 'back';

/** Who's who in an item's trail, in words. */
export const ITEM_ACTS: Record<Item['trail'][number]['act'], string> = {
  made: 'lo hizo',
  up: 'lo dio por bueno',
  better: 'lo mejoró',
  back: 'lo devolvió',
  dropped: 'lo descartó',
  sent: 'te lo envió por el chat',
  asked: 'pediste cambios',
  redo: 'lo rehízo',
};
