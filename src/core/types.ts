export const Terrain = {
  Water: 0,
  Land: 1,
} as const;

export type TerrainValue = (typeof Terrain)[keyof typeof Terrain];

export const BuildingType = {
  City: "city",
  DefensePost: "defensePost",
  Port: "port",
} as const;

export type BuildingTypeValue = (typeof BuildingType)[keyof typeof BuildingType];

export interface Building {
  id: number;
  type: BuildingTypeValue;
  ownerId: number;
  tileIndex: number;
}

/**
 * İki liman arasında suyun üzerinde mekik dokuyan, varışta her iki liman
 * sahibine altın kazandıran birim. Sunucu tam pozisyonu her tick yaymaz —
 * doğuşta `path` + `spawnTick` + `speedTilesPerTick` bir kere gönderilir,
 * istemci varış anına kadar pozisyonu bundan interpole eder.
 */
export interface TradeShip {
  id: number;
  ownerId: number;
  toOwnerId: number;
  fromPortBuildingId: number;
  toPortBuildingId: number;
  /** Kaynak liman tile'ından hedef liman tile'ına, aradaki su üzerinden BFS ile bulunmuş tam rota. */
  path: number[];
  spawnTick: number;
  speedTilesPerTick: number;
  /** Varışta iki sahibi arasında yarı yarıya paylaşılacak toplam altın. */
  goldValue: number;
}

export const WarshipState = {
  Building: "building",
  Idle: "idle",
  Moving: "moving",
  Returning: "returning",
} as const;

export type WarshipStateValue = (typeof WarshipState)[keyof typeof WarshipState];

/**
 * Oyuncu tarafından yönlendirilen savaş gemisi. `path` + `pathStartTick`,
 * TradeShip ile aynı interpolasyon deseniyle her hareket emrinde yeniden
 * yayınlanır (bkz. `positionAlongPath`); hız `WARSHIP_SPEED_TILES_PER_TICK`
 * sabiti üzerinden hem sunucu hem istemci tarafında ortak hesaplanır.
 */
export interface Warship {
  id: number;
  ownerId: number;
  homePortBuildingId: number;
  hp: number;
  maxHp: number;
  state: WarshipStateValue;
  path: number[];
  pathStartTick: number;
  /** state="building" iken inşanın biteceği tick. */
  buildCompleteTick: number;
}
