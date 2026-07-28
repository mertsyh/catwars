import { CIVILIZATION_NAMES } from "./civilizationNames";
import { GameMap } from "./GameMap";
import { Terrain } from "./types";

export interface Region {
  id: number;
  name: string;
  tiles: number[];
  neighbors: Set<number>;
  centerX: number;
  centerY: number;
  ownerId: number;
  garrison: number;
  maxGarrison: number;
  /** En az bir tile'ı suya bitişikse true — liman inşasına uygun bölgeleri bulmak için (bot AI). */
  isCoastal: boolean;
}

/**
 * Haritayı, hepsi kabaca aynı büyüklükte olacak şekilde rastgele "ülke"
 * bölgelerine ayırır (basit Voronoi bölütleme): önce iyi dağılmış tohum
 * noktaları seçilir, sonra her kara karesi en yakın tohuma atanır.
 */
export function generateRegions(map: GameMap, count: number): Region[] {
  const { width, height, terrain, landTileCount } = map;
  if (landTileCount === 0 || count <= 0) return [];

  const seeds: { x: number; y: number }[] = [];
  const minDistSq = (landTileCount / count) * 0.6;

  let attempts = 0;
  while (seeds.length < count && attempts < count * 300) {
    attempts++;
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    if (terrain[map.index(x, y)] !== Terrain.Land) continue;
    const tooClose = seeds.some((s) => (s.x - x) ** 2 + (s.y - y) ** 2 < minDistSq);
    if (tooClose) continue;
    seeds.push({ x, y });
  }
  while (seeds.length < count) {
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    if (terrain[map.index(x, y)] === Terrain.Land) seeds.push({ x, y });
  }

  const regionCount = seeds.length;
  const { regionOf } = map;

  // A couple of Lloyd relaxation passes (re-seed at each cell's centroid and
  // re-assign) even out the wildly uneven slivers a raw Voronoi split leaves
  // near the coastline, so regions end up closer to equal size.
  for (let pass = 0; pass < 3; pass++) {
    assignToNearestSeed(map, seeds, regionOf);
    if (pass < 2) recenterSeeds(map, seeds, regionOf);
  }

  const names = shuffle([...CIVILIZATION_NAMES]).slice(0, regionCount);
  while (names.length < regionCount) {
    names.push(`Bölge ${names.length + 1}`);
  }

  const regions: Region[] = Array.from({ length: regionCount }, (_, id) => ({
    id,
    name: names[id],
    tiles: [],
    neighbors: new Set<number>(),
    centerX: 0,
    centerY: 0,
    ownerId: -1,
    garrison: 0,
    maxGarrison: 0,
    isCoastal: false,
  }));

  const sumX = new Float64Array(regionCount);
  const sumY = new Float64Array(regionCount);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = map.index(x, y);
      const rid = regionOf[idx];
      if (rid === -1) continue;

      regions[rid].tiles.push(idx);
      sumX[rid] += x;
      sumY[rid] += y;

      for (const [nx, ny] of map.neighbors(x, y)) {
        const nIdx = map.index(nx, ny);
        if (terrain[nIdx] !== Terrain.Land) {
          regions[rid].isCoastal = true;
          continue;
        }
        const nRid = regionOf[nIdx];
        if (nRid !== -1 && nRid !== rid) {
          regions[rid].neighbors.add(nRid);
        }
      }
    }
  }

  for (const region of regions) {
    if (region.tiles.length > 0) {
      region.centerX = sumX[region.id] / region.tiles.length;
      region.centerY = sumY[region.id] / region.tiles.length;
    }
  }

  return regions;
}

function assignToNearestSeed(
  map: GameMap,
  seeds: { x: number; y: number }[],
  regionOf: Int32Array,
): void {
  const { width, height, terrain } = map;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = map.index(x, y);
      if (terrain[idx] !== Terrain.Land) continue;

      let best = 0;
      let bestDist = Infinity;
      for (let s = 0; s < seeds.length; s++) {
        const dx = seeds[s].x - x;
        const dy = seeds[s].y - y;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          best = s;
        }
      }
      regionOf[idx] = best;
    }
  }
}

function recenterSeeds(map: GameMap, seeds: { x: number; y: number }[], regionOf: Int32Array): void {
  const { width, height } = map;
  const sumX = new Float64Array(seeds.length);
  const sumY = new Float64Array(seeds.length);
  const count = new Float64Array(seeds.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rid = regionOf[map.index(x, y)];
      if (rid === -1) continue;
      sumX[rid] += x;
      sumY[rid] += y;
      count[rid]++;
    }
  }

  for (let s = 0; s < seeds.length; s++) {
    if (count[s] > 0) {
      seeds[s].x = Math.round(sumX[s] / count[s]);
      seeds[s].y = Math.round(sumY[s] / count[s]);
    }
  }
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
