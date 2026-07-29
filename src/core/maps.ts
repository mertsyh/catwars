export interface MapRegistryEntry {
  id: string;
  name: string;
  width: number;
  height: number;
}

/**
 * Gerçek dünya haritaları (Faz 8 pipeline'ıyla üretilir). `bbox` sadece
 * build-time'da (`scripts/build-map.ts`) kullanılır, runtime'da gerekmez —
 * yine de tek kaynak (`MAP_REGISTRY`in temeli) burası olsun diye burada tutulur.
 */
export interface WorldMapSpec extends MapRegistryEntry {
  /** [minLon, minLat, maxLon, maxLat] */
  bbox: [number, number, number, number];
}

export const WORLD_MAP_SPECS: WorldMapSpec[] = [
  { id: "europe", name: "Avrupa", bbox: [-25, 34, 45, 72], width: 400, height: 300 },
  { id: "africa", name: "Afrika", bbox: [-20, -35, 52, 38], width: 380, height: 420 },
  { id: "north-america", name: "Kuzey Amerika", bbox: [-170, 5, -50, 75], width: 420, height: 300 },
];

/** Gerçek coğrafya verisi yerine prosedürel dairesel ada üretir (bkz. `GameMap.generateIsland`). */
export const RANDOM_ISLAND_MAP_ID = "random-island";

export const MAP_REGISTRY: MapRegistryEntry[] = [
  ...WORLD_MAP_SPECS.map(({ id, name, width, height }) => ({ id, name, width, height })),
  { id: RANDOM_ISLAND_MAP_ID, name: "Rastgele Ada", width: 400, height: 300 },
];

export const DEFAULT_MAP_ID = "europe";
