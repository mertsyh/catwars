import * as C from "./constants";
import { GameMap } from "./GameMap";
import { Player } from "./Player";
import { generateRegions, Region } from "./regions";
import { Building, BuildingType, BuildingTypeValue } from "./types";

export interface TileChange {
  index: number;
  ownerId: number;
}

export interface Siege {
  id: number;
  playerId: number;
  regionId: number;
  boost: number;
}

export class GameState {
  readonly map: GameMap;
  readonly players = new Map<number, Player>();
  readonly buildings = new Map<number, Building>();
  readonly regions: Region[];
  tick = 0;
  winnerId: number | null = null;

  private readonly buildingsByTile = new Map<number, Building>();
  private sieges: Siege[] = [];
  private nextPlayerId = 1;
  private nextBuildingId = 1;
  private nextSiegeId = 1;

  constructor(map: GameMap, regionCount: number = C.REGION_COUNT) {
    this.map = map;
    this.regions = generateRegions(map, regionCount);
    for (const region of this.regions) {
      region.maxGarrison = C.BASE_GARRISON + region.tiles.length * C.GARRISON_PER_TILE;
      region.garrison = region.maxGarrison;
    }
  }

  addPlayer(name: string): { player: Player; changes: TileChange[] } {
    const id = this.nextPlayerId++;
    const color = C.PLAYER_COLORS[(id - 1) % C.PLAYER_COLORS.length];
    const player = new Player({ id, name, color });
    this.players.set(id, player);
    const changes = this.assignHomeRegion(player);
    return { player, changes };
  }

  removePlayer(id: number): TileChange[] {
    this.players.delete(id);
    this.sieges = this.sieges.filter((s) => s.playerId !== id);

    for (const building of this.buildings.values()) {
      if (building.ownerId === id) {
        this.buildings.delete(building.id);
        this.buildingsByTile.delete(building.tileIndex);
      }
    }

    const changes: TileChange[] = [];
    for (const region of this.regions) {
      if (region.ownerId !== id) continue;
      region.ownerId = -1;
      region.garrison = region.maxGarrison * C.NEW_OWNER_GARRISON_FRACTION;
      for (const idx of region.tiles) {
        this.map.owner[idx] = -1;
        changes.push({ index: idx, ownerId: -1 });
      }
    }
    return changes;
  }

  regionAt(tileIndex: number): Region | undefined {
    const rid = this.map.regionOf[tileIndex];
    return rid === -1 ? undefined : this.regions[rid];
  }

  buildCity(playerId: number, tileIndex: number): Building | null {
    const building = this.tryBuild(playerId, tileIndex, BuildingType.City, C.CITY_COST);
    if (building) {
      const player = this.players.get(playerId);
      if (player) player.cityCount++;
    }
    return building;
  }

  buildDefensePost(playerId: number, tileIndex: number): Building | null {
    const building = this.tryBuild(playerId, tileIndex, BuildingType.DefensePost, C.DEFENSE_POST_COST);
    if (building) {
      const region = this.regionAt(tileIndex);
      if (region) {
        region.maxGarrison += C.DEFENSE_POST_GARRISON_BONUS;
        region.garrison += C.DEFENSE_POST_GARRISON_BONUS;
      }
    }
    return building;
  }

  private tryBuild(
    playerId: number,
    tileIndex: number,
    type: BuildingTypeValue,
    cost: number,
  ): Building | null {
    const player = this.players.get(playerId);
    if (!player) return null;

    const { terrain, owner } = this.map;
    if (tileIndex < 0 || tileIndex >= terrain.length) return null;
    if (owner[tileIndex] !== playerId) return null;
    if (this.buildingsByTile.has(tileIndex)) return null;
    if (player.gold < cost) return null;

    player.gold -= cost;

    const building: Building = { id: this.nextBuildingId++, type, ownerId: playerId, tileIndex };
    this.buildings.set(building.id, building);
    this.buildingsByTile.set(tileIndex, building);
    return building;
  }

  queueAttack(playerId: number, targetRegionId: number): void {
    if (this.winnerId !== null) return;
    const player = this.players.get(playerId);
    if (!player) return;

    const target = this.regions[targetRegionId];
    if (!target) return;
    if (target.ownerId === playerId) return;

    const ownsNeighbor = Array.from(target.neighbors).some((nid) => this.regions[nid]?.ownerId === playerId);
    if (!ownsNeighbor) return;

    const existing = this.sieges.find((s) => s.playerId === playerId && s.regionId === targetRegionId);
    if (existing) {
      existing.boost = Math.min(C.MAX_BOOST, existing.boost + C.BOOST_STEP);
      return;
    }

    this.sieges.push({ id: this.nextSiegeId++, playerId, regionId: targetRegionId, boost: 1 });
  }

