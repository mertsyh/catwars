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
  // Kıta bbox'ları gerçek kıyı şeridinin etrafında bolca boşluk bırakır —
  // dar bbox'lar kara kütlesini harita ızgarasının tam kenarına ("flush")
  // kesiyordu, bu da o bölgeye yakınlaşınca kameranın harita dışına taşıp
  // siyah alan göstermesine yol açıyordu (bkz. renderer.ts clampCamera).
  { id: "africa", name: "Afrika", bbox: [-26, -38, 56, 40], width: 410, height: 390 },
  { id: "north-america", name: "Kuzey Amerika", bbox: [-175, 4, -45, 80], width: 430, height: 240 },
  { id: "world", name: "Dünya", bbox: [-180, -58, 180, 83], width: 570, height: 220 },
];

/** Gerçek coğrafya verisi yerine prosedürel dairesel ada üretir (bkz. `GameMap.generateIsland`). */
export const RANDOM_ISLAND_MAP_ID = "random-island";

export const MAP_REGISTRY: MapRegistryEntry[] = [
  ...WORLD_MAP_SPECS.map(({ id, name, width, height }) => ({ id, name, width, height })),
  { id: RANDOM_ISLAND_MAP_ID, name: "Rastgele Ada", width: 400, height: 300 },
];

export const DEFAULT_MAP_ID = "europe";
