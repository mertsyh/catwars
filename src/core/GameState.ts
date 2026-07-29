import * as C from "./constants";
import { GameMap } from "./GameMap";
import { findShipRoute, positionAlongPath } from "./pathfinding";
import { Player } from "./Player";
import { generateRegions, Region } from "./regions";
import { Building, BuildingType, BuildingTypeValue, TradeShip, Warship, WarshipState } from "./types";

export interface TileChange {
  index: number;
  ownerId: number;
}

export interface Siege {
  id: number;
  playerId: number;
  regionId: number;
  boost: number;
  /** Bölgenin, kuşatma başladığı andaki "henüz bu saldırganın olmayan" tile'ları, saldırganın sınırından içeri BFS sırasıyla. */
  captureOrder: number[];
  /** captureOrder içinde şu ana kadar ele geçirilmiş tile sayısı. */
  cursor: number;
  /** captureOrder'daki kalan tile'lar için kalan savunma (asker hasarıyla azalır). */
  garrison: number;
  maxGarrison: number;
  /** Kuşatma başlarken donmuş maliyet çarpanı (nötr/düşman) — kuşatma ilerledikçe bölgenin çoğunluk sahibi değişse bile sabit kalır. */
  costMultiplier: number;
}

export interface TickResult {
  changes: TileChange[];
  spawnedTradeShips: TradeShip[];
  arrivedTradeShipIds: number[];
}

export class GameState {
  readonly map: GameMap;
  readonly players = new Map<number, Player>();
  readonly buildings = new Map<number, Building>();
  readonly regions: Region[];
  readonly tradeShips = new Map<number, TradeShip>();
  readonly warships = new Map<number, Warship>();
  tick = 0;
  winnerId: number | null = null;

  private readonly buildingsByTile = new Map<number, Building>();
  private sieges: Siege[] = [];
  private nextPlayerId = 1;
  private nextBuildingId = 1;
  private nextSiegeId = 1;
  private nextTradeShipId = 1;
  private nextWarshipId = 1;
  private tradeShipSpawnTimer = 0;

  constructor(map: GameMap, regionCount: number = C.REGION_COUNT) {
    this.map = map;
    this.regions = generateRegions(map, regionCount);
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

    for (const ship of this.warships.values()) {
      if (ship.ownerId === id) this.warships.delete(ship.id);
    }

    const changes: TileChange[] = [];
    for (const region of this.regions) {
      let touched = false;
      for (const idx of region.tiles) {
        if (this.map.owner[idx] !== id) continue;
        this.map.owner[idx] = -1;
        changes.push({ index: idx, ownerId: -1 });
        touched = true;
      }
      if (touched) this.recomputeRegionOwner(region);
    }
    return changes;
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
    return this.tryBuild(playerId, tileIndex, BuildingType.DefensePost, C.DEFENSE_POST_COST);
  }

  buildPort(playerId: number, tileIndex: number): Building | null {
    if (!this.isCoastalTileIndex(tileIndex)) return null;

    const existingPorts = this.countPorts(playerId);
    const cost = Math.min(C.PORT_COST_CAP, C.PORT_COST_BASE * C.PORT_COST_MULTIPLIER ** existingPorts);
    return this.tryBuild(playerId, tileIndex, BuildingType.Port, cost);
  }

  /** Oyuncunun sahip olduğu, üzerinde henüz bina olmayan bir kıyı tile'ı bulur (bot AI limanı için). */
  getOwnedCoastalTile(playerId: number): number | null {
    for (const region of this.regions) {
      if (!region.isCoastal) continue;
      for (const idx of region.tiles) {
        if (this.map.owner[idx] !== playerId) continue;
        if (this.buildingsByTile.has(idx)) continue;
        if (this.isCoastalTileIndex(idx)) return idx;
      }
    }
    return null;
  }

  buildWarship(playerId: number, portBuildingId: number): Warship | null {
    const port = this.buildings.get(portBuildingId);
    if (!port || port.type !== BuildingType.Port || port.ownerId !== playerId) return null;

    const player = this.players.get(playerId);
    if (!player) return null;

    const existing = this.countWarships(playerId);
    const cost = Math.min(C.WARSHIP_COST_CAP, C.WARSHIP_COST_BASE + C.WARSHIP_COST_INCREMENT * existing);
    if (player.gold < cost) return null;
    player.gold -= cost;

    const ship: Warship = {
      id: this.nextWarshipId++,
      ownerId: playerId,
      homePortBuildingId: portBuildingId,
      hp: C.WARSHIP_MAX_HP,
      maxHp: C.WARSHIP_MAX_HP,
      state: WarshipState.Building,
      path: [port.tileIndex],
      pathStartTick: this.tick,
      buildCompleteTick: this.tick + C.WARSHIP_BUILD_TICKS,
    };
    this.warships.set(ship.id, ship);
    return ship;
  }

