// Tail emblems: one set of shapes shared by the 3D liveries (drawn to a canvas
// with Path2D) and the 2D interface (rendered as SVG).
//
// Every path is drawn in a 100 × 100 box and is meant to be filled.

import type { Livery } from '../../sim/types';

export const EMBLEM_PATHS: Record<Livery['emblem'], string> = {
  chevron: 'M8 62 L50 18 L92 62 L74 62 L50 38 L26 62 Z M8 86 L50 44 L92 86 L74 86 L50 64 L26 86 Z',
  bird: 'M6 56 C22 38 40 34 54 44 C62 30 78 20 96 20 C86 30 80 42 76 56 C70 74 54 84 34 82 C44 76 50 68 50 60 C38 52 22 52 6 56 Z',
  star: 'M50 6 L61 38 L95 38 L67 58 L78 92 L50 71 L22 92 L33 58 L5 38 L39 38 Z',
  sun: 'M50 26 A24 24 0 1 1 49.9 26 Z M46 2 H54 V16 H46 Z M46 84 H54 V98 H46 Z M2 46 H16 V54 H2 Z M84 46 H98 V54 H84 Z M15 20 L20 15 L30 25 L25 30 Z M70 75 L75 70 L85 80 L80 85 Z M80 15 L85 20 L75 30 L70 25 Z M25 70 L30 75 L20 85 L15 80 Z',
  wing: 'M4 70 C26 66 46 54 60 34 C66 26 76 18 96 14 C90 26 84 34 74 40 L88 40 C80 50 70 56 58 58 L72 60 C62 70 48 76 30 76 C20 76 10 74 4 70 Z',
  compass: 'M50 4 L60 40 L96 50 L60 60 L50 96 L40 60 L4 50 L40 40 Z M50 30 A20 20 0 1 0 50.1 30 Z',
  wave: 'M4 44 C20 22 36 22 50 40 C64 58 80 58 96 36 L96 54 C80 76 64 76 50 58 C36 40 20 40 4 62 Z M4 72 C20 54 36 54 50 68 C64 82 80 82 96 66 L96 80 C80 94 64 94 50 82 C36 70 20 70 4 86 Z',
  crown: 'M8 80 L4 30 L28 52 L50 16 L72 52 L96 30 L92 80 Z M10 86 H90 V94 H10 Z',
  leaf: 'M50 4 C82 20 92 52 70 80 C64 88 56 92 52 94 L52 60 L68 44 L64 40 L52 52 L52 30 L48 30 L48 58 L34 44 L30 48 L48 66 L48 94 C22 84 6 50 50 4 Z',
  bolt: 'M58 4 L18 56 H44 L36 96 L82 40 H54 Z',
};

export const EMBLEMS = Object.keys(EMBLEM_PATHS) as Livery['emblem'][];

export const LIVERY_STYLES: { id: Livery['style']; name: string }[] = [
  { id: 'cheatline', name: 'Cheatline' },
  { id: 'eurowhite', name: 'Eurowhite' },
  { id: 'wave', name: 'Wave' },
  { id: 'tailband', name: 'Tail band' },
  { id: 'bellyswoop', name: 'Belly swoop' },
  { id: 'retro', name: 'Retro stripes' },
  { id: 'solid', name: 'Solid colour' },
];
