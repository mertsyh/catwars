import { GameMap } from "./GameMap";

/**
 * İki tile arasında (kara veya su, herhangi bir kombinasyon) su üzerinden en
 * kısa rotayı bulur. Uçlardan biri karaysa (ör. liman) önce bitişik bir su
 * tile'ına atlanır, rotanın başına/sonuna orijinal kara tile eklenir — böylece
 * hem "liman → liman" (ticaret gemisi) hem "açık deniz → liman" (savaş gemisi
 * limana dönüşü) hem "açık deniz → açık deniz" (savaş gemisi manevrası) aynı
 * fonksiyonla çözülür. Aralarında su bağlantısı yoksa (ayrık deniz/göl) null
 * döner.
 */
export function findShipRoute(map: GameMap, fromTile: number, toTile: number): number[] | null {
  const from = resolveWaterEndpoint(map, fromTile);
  const to = resolveWaterEndpoint(map, toTile);
  if (!from || !to) return null;

  const waterPath = bfsWater(map, from.water, to.water);
  if (!waterPath) return null;

  const withStart = from.isLand ? [fromTile, ...waterPath] : waterPath;
  return to.isLand ? [...withStart, toTile] : withStart;
}

/**
 * Bir path (tile-index dizisi) üzerinde, doğuş tick'i + hıza göre şu anki
 * kesirli (x, y) pozisyonunu hesaplar. Sunucu (çarpışma/yakalama menzil
 * kontrolü) ve istemci (render interpolasyonu) aynı fonksiyonu kullanır.
 */
export function positionAlongPath(
  path: number[],
  mapWidth: number,
  pathStartTick: number,
  speedTilesPerTick: number,
  currentTick: number,
): { x: number; y: number } {
  const maxIndex = path.length - 1;
  if (maxIndex <= 0) {
    const tile = path[0] ?? 0;
    return { x: tile % mapWidth, y: Math.floor(tile / mapWidth) };
  }

  const traveled = Math.max(0, (currentTick - pathStartTick) * speedTilesPerTick);
  const clamped = Math.min(traveled, maxIndex);
  const i0 = Math.floor(clamped);
  const i1 = Math.min(maxIndex, i0 + 1);
  const frac = clamped - i0;

  const x0 = path[i0] % mapWidth;
  const y0 = Math.floor(path[i0] / mapWidth);
  const x1 = path[i1] % mapWidth;
  const y1 = Math.floor(path[i1] / mapWidth);
  return { x: x0 + (x1 - x0) * frac, y: y0 + (y1 - y0) * frac };
}

function resolveWaterEndpoint(map: GameMap, tile: number): { water: number; isLand: boolean } | null {
  const x = tile % map.width;
  const y = Math.floor(tile / map.width);
  if (!map.isLand(x, y)) return { water: tile, isLand: false };
  const water = map.adjacentWaterTile(x, y);
  return water === null ? null : { water, isLand: true };
}

function bfsWater(map: GameMap, fromWater: number, toWater: number): number[] | null {
  if (fromWater === toWater) return [fromWater];

  const { width } = map;
  const visited = new Uint8Array(map.terrain.length);
  const prev = new Int32Array(map.terrain.length).fill(-1);
  visited[fromWater] = 1;
  const queue: number[] = [fromWater];

  let found = false;
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (cur === toWater) {
      found = true;
      break;
    }
    const x = cur % width;
    const y = Math.floor(cur / width);
    for (const [nx, ny] of map.neighbors(x, y)) {
      if (map.isLand(nx, ny)) continue;
      const nIdx = map.index(nx, ny);
      if (visited[nIdx]) continue;
      visited[nIdx] = 1;
      prev[nIdx] = cur;
      queue.push(nIdx);
    }
  }
  if (!found) return null;

  const path: number[] = [];
  for (let cur = toWater; cur !== -1; cur = prev[cur]) path.push(cur);
  path.reverse();
  return path;
}