  /** Bir savaş gemisini suyun herhangi bir noktasına yönlendirir; rota mevcut (kesirli) pozisyonundan yeniden hesaplanır. */
  moveShip(playerId: number, shipId: number, targetTileIndex: number): boolean {
    const ship = this.warships.get(shipId);
    if (!ship || ship.ownerId !== playerId || ship.state === WarshipState.Building) return false;
    if (targetTileIndex < 0 || targetTileIndex >= this.map.terrain.length) return false;

    const tx = targetTileIndex % this.map.width;
    const ty = Math.floor(targetTileIndex / this.map.width);
    if (this.map.isLand(tx, ty)) return false;

    const pos = positionAlongPath(ship.path, this.map.width, ship.pathStartTick, C.WARSHIP_SPEED_TILES_PER_TICK, this.tick);
    const fromTile = Math.round(pos.y) * this.map.width + Math.round(pos.x);

    const route = findShipRoute(this.map, fromTile, targetTileIndex);
    if (!route) return false;

    ship.path = route;
    ship.pathStartTick = this.tick;
    ship.state = WarshipState.Moving;
    return true;
  }

  private countWarships(playerId: number): number {
    let count = 0;
    for (const ship of this.warships.values()) {
      if (ship.ownerId === playerId) count++;
    }
    return count;
  }

  private isCoastalTileIndex(tileIndex: number): boolean {
    const x = tileIndex % this.map.width;
    const y = Math.floor(tileIndex / this.map.width);
    return this.map.isCoastalTile(x, y);
  }

  private countPorts(playerId: number): number {
    let count = 0;
    for (const building of this.buildings.values()) {
      if (building.type === BuildingType.Port && building.ownerId === playerId) count++;
    }
    return count;
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
    if (this.regionFullyOwnedBy(target, playerId)) return;

    const canReach =
      this.regionHasAnyTileOwnedBy(target, playerId) ||
      Array.from(target.neighbors).some((nid) => {
        const neighbor = this.regions[nid];
        return neighbor !== undefined && this.regionHasAnyTileOwnedBy(neighbor, playerId);
      });
    if (!canReach) return;

    const existing = this.sieges.find((s) => s.playerId === playerId && s.regionId === targetRegionId);
    if (existing) {
      existing.boost = Math.min(C.MAX_BOOST, existing.boost + C.BOOST_STEP);
      return;
    }

    const captureOrder = this.computeCaptureOrder(target, playerId);
    if (captureOrder.length === 0) return;

    const maxGarrison = C.BASE_GARRISON + captureOrder.length * C.GARRISON_PER_TILE + this.regionDefenseBonus(target);
    const costMultiplier = target.ownerId === -1 ? C.NEUTRAL_SIEGE_COST_MULTIPLIER : C.ENEMY_SIEGE_COST_MULTIPLIER;

    this.sieges.push({
      id: this.nextSiegeId++,
      playerId,
      regionId: targetRegionId,
      boost: 1,
      captureOrder,
      cursor: 0,
      garrison: maxGarrison,
      maxGarrison,
      costMultiplier,
    });
  }

  /** Bölgedeki HER tile bu oyuncuya mı ait — kuşatmaya devam etmenin anlamlı olup olmadığını belirler. */
  private regionFullyOwnedBy(region: Region, playerId: number): boolean {
    return region.tiles.every((idx) => this.map.owner[idx] === playerId);
  }

  /** Bölgede bu oyuncuya ait EN AZ bir tile var mı — komşuluk/erişilebilirlik kontrolü için. */
  private regionHasAnyTileOwnedBy(region: Region, playerId: number): boolean {
    return region.tiles.some((idx) => this.map.owner[idx] === playerId);
  }

  /** Bölgedeki mevcut savunma binalarından (Karakol) gelen toplam garrison bonusu — anlık hesaplanır, tile ele geçirilip bina yıkılınca otomatik düşer. */
  private regionDefenseBonus(region: Region): number {
    let bonus = 0;
    for (const idx of region.tiles) {
      if (this.buildingsByTile.get(idx)?.type === BuildingType.DefensePost) bonus += C.DEFENSE_POST_GARRISON_BONUS;
    }
    return bonus;
  }

