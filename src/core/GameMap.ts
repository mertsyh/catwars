import { Terrain } from "./types";

export class GameMap {
  readonly width: number;
  readonly height: number;
  readonly terrain: Uint8Array;
  readonly owner: Int16Array;
  readonly regionOf: Int32Array;
  landTileCount = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.terrain = new Uint8Array(width * height);
    this.owner = new Int16Array(width * height).fill(-1);
    this.regionOf = new Int32Array(width * height).fill(-1);
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  isLand(x: number, y: number): boolean {
    return this.terrain[this.index(x, y)] === Terrain.Land;
  }

  neighbors(x: number, y: number): [number, number][] {
    const result: [number, number][] = [];
    if (x > 0) result.push([x - 1, y]);
    if (x < this.width - 1) result.push([x + 1, y]);
    if (y > 0) result.push([x, y - 1]);
    if (y < this.height - 1) result.push([x, y + 1]);
    return result;
  }

  /**
   * Placeholder harita üreticisi: gerçek dünya haritası pipeline'ı (Faz 1)
   * gelene kadar dairemsi bir ada üretir, sadece uçtan uca akışı doğrulamak için.
   */
  static generateIsland(width: number, height: number, seed = 1): GameMap {
    const map = new GameMap(width, height);
    const cx = width / 2;
    const cy = height / 2;
    const maxRadius = Math.min(width, height) * 0.42;

    let state = seed;
    const nextRandom = (): number => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const wobble = (nextRandom() - 0.5) * maxRadius * 0.35;
        const isLand = dist + wobble < maxRadius;
        map.terrain[map.index(x, y)] = isLand ? Terrain.Land : Terrain.Water;
      }
    }

    let landCount = 0;
    for (let i = 0; i < map.terrain.length; i++) {
      if (map.terrain[i] === Terrain.Land) landCount++;
    }
    map.landTileCount = landCount;

    return map;
  }
}