  cancelAttacks(playerId: number): void {
    this.sieges = this.sieges.filter((s) => s.playerId !== playerId);
  }

  getActiveSieges(): readonly Siege[] {
    return this.sieges;
  }

  tickOnce(): TileChange[] {
    this.tick++;
    const changes: TileChange[] = [];
    if (this.winnerId !== null) return changes;

    for (const player of this.players.values()) {
      player.troops = Math.min(player.maxTroops, player.troops + C.TROOP_REGEN_PER_TICK);
      player.gold += player.tileCount * C.GOLD_PER_TILE_PER_TICK;
    }

    // Regions under active siege don't passively heal — otherwise a slow,
    // troop-starved siege can stall forever exactly at the regen rate.
    const siegedRegionIds = new Set(this.sieges.map((s) => s.regionId));
    for (const region of this.regions) {
      if (siegedRegionIds.has(region.id)) continue;
      if (region.garrison < region.maxGarrison) {
        region.garrison = Math.min(region.maxGarrison, region.garrison + C.GARRISON_REGEN_PER_TICK);
      }
    }

    const remainingSieges: Siege[] = [];
    for (const siege of this.sieges) {
      const player = this.players.get(siege.playerId);
      if (!player) continue;
      const region = this.regions[siege.regionId];
      if (!region || region.ownerId === siege.playerId) continue;

      const costMultiplier = region.ownerId === -1 ? C.NEUTRAL_SIEGE_COST_MULTIPLIER : C.ENEMY_SIEGE_COST_MULTIPLIER;
      const desiredDamage = C.SIEGE_DAMAGE_PER_TICK * siege.boost;
      const damage = Math.min(desiredDamage, player.troops / costMultiplier);

      if (damage <= 0) {
        remainingSieges.push(siege);
        continue;
      }

      player.troops -= damage * costMultiplier;
      region.garrison -= damage;

      if (region.garrison > 0) {
        remainingSieges.push(siege);
        continue;
      }

      const previousOwnerId = region.ownerId;
      const defender = previousOwnerId !== -1 ? this.players.get(previousOwnerId) : undefined;
      if (defender) {
        defender.tileCount -= region.tiles.length;
        defender.troops = Math.max(
          0,
          defender.troops - region.tiles.length * C.CAPTURE_DEFENDER_TROOP_LOSS_RATIO,
        );
      }

      for (const idx of region.tiles) {
        this.map.owner[idx] = siege.playerId;
        changes.push({ index: idx, ownerId: siege.playerId });

        const building = this.buildingsByTile.get(idx);
        if (building) {
          this.buildings.delete(building.id);
          this.buildingsByTile.delete(idx);
          if (defender && building.type === BuildingType.City) defender.cityCount--;
        }
      }

      region.ownerId = siege.playerId;
      region.garrison = region.maxGarrison * C.NEW_OWNER_GARRISON_FRACTION;
      player.tileCount += region.tiles.length;
    }
    this.sieges = remainingSieges;

    this.checkWinner();
    return changes;
  }

  private assignHomeRegion(player: Player): TileChange[] {
    const neutralRegions = this.regions.filter((r) => r.ownerId === -1);
    if (neutralRegions.length === 0) return [];

    const region = neutralRegions[Math.floor(Math.random() * neutralRegions.length)];
    region.ownerId = player.id;

    const changes: TileChange[] = [];
    for (const idx of region.tiles) {
      this.map.owner[idx] = player.id;
      changes.push({ index: idx, ownerId: player.id });
    }
    player.tileCount = region.tiles.length;
    return changes;
  }

  getRandomAdjacentRegion(playerId: number): number | null {
    const candidates: number[] = [];
    for (const region of this.regions) {
      if (region.ownerId !== playerId) continue;
      for (const nid of region.neighbors) {
        if (this.regions[nid]?.ownerId !== playerId) candidates.push(nid);
      }
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  private checkWinner(): void {
    if (this.map.landTileCount === 0) return;
    for (const player of this.players.values()) {
      if (player.tileCount / this.map.landTileCount >= C.WIN_LAND_FRACTION) {
        this.winnerId = player.id;
        return;
      }
    }
  }
}