  /**
   * Bölgenin, saldırgana henüz ait olmayan tile'larını, saldırganın sınırından
   * (kendi tile'larına bitişik olan sınır tile'larından) başlayıp BFS ile içeri
   * doğru yayılan sırayla döndürür. Kuşatma ilerledikçe hasar bu sırayla
   * tile'ları tek tek saldırgana devrediyor (bkz. tickOnce).
   */
  private computeCaptureOrder(region: Region, attackerId: number): number[] {
    const remaining = new Set<number>();
    for (const idx of region.tiles) {
      if (this.map.owner[idx] !== attackerId) remaining.add(idx);
    }

    const frontier: number[] = [];
    for (const idx of remaining) {
      const x = idx % this.map.width;
      const y = Math.floor(idx / this.map.width);
      const touchesAttacker = this.map
        .neighbors(x, y)
        .some(([nx, ny]) => this.map.owner[this.map.index(nx, ny)] === attackerId);
      if (touchesAttacker) frontier.push(idx);
    }
    if (frontier.length === 0) {
      const first = remaining.values().next().value;
      if (first !== undefined) frontier.push(first);
    }

    const visited = new Set(frontier);
    const order = [...frontier];
    for (let head = 0; head < order.length; head++) {
      const idx = order[head];
      const x = idx % this.map.width;
      const y = Math.floor(idx / this.map.width);
      for (const [nx, ny] of this.map.neighbors(x, y)) {
        const nIdx = this.map.index(nx, ny);
        if (remaining.has(nIdx) && !visited.has(nIdx)) {
          visited.add(nIdx);
          order.push(nIdx);
        }
      }
    }
    return order;
  }

  /** Bölgenin tile sahiplik dağılımına bakıp `ownerId`'yi çoğunluk sahibine günceller (kaba bir "kime ait sayılır" göstergesi). */
  private recomputeRegionOwner(region: Region): void {
    const counts = new Map<number, number>();
    for (const idx of region.tiles) {
      const owner = this.map.owner[idx];
      counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }
    let best = -1;
    let bestCount = -1;
    for (const [owner, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        best = owner;
      }
    }
    region.ownerId = best;
  }

  cancelAttacks(playerId: number): void {
    this.sieges = this.sieges.filter((s) => s.playerId !== playerId);
  }

  getActiveSieges(): readonly Siege[] {
    return this.sieges;
  }

  tickOnce(): TickResult {
    this.tick++;
    const changes: TileChange[] = [];
    if (this.winnerId !== null) {
      return { changes, spawnedTradeShips: [], arrivedTradeShipIds: [] };
    }

    for (const player of this.players.values()) {
      player.troops = Math.min(player.maxTroops, player.troops + C.TROOP_REGEN_PER_TICK);
      player.gold += player.tileCount * C.GOLD_PER_TILE_PER_TICK;
    }

    const remainingSieges: Siege[] = [];
    for (const siege of this.sieges) {
      const player = this.players.get(siege.playerId);
      if (!player) continue;
      const region = this.regions[siege.regionId];
      if (!region || siege.cursor >= siege.captureOrder.length) continue;

      const desiredDamage = C.SIEGE_DAMAGE_PER_TICK * siege.boost;
      const damage = Math.min(desiredDamage, player.troops / siege.costMultiplier);

      if (damage <= 0) {
        remainingSieges.push(siege);
        continue;
      }

      player.troops -= damage * siege.costMultiplier;
      siege.garrison = Math.max(0, siege.garrison - damage);

      // Bu tick'e kadar birikmiş hasarın "satın aldığı" tile sayısı — kuşatma
      // askerin harcadığı gücüyle orantılı olarak, tamamlanmayı beklemeden
      // tile tek tek saldırgana geçiyor.
      const targetCursor =
        siege.maxGarrison > 0
          ? Math.min(siege.captureOrder.length, Math.round((1 - siege.garrison / siege.maxGarrison) * siege.captureOrder.length))
          : siege.captureOrder.length;

      for (let i = siege.cursor; i < targetCursor; i++) {
        const idx = siege.captureOrder[i];
        const previousOwnerId = this.map.owner[idx];
        if (previousOwnerId === siege.playerId) continue;

        const defender = previousOwnerId !== -1 ? this.players.get(previousOwnerId) : undefined;
        if (defender) {
          defender.tileCount--;
          defender.troops = Math.max(0, defender.troops - C.CAPTURE_DEFENDER_TROOP_LOSS_RATIO);
        }

        const building = this.buildingsByTile.get(idx);
        if (building) {
          this.buildings.delete(building.id);
          this.buildingsByTile.delete(idx);
          if (defender && building.type === BuildingType.City) defender.cityCount--;
        }

        this.map.owner[idx] = siege.playerId;
        changes.push({ index: idx, ownerId: siege.playerId });
        player.tileCount++;
      }
      siege.cursor = targetCursor;
      this.recomputeRegionOwner(region);

      if (siege.cursor < siege.captureOrder.length) {
        remainingSieges.push(siege);
      }
    }
    this.sieges = remainingSieges;

    const arrivedTradeShipIds = this.advanceTradeShips();

    this.completeWarshipBuilds();
    this.arriveWarships();

    const warshipPositions = new Map<number, { x: number; y: number }>();
    for (const ship of this.warships.values()) {
      if (ship.state === WarshipState.Building) continue;
      warshipPositions.set(
        ship.id,
        positionAlongPath(ship.path, this.map.width, ship.pathStartTick, C.WARSHIP_SPEED_TILES_PER_TICK, this.tick),
      );
    }
    this.resolveNavalCombat(warshipPositions);
    const capturedTradeShipIds = this.captureTradeShips(warshipPositions);

    this.tradeShipSpawnTimer++;
    let spawnedTradeShips: TradeShip[] = [];
    if (this.tradeShipSpawnTimer >= C.TRADE_SHIP_SPAWN_INTERVAL_TICKS) {
      this.tradeShipSpawnTimer = 0;
      spawnedTradeShips = this.trySpawnTradeShips();
    }

    this.checkWinner();
    return { changes, spawnedTradeShips, arrivedTradeShipIds: [...arrivedTradeShipIds, ...capturedTradeShipIds] };
  }

