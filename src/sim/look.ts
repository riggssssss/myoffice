/** How a worker looks. Everything a person can change in the appearance editor. */
export interface Look {
  /** Which figure stands in for the worker. Only the toy figure uses the fields below. */
  model: Model;
  skin: string;
  hairStyle: HairStyle;
  hairColor: string;
  facialHair: FacialHair;
  headwear: Headwear;
  headwearColor: string;
  glasses: Glasses;
  top: Top;
  /** null = use the role colour, so the team still reads by role at a glance. */
  topColor: string | null;
  pantsColor: string;
  shoeColor: string;
}

export type Model = 'totoro' | 'toy';
export type HairStyle = 'bald' | 'buzz' | 'short' | 'fringe' | 'curly' | 'long' | 'bun' | 'ponytail';
export type FacialHair = 'none' | 'moustache' | 'goatee' | 'beard' | 'full';
export type Headwear = 'none' | 'beanie' | 'cap' | 'hat' | 'hood';
export type Glasses = 'none' | 'round' | 'square' | 'sun';
export type Top = 'hoodie' | 'tee' | 'vest';

export interface Option<T extends string> {
  id: T;
  label: string;
}
export interface Swatch {
  color: string;
  label: string;
}

export const MODELS: Option<Model>[] = [
  { id: 'totoro', label: 'Totoro' },
  { id: 'toy', label: 'Muñeco' },
];

export const HAIR_STYLES: Option<HairStyle>[] = [
  { id: 'short', label: 'Corto' },
  { id: 'fringe', label: 'Flequillo' },
  { id: 'buzz', label: 'Rapado' },
  { id: 'curly', label: 'Rizado' },
  { id: 'long', label: 'Largo' },
  { id: 'bun', label: 'Moño' },
  { id: 'ponytail', label: 'Coleta' },
  { id: 'bald', label: 'Sin pelo' },
];

export const FACIAL_HAIR: Option<FacialHair>[] = [
  { id: 'none', label: 'Nada' },
  { id: 'moustache', label: 'Bigote' },
  { id: 'goatee', label: 'Perilla' },
  { id: 'beard', label: 'Barba' },
  { id: 'full', label: 'Barba y bigote' },
];

export const HEADWEAR: Option<Headwear>[] = [
  { id: 'none', label: 'Nada' },
  { id: 'beanie', label: 'Gorro de lana' },
  { id: 'cap', label: 'Gorra' },
  { id: 'hat', label: 'Sombrero' },
  { id: 'hood', label: 'Capucha' },
];

export const GLASSES: Option<Glasses>[] = [
  { id: 'none', label: 'Sin gafas' },
  { id: 'round', label: 'Redondas' },
  { id: 'square', label: 'Cuadradas' },
  { id: 'sun', label: 'De sol' },
];

export const TOPS: Option<Top>[] = [
  { id: 'hoodie', label: 'Sudadera' },
  { id: 'tee', label: 'Camiseta' },
  { id: 'vest', label: 'Chaleco acolchado' },
];

export const SKINS: Swatch[] = [
  { color: '#f3d2b8', label: 'Muy clara' },
  { color: '#e8bf9c', label: 'Clara' },
  { color: '#d9a982', label: 'Clara media' },
  { color: '#c98d6a', label: 'Media' },
  { color: '#a8714c', label: 'Morena' },
  { color: '#8d5b3e', label: 'Oscura' },
  { color: '#6a412b', label: 'Muy oscura' },
  { color: '#4a2c1e', label: 'Profunda' },
];

export const HAIR_COLORS: Swatch[] = [
  { color: '#1f1a17', label: 'Negro' },
  { color: '#3b2a20', label: 'Castaño oscuro' },
  { color: '#6b4a2e', label: 'Marrón' },
  { color: '#b08a5a', label: 'Castaño claro' },
  { color: '#dcb36d', label: 'Rubio' },
  { color: '#a8482a', label: 'Pelirrojo' },
  { color: '#a19c94', label: 'Canoso' },
  { color: '#e46f86', label: 'Rosa' },
  { color: '#4a6fc4', label: 'Azul' },
];

