import type { AiState, AirportId, Livery } from '../types';

// Rival airlines. All of them are fictional.

export interface AirlineTemplate {
  name: string;
  code: string;
  hq: AirportId;
  /** Additional hubs. */
  hubs?: AirportId[];
  style: AiState['style'];
  /** Aircraft at the start of a standard game. */
  size: number;
  livery: Livery;
}

const L = (primary: string, secondary: string, style: Livery['style'], emblem: Livery['emblem'], base = '#f4f6f8'): Livery => ({
  primary, secondary, base, style, emblem,
});

export const AIRLINE_TEMPLATES: AirlineTemplate[] = [
  // North America
  { name: 'Aurelia Atlantic', code: 'AU', hq: 'JFK', hubs: ['BOS'], style: 'premium', size: 34, livery: L('#0b2a5b', '#c9a227', 'cheatline', 'star') },
  { name: 'Magnolia Air', code: 'MG', hq: 'ATL', hubs: ['MIA'], style: 'legacy', size: 52, livery: L('#8a1538', '#1d3557', 'eurowhite', 'leaf') },
  { name: 'Lakeshore Airways', code: 'LS', hq: 'ORD', hubs: ['DEN'], style: 'legacy', size: 46, livery: L('#1456a0', '#9fb7d4', 'bellyswoop', 'wing') },
  { name: 'Mesquite Air', code: 'MQ', hq: 'DFW', hubs: ['PHX'], style: 'lowcost', size: 40, livery: L('#f59e0b', '#1f2937', 'solid', 'sun', '#f59e0b') },
  { name: 'Cascadia Pacific', code: 'CP', hq: 'LAX', hubs: ['SEA'], style: 'legacy', size: 42, livery: L('#0f766e', '#134e4a', 'wave', 'wave') },
  { name: 'Maple Crown Air', code: 'MC', hq: 'YYZ', hubs: ['YVR'], style: 'legacy', size: 30, livery: L('#c1121f', '#2b2d42', 'tailband', 'leaf') },

  // Latin America
  { name: 'Quetzal Aéreo', code: 'QZ', hq: 'MEX', hubs: ['CUN'], style: 'lowcost', size: 26, livery: L('#059669', '#facc15', 'wave', 'bird') },
  { name: 'Andes Azul', code: 'AZ', hq: 'BOG', hubs: ['SCL', 'LIM'], style: 'legacy', size: 28, livery: L('#1d4ed8', '#e11d48', 'bellyswoop', 'compass') },
  { name: 'Arara Linhas Aéreas', code: 'AR', hq: 'GRU', hubs: ['BSB'], style: 'legacy', size: 30, livery: L('#16a34a', '#fde047', 'cheatline', 'bird') },

  // Europe
  { name: 'Albion Skyways', code: 'AB', hq: 'LHR', hubs: ['MAN'], style: 'premium', size: 44, livery: L('#1e3a8a', '#b91c1c', 'bellyswoop', 'crown') },
  { name: 'Lumière Air', code: 'LM', hq: 'CDG', style: 'legacy', size: 38, livery: L('#1e40af', '#ef4444', 'tailband', 'star') },
  { name: 'Nordstern Air', code: 'NS', hq: 'FRA', hubs: ['MUC'], style: 'legacy', size: 42, livery: L('#0c1f3f', '#fbbf24', 'eurowhite', 'star') },
  { name: 'Polder Air', code: 'PO', hq: 'AMS', style: 'legacy', size: 28, livery: L('#0ea5e9', '#1e3a8a', 'retro', 'crown') },
  { name: 'Solmar', code: 'SM', hq: 'BCN', hubs: ['PMI', 'AGP'], style: 'lowcost', size: 44, livery: L('#f97316', '#fde68a', 'solid', 'sun', '#fff7ed') },
  { name: 'Liffey Air', code: 'LF', hq: 'DUB', hubs: ['STN'], style: 'lowcost', size: 46, livery: L('#15803d', '#fbbf24', 'tailband', 'bolt') },
  { name: 'Borealis Nordic', code: 'BN', hq: 'ARN', hubs: ['OSL', 'CPH'], style: 'legacy', size: 26, livery: L('#312e81', '#a5b4fc', 'wave', 'compass') },
  { name: 'Bosphorus Crescent', code: 'BC', hq: 'IST', style: 'legacy', size: 44, livery: L('#b91c1c', '#f8fafc', 'bellyswoop', 'bird') },
  { name: 'Zarya Air', code: 'ZR', hq: 'SVO', hubs: ['LED'], style: 'legacy', size: 26, livery: L('#1d4ed8', '#f97316', 'cheatline', 'sun') },
  { name: 'Lusitana Wings', code: 'LW', hq: 'LIS', style: 'regional', size: 14, livery: L('#047857', '#dc2626', 'tailband', 'wing') },

  // Middle East & Africa
  { name: 'Zephyr Gulf', code: 'ZG', hq: 'DXB', style: 'premium', size: 48, livery: L('#7f1d1d', '#d4af37', 'eurowhite', 'wing') },
  { name: 'Pearl Arabian', code: 'PA', hq: 'DOH', style: 'premium', size: 34, livery: L('#581c87', '#cbd5e1', 'tailband', 'star') },
  { name: 'Najd Airways', code: 'NJ', hq: 'RUH', hubs: ['JED'], style: 'legacy', size: 26, livery: L('#166534', '#d4af37', 'cheatline', 'crown') },
  { name: 'Sahara Star', code: 'SS', hq: 'CAI', style: 'legacy', size: 20, livery: L('#0f3d6e', '#eab308', 'cheatline', 'star') },
  { name: 'Baobab Airways', code: 'BB', hq: 'JNB', hubs: ['CPT'], style: 'legacy', size: 20, livery: L('#ea580c', '#14532d', 'wave', 'leaf') },
  { name: 'Kilima Air', code: 'KA', hq: 'NBO', hubs: ['ADD'], style: 'regional', size: 16, livery: L('#b45309', '#0f172a', 'bellyswoop', 'bird') },
  { name: 'Harmattan Air', code: 'HM', hq: 'LOS', hubs: ['ACC'], style: 'regional', size: 12, livery: L('#15803d', '#f8fafc', 'tailband', 'wing') },

  // Asia
  { name: 'Mayur Airways', code: 'MY', hq: 'DEL', hubs: ['BOM', 'BLR'], style: 'lowcost', size: 48, livery: L('#4338ca', '#06b6d4', 'solid', 'bird', '#eef2ff') },
  { name: 'Jade Crane Airlines', code: 'JC', hq: 'PEK', hubs: ['PVG'], style: 'legacy', size: 52, livery: L('#b91c1c', '#facc15', 'cheatline', 'bird') },
  { name: 'Pearl River Air', code: 'PV', hq: 'CAN', hubs: ['SZX'], style: 'legacy', size: 44, livery: L('#0369a1', '#f43f5e', 'bellyswoop', 'wave') },
  { name: 'Lotus Harbour', code: 'LO', hq: 'HKG', style: 'premium', size: 30, livery: L('#0f766e', '#f8fafc', 'eurowhite', 'leaf') },
  { name: 'Sakura Wings', code: 'SW', hq: 'HND', hubs: ['KIX'], style: 'premium', size: 44, livery: L('#be185d', '#1e293b', 'tailband', 'sun') },
  { name: 'Hanbit Air', code: 'HB', hq: 'ICN', style: 'legacy', size: 34, livery: L('#0284c7', '#e11d48', 'wave', 'compass') },
  { name: 'Straits Orchid', code: 'SO', hq: 'SIN', style: 'premium', size: 38, livery: L('#1e3a8a', '#f59e0b', 'bellyswoop', 'leaf') },
  { name: 'Siam Lotus Air', code: 'SL', hq: 'BKK', hubs: ['HKT'], style: 'legacy', size: 30, livery: L('#7e22ce', '#f0abfc', 'wave', 'leaf') },
  { name: 'Komodo Air', code: 'KM', hq: 'CGK', hubs: ['DPS'], style: 'lowcost', size: 40, livery: L('#dc2626', '#fafafa', 'solid', 'bolt', '#fef2f2') },
  { name: 'Tala Air', code: 'TL', hq: 'MNL', hubs: ['CEB'], style: 'lowcost', size: 24, livery: L('#eab308', '#1d4ed8', 'tailband', 'star') },
  { name: 'Lac Viet Air', code: 'LV', hq: 'SGN', hubs: ['HAN'], style: 'lowcost', size: 26, livery: L('#e11d48', '#fbbf24', 'bellyswoop', 'star') },

  // Oceania
  { name: 'Kookaburra Air', code: 'KK', hq: 'SYD', hubs: ['MEL', 'BNE'], style: 'legacy', size: 36, livery: L('#dc2626', '#0f172a', 'tailband', 'bird') },
  { name: 'Aotea Air', code: 'AO', hq: 'AKL', style: 'regional', size: 16, livery: L('#0f172a', '#14b8a6', 'solid', 'leaf', '#0f172a') },
];

export const PLAYER_NAME_IDEAS = [
  'Skyledger Air', 'Meridian Airways', 'Altocumulus', 'Halcyon Air', 'Northwind Airlines', 'Vela Airways',
  'Corvid Air', 'Tessellate Air', 'Parallax Airways', 'Kite & Compass', 'Stratos Line', 'Open Sky Co.',
];