  private trySpawnTradeShips(): TradeShip[] {
    const spawned: TradeShip[] = [];
    const ports = Array.from(this.buildings.values()).filter((b) => b.type === BuildingType.Port);
    if (ports.length < 2) return spawned;

    for (const source of ports) {
      if (this.tradeShips.size + spawned.length >= C.MAX_TRADE_SHIPS) break;

      const candidates = ports.filter((p) => p.id !== source.id);
      const dest = candidates[Math.floor(Math.random() * candidates.length)];
      const path = findShipRoute(this.map, source.tileIndex, dest.tileIndex);
      if (!path) continue;

      const ship: TradeShip = {
        id: this.nextTradeShipId++,
        ownerId: source.ownerId,
        toOwnerId: dest.ownerId,
        fromPortBuildingId: source.id,
        toPortBuildingId: dest.id,
        path,
        spawnTick: this.tick,
        speedTilesPerTick: C.TRADE_SHIP_SPEED_TILES_PER_TICK,
        goldValue: C.TRADE_SHIP_BASE_GOLD + path.length * C.TRADE_SHIP_GOLD_PER_TILE,
      };
      this.tradeShips.set(ship.id, ship);
      spawned.push(ship);
    }
    return spawned;
  }

  private advanceTradeShips(): number[] {
    const arrivedIds: number[] = [];

    for (const ship of this.tradeShips.values()) {
      const traveled = (this.tick - ship.spawnTick) * ship.speedTilesPerTick;
      if (traveled < ship.path.length - 1) continue;

      const halfGold = ship.goldValue / 2;
      if (this.buildings.has(ship.fromPortBuildingId)) {
        const owner = this.players.get(ship.ownerId);
        if (owner) owner.gold += halfGold;
      }
      if (this.buildings.has(ship.toPortBuildingId)) {
        const owner = this.players.get(ship.toOwnerId);
        if (owner) owner.gold += halfGold;
      }
      arrivedIds.push(ship.id);
    }

    for (const id of arrivedIds) this.tradeShips.delete(id);
    return arrivedIds;
  }

  private completeWarshipBuilds(): void {
    for (const ship of this.warships.values()) {
      if (ship.state === WarshipState.Building && this.tick >= ship.buildCompleteTick) {
        ship.state = WarshipState.Idle;
      }
    }
  }

  private arriveWarships(): void {
    for (const ship of this.warships.values()) {
      if (ship.state !== WarshipState.Moving && ship.state !== WarshipState.Returning) continue;

      const traveled = (this.tick - ship.pathStartTick) * C.WARSHIP_SPEED_TILES_PER_TICK;
      if (traveled < ship.path.length - 1) continue;

      if (ship.state === WarshipState.Returning) ship.hp = ship.maxHp;
      ship.path = [ship.path[ship.path.length - 1]];
      ship.pathStartTick = this.tick;
      ship.state = WarshipState.Idle;
    }
  }