export const CLOTH_COLORS: Swatch[] = [
  { color: '#2f4f43', label: 'Verde bosque' },
  { color: '#e9c64a', label: 'Amarillo' },
  { color: '#6b5a48', label: 'Marrón' },
  { color: '#d9d4c9', label: 'Crudo' },
  { color: '#2b2a28', label: 'Negro' },
  { color: '#c4473a', label: 'Rojo' },
  { color: '#3f5f99', label: 'Azul' },
  { color: '#e7a6b4', label: 'Rosa' },
];

export const PANTS_COLORS: Swatch[] = [
  { color: '#9cbde0', label: 'Vaquero claro' },
  { color: '#3d5476', label: 'Vaquero oscuro' },
  { color: '#4a3a32', label: 'Marrón' },
  { color: '#6e6b4f', label: 'Caqui' },
  { color: '#2a2826', label: 'Negro' },
  { color: '#cbbfa7', label: 'Beis' },
];

export const SHOE_COLORS: Swatch[] = [
  { color: '#25221f', label: 'Negras' },
  { color: '#f1ede4', label: 'Blancas' },
  { color: '#c58f3c', label: 'Mostaza' },
  { color: '#b33a2f', label: 'Rojas' },
  { color: '#3f5f99', label: 'Azules' },
];

export const DEFAULT_LOOK: Look = {
  model: 'totoro',
  skin: '#d9a982',
  hairStyle: 'short',
  hairColor: '#3b2a20',
  facialHair: 'none',
  headwear: 'none',
  headwearColor: '#d9d4c9',
  glasses: 'none',
  top: 'hoodie',
  topColor: null,
  pantsColor: '#4a3a32',
  shoeColor: '#25221f',
};

export const SEED_LOOKS: Record<string, Look> = {
  pepe: { ...DEFAULT_LOOK, skin: '#e2b48f', hairStyle: 'short', glasses: 'round', headwear: 'beanie', headwearColor: '#d9d4c9', pantsColor: '#4a3a32' },
  maria: { ...DEFAULT_LOOK, skin: '#c98d6a', hairStyle: 'bun', hairColor: '#1f1a17', top: 'tee', pantsColor: '#9cbde0', shoeColor: '#f1ede4' },
  manuel: { ...DEFAULT_LOOK, skin: '#f0c7a6', hairStyle: 'fringe', hairColor: '#6b4a2e', headwear: 'cap', headwearColor: '#6b5a48', pantsColor: '#6e6b4f' },
  lucia: { ...DEFAULT_LOOK, skin: '#8d5b3e', hairStyle: 'long', hairColor: '#1f1a17', glasses: 'square', top: 'vest', pantsColor: '#2a2826', shoeColor: '#c58f3c' },
  javier: { ...DEFAULT_LOOK, skin: '#e8bf9c', hairStyle: 'buzz', hairColor: '#a19c94', facialHair: 'full', pantsColor: '#3d5476' },
  sara: { ...DEFAULT_LOOK, skin: '#d8a07a', hairStyle: 'ponytail', hairColor: '#a8482a', glasses: 'sun', top: 'tee', pantsColor: '#cbbfa7', shoeColor: '#b33a2f' },
};

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const chance = (p: number) => Math.random() < p;

export function randomLook(): Look {
  const top = pick(TOPS).id;
  const headwear = chance(0.45) ? pick(HEADWEAR.filter((h) => h.id !== 'none' && (h.id !== 'hood' || top === 'hoodie'))).id : 'none';
  return {
    model: 'toy',
    skin: pick(SKINS).color,
    hairStyle: pick(HAIR_STYLES).id,
    hairColor: chance(0.1) ? pick(HAIR_COLORS.slice(7)).color : pick(HAIR_COLORS.slice(0, 7)).color,
    facialHair: chance(0.35) ? pick(FACIAL_HAIR.slice(1)).id : 'none',
    headwear,
    headwearColor: pick(CLOTH_COLORS).color,
    glasses: chance(0.4) ? pick(GLASSES.slice(1)).id : 'none',
    top,
    topColor: chance(0.5) ? null : pick(CLOTH_COLORS).color,
    pantsColor: pick(PANTS_COLORS).color,
    shoeColor: pick(SHOE_COLORS).color,
  };
}