  /** Düşman gemi çiftleri menzil içindeyse hasarlaşır; can biterse yok olur, eşik altına düşerse en yakın limana kaçar. */
  private resolveNavalCombat(positions: Map<number, { x: number; y: number }>): void {
    const ships = Array.from(this.warships.values()).filter((s) => s.state !== WarshipState.Building);

    for (let i = 0; i < ships.length; i++) {
      for (let j = i + 1; j < ships.length; j++) {
        const a = ships[i];
        const b = ships[j];
        if (a.ownerId === b.ownerId) continue;

        const pa = positions.get(a.id);
        const pb = positions.get(b.id);
        if (!pa || !pb) continue;

        const dx = pa.x - pb.x;
        const dy = pa.y - pb.y;
        if (dx * dx + dy * dy <= C.WARSHIP_RANGE * C.WARSHIP_RANGE) {
          a.hp -= C.WARSHIP_DAMAGE_PER_TICK;
          b.hp -= C.WARSHIP_DAMAGE_PER_TICK;
        }
      }
    }

    for (const ship of ships) {
      if (ship.hp <= 0) {
        this.warships.delete(ship.id);
        continue;
      }
      if (ship.state !== WarshipState.Returning && ship.hp <= ship.maxHp * C.WARSHIP_RETREAT_HP_FRACTION) {
        this.beginRetreat(ship, positions.get(ship.id));
      }
    }
  }

  private beginRetreat(ship: Warship, pos: { x: number; y: number } | undefined): void {
    if (!pos) return;
    const port = this.nearestOwnPort(ship.ownerId, pos.x, pos.y);
    if (!port) return;

    const fromTile = Math.round(pos.y) * this.map.width + Math.round(pos.x);
    const route = findShipRoute(this.map, fromTile, port.tileIndex);
    if (!route) return;

    ship.path = route;
    ship.pathStartTick = this.tick;
    ship.state = WarshipState.Returning;
  }

  private nearestOwnPort(playerId: number, x: number, y: number): Building | null {
    let best: Building | null = null;
    let bestDistSq = Infinity;
    for (const building of this.buildings.values()) {
      if (building.type !== BuildingType.Port || building.ownerId !== playerId) continue;
      const bx = building.tileIndex % this.map.width;
      const by = Math.floor(building.tileIndex / this.map.width);
      const distSq = (bx - x) ** 2 + (by - y) ** 2;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = building;
      }
    }
    return best;
  }

  /** Düşman savaş gemisinin menziline giren, henüz varmamış ticaret gemilerini yok edip yakalayana bonus altın öder. */
  private captureTradeShips(positions: Map<number, { x: number; y: number }>): number[] {
    const capturedIds: number[] = [];

    for (const trade of this.tradeShips.values()) {
      const traveled = (this.tick - trade.spawnTick) * trade.speedTilesPerTick;
      if (traveled >= trade.path.length - 1) continue;

      const tradePos = positionAlongPath(
        trade.path,
        this.map.width,
        trade.spawnTick,
        trade.speedTilesPerTick,
        this.tick,
      );

      for (const warship of this.warships.values()) {
        if (warship.state === WarshipState.Building) continue;
        if (warship.ownerId === trade.ownerId || warship.ownerId === trade.toOwnerId) continue;

        const pos = positions.get(warship.id);
        if (!pos) continue;

        const dx = pos.x - tradePos.x;
        const dy = pos.y - tradePos.y;
        if (dx * dx + dy * dy <= C.WARSHIP_CAPTURE_RANGE * C.WARSHIP_CAPTURE_RANGE) {
          const captor = this.players.get(warship.ownerId);
          if (captor) captor.gold += C.TRADE_SHIP_CAPTURE_BONUS_GOLD;
          capturedIds.push(trade.id);
          break;
        }
      }
    }

    for (const id of capturedIds) this.tradeShips.delete(id);
    return capturedIds;
  }

  private assignHomeRegion(player: Player): TileChange[] {
    // Yeni oyuncuyu bölünmüş (kısmen ele geçirilmiş) bir savaş bölgesine değil,
    // baştan sona nötr bir bölgeye doğuruyoruz.
    const neutralRegions = this.regions.filter((r) => r.tiles.every((idx) => this.map.owner[idx] === -1));
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
