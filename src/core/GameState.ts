import * as C from "./constants";
import { GameMap } from "./GameMap";
import { findShipRoute, positionAlongPath } from "./pathfinding";
import { Player } from "./Player";
import { Building, BuildingType, BuildingTypeValue, Terrain, TradeShip, Warship, WarshipState } from "./types";

export interface TileChange {
  index: number;
  ownerId: number;
}

/**
 * Bir saldırganın belirli bir hedefe (nötr toprak=-1 ya da belirli bir düşman
 * oyuncu) karşı süregelen "cephesi". Bölge/anchor-tabanlı sabit bir fetih
 * alanı YOK — her tick, saldırganın o anki sınırından (frontier) hedefin
 * topraklarına dokunan tile'lar taze taze bulunup (bkz. edgeTilesFor) oradan
 * içeri doğru harcanan askerle orantılı tile tile ilerlenir. Aynı hedefe karşı
 * tek bir cephe olur (tekrar tıklamak boost'lar); farklı hedeflere (nötr +
 * birden fazla düşman) karşı eş zamanlı ayrı cepheler açılabilir.
 */
export interface AttackOrder {
  id: number;
  playerId: number;
  /** -1 = nötr toprak, aksi halde belirli bir düşman oyuncu id'si. */
  targetOwnerId: number;
  /** Tıklanan nokta — eşit maliyetli birden fazla tile arasında hangisinin önce alınacağını belirler (o yöne doğru büyüme hissi). */
  focusX: number;
  focusY: number;
  boost: number;
  /** Bu tick'e kadar harcanıp henüz tile'a çevrilmemiş asker (bkz. tileCaptureCost). */
  progress: number;
  /** Hedef nötr mü düşman mı olduğuna göre sabit (bkz. NEUTRAL/ENEMY_SIEGE_COST_MULTIPLIER). */
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
  readonly tradeShips = new Map<number, TradeShip>();
  readonly warships = new Map<number, Warship>();
  tick = 0;
  winnerId: number | null = null;

  private readonly buildingsByTile = new Map<number, Building>();
  private attackOrders: AttackOrder[] = [];
  private nextPlayerId = 1;
  private nextBuildingId = 1;
  private nextOrderId = 1;
  private nextTradeShipId = 1;
  private nextWarshipId = 1;
  private tradeShipSpawnTimer = 0;

  /**
   * Oyuncu başına "sınır" tile'ları (en az bir komşusu kendine ait değil) —
   * bot AI'nin hedef seçimi ve kıyı tile'ı aramasının haritayı taramadan
   * O(sınır uzunluğu) sürede çalışabilmesi için tutulur. Her sahiplik
   * değişikliğinde updateFrontierOnOwnerChange ile O(1) güncellenir.
   * Array + index map, swap-pop ile O(1) ekleme/çıkarma/rastgele-seçim sağlar.
   */
  private frontierTiles = new Map<number, number[]>();
  private frontierIndex = new Map<number, Map<number, number>>();

  constructor(map: GameMap) {
    this.map = map;
  }

  addPlayer(name: string, isBot = false): { player: Player; changes: TileChange[] } {
    const id = this.nextPlayerId++;
    const color = C.PLAYER_COLORS[(id - 1) % C.PLAYER_COLORS.length];
    const startingTroops = isBot ? C.BOT_STARTING_TROOPS : C.PLAYER_STARTING_TROOPS;
    const player = new Player({ id, name, color, startingTroops });
    this.players.set(id, player);
    const changes = this.spawnHome(player);
    return { player, changes };
  }

  removePlayer(id: number): TileChange[] {
    this.players.delete(id);
    this.attackOrders = this.attackOrders.filter((o) => o.playerId !== id && o.targetOwnerId !== id);

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
    for (let idx = 0; idx < this.map.owner.length; idx++) {
      if (this.map.owner[idx] !== id) continue;
      this.map.owner[idx] = -1;
      this.updateFrontierOnOwnerChange(idx, id);
      changes.push({ index: idx, ownerId: -1 });
    }
    this.frontierTiles.delete(id);
    this.frontierIndex.delete(id);
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

  /** Oyuncunun sahip olduğu, üzerinde henüz bina olmayan bir kıyı tile'ı bulur (bot AI limanı için) — sınır tile setinden arar, tüm haritayı taramaz. */
  getOwnedCoastalTile(playerId: number): number | null {
    const frontier = this.frontierTiles.get(playerId);
    if (!frontier) return null;
    for (const idx of frontier) {
      if (this.buildingsByTile.has(idx)) continue;
      if (this.isCoastalTileIndex(idx)) return idx;
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

  /**
   * Tıklanan tile'ın o anki sahibini "hedef" seçer: aynı hedefe karşı zaten
   * aktif bir cephe varsa boost'lar (ve odak noktasını günceller), yoksa —
   * tıklanan tile kendi toprağına bitişikse — yeni bir cephe açar. Cephe
   * tek seferlik bir alan almaz; hedefin o sınırdaki toprağı tükenene ya da
   * iptal edilene kadar her tick otomatik ilerler (bkz. tickOnce).
   */
  queueAttack(playerId: number, targetTile: number): void {
    if (this.winnerId !== null) return;
    const player = this.players.get(playerId);
    if (!player) return;
    if (targetTile < 0 || targetTile >= this.map.terrain.length) return;

    const tx = targetTile % this.map.width;
    const ty = Math.floor(targetTile / this.map.width);
    if (!this.map.isLand(tx, ty)) return;

    const targetOwnerId = this.map.owner[targetTile];
    if (targetOwnerId === playerId) return;

    const existing = this.attackOrders.find((o) => o.playerId === playerId && o.targetOwnerId === targetOwnerId);
    if (existing) {
      existing.boost = Math.min(C.MAX_BOOST, existing.boost + C.BOOST_STEP);
      existing.focusX = tx;
      existing.focusY = ty;
      return;
    }

    const touchesAttacker = this.map
      .neighbors(tx, ty)
      .some(([nx, ny]) => this.map.owner[this.map.index(nx, ny)] === playerId);
    if (!touchesAttacker) return;

    const costMultiplier = targetOwnerId === -1 ? C.NEUTRAL_SIEGE_COST_MULTIPLIER : C.ENEMY_SIEGE_COST_MULTIPLIER;

    this.attackOrders.push({
      id: this.nextOrderId++,
      playerId,
      targetOwnerId,
      focusX: tx,
      focusY: ty,
      boost: 1,
      progress: 0,
      costMultiplier,
    });
  }

  /**
   * Bir tile'ı ele geçirmenin asker maliyeti — sadece üzerinde değil, etki
   * yarıçapı (DEFENSE_POST_RADIUS) içinde saldırgana ait OLMAYAN her Karakol
   * için ek maliyet eklenir (birden fazla karakolun etki alanı çakışıyorsa
   * üst üste biner). Yarıçap dışına asla bakmadığı için maliyeti bina
   * sayısıyla orantılı, harita boyutundan bağımsız kalır.
   */
  private tileCaptureCost(idx: number, attackerId: number): number {
    const x = idx % this.map.width;
    const y = Math.floor(idx / this.map.width);
    let cost = C.CAPTURE_TILE_COST;
    for (const building of this.buildings.values()) {
      if (building.type !== BuildingType.DefensePost || building.ownerId === attackerId) continue;
      const bx = building.tileIndex % this.map.width;
      const by = Math.floor(building.tileIndex / this.map.width);
      const distSq = (bx - x) ** 2 + (by - y) ** 2;
      if (distSq <= C.DEFENSE_POST_RADIUS * C.DEFENSE_POST_RADIUS) cost += C.DEFENSE_POST_GARRISON_BONUS;
    }
    return cost;
  }

  /** Saldırganın o anki sınırından (frontier), hedef sahibine ait olup şu an bitişik olan tile'ların seti — "cephe hattı". */
  private edgeTilesFor(playerId: number, targetOwnerId: number): Set<number> {
    const result = new Set<number>();
    const frontier = this.frontierTiles.get(playerId);
    if (!frontier) return result;

    for (const idx of frontier) {
      const x = idx % this.map.width;
      const y = Math.floor(idx / this.map.width);
      for (const [nx, ny] of this.map.neighbors(x, y)) {
        if (!this.map.isLand(nx, ny)) continue;
        const nIdx = this.map.index(nx, ny);
        if (this.map.owner[nIdx] === targetOwnerId) result.add(nIdx);
      }
    }
    return result;
  }

  /** Cephe hattındaki tile'lar arasından odak noktasına (tıklanan yön) en yakın olanı seçer — büyüme o yöne doğru hissettirsin diye. */
  private pickCaptureTile(edge: Set<number>, focusX: number, focusY: number): number {
    let best = -1;
    let bestDist = Infinity;
    for (const idx of edge) {
      const x = idx % this.map.width;
      const y = Math.floor(idx / this.map.width);
      const dist = (x - focusX) ** 2 + (y - focusY) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = idx;
      }
    }
    return best;
  }

  cancelAttacks(playerId: number): void {
    this.attackOrders = this.attackOrders.filter((o) => o.playerId !== playerId);
  }

  /**
   * İki oyuncu birbirine karşı aynı anda aktif cephe açmışsa (karşılıklı
   * savaş), aradaki cephe hattı tile'larını döndürür — istemci bunları
   * kırmızı vurgulayarak "burada çarpışılıyor" hissi verir.
   */
  computeContestedTiles(): number[] {
    const contested = new Set<number>();
    for (const order of this.attackOrders) {
      const hasReverse = this.attackOrders.some(
        (o) => o.playerId === order.targetOwnerId && o.targetOwnerId === order.playerId,
      );
      if (!hasReverse) continue;
      for (const idx of this.edgeTilesFor(order.playerId, order.targetOwnerId)) contested.add(idx);
    }
    return Array.from(contested);
  }

  tickOnce(): TickResult {
    this.tick++;
    const changes: TileChange[] = [];
    if (this.winnerId !== null) {
      return { changes, spawnedTradeShips: [], arrivedTradeShipIds: [] };
    }

    for (const player of this.players.values()) {
      const regen = C.TROOP_REGEN_PER_TICK + player.cityCount * C.CITY_TROOP_REGEN_BONUS;
      player.troops = Math.min(player.maxTroops, player.troops + regen);
      player.gold += player.tileCount * C.GOLD_PER_TILE_PER_TICK;
    }

    const remainingOrders: AttackOrder[] = [];
    for (const order of this.attackOrders) {
      const player = this.players.get(order.playerId);
      if (!player) continue;

      const edge = this.edgeTilesFor(order.playerId, order.targetOwnerId);
      // Bu cephede artık hedefe ait, saldırgana bitişik hiç tile kalmadıysa
      // (tamamen fethedildi ya da erişim kesildi) cephe kendiliğinden biter.
      if (edge.size === 0) continue;

      const desiredDamage = C.SIEGE_DAMAGE_PER_TICK * order.boost;
      const damage = Math.min(desiredDamage, player.troops / order.costMultiplier);

      if (damage > 0) {
        player.troops -= damage * order.costMultiplier;
        order.progress += damage;

        while (edge.size > 0) {
          const idx = this.pickCaptureTile(edge, order.focusX, order.focusY);
          const cost = this.tileCaptureCost(idx, order.playerId);
          if (order.progress < cost) break;
          order.progress -= cost;
          edge.delete(idx);

          // Karakol etki alanına giren saldırgan, maliyet yavaşlamasının
          // üstüne bir de anlık asker kaybeder ("kalkan vuruyor" hissi).
          if (cost > C.CAPTURE_TILE_COST) {
            player.troops = Math.max(0, player.troops - C.DEFENSE_POST_TROOP_DRAIN);
          }

          const previousOwnerId = this.map.owner[idx];
          const x = idx % this.map.width;
          const y = Math.floor(idx / this.map.width);

          const defender = previousOwnerId !== -1 ? this.players.get(previousOwnerId) : undefined;
          if (defender) {
            defender.tileCount--;
            defender.troops = Math.max(0, defender.troops - C.CAPTURE_DEFENDER_TROOP_LOSS_RATIO);
            defender.addTileCoords(x, y, -1);
          }

          const building = this.buildingsByTile.get(idx);
          if (building) {
            this.buildings.delete(building.id);
            this.buildingsByTile.delete(idx);
            if (defender && building.type === BuildingType.City) defender.cityCount--;
          }

          this.map.owner[idx] = order.playerId;
          player.addTileCoords(x, y, 1);
          this.updateFrontierOnOwnerChange(idx, previousOwnerId);
          changes.push({ index: idx, ownerId: order.playerId });
          player.tileCount++;
        }
      }

      remainingOrders.push(order);
    }
    this.attackOrders = remainingOrders;

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

  /**
   * Yeni oyuncuyu (bot veya insan) haritada rastgele, mümkün olduğunca boş
   * bir noktaya küçük yuvarlak bir toprak parçasıyla (SPAWN_TILE_COUNT hedef
   * tile) doğurur — artık önceden çizilmiş bir bölgeye değil. Birkaç aday
   * nokta denenir, en çok boş komşuluğa sahip olanı seçilir (bkz. pickSpawnTiles).
   */
  private spawnHome(player: Player): TileChange[] {
    const claimed = this.pickSpawnTiles();
    const changes: TileChange[] = [];
    for (const idx of claimed) {
      this.map.owner[idx] = player.id;
      const x = idx % this.map.width;
      const y = Math.floor(idx / this.map.width);
      player.addTileCoords(x, y, 1);
      this.updateFrontierOnOwnerChange(idx, -1);
      changes.push({ index: idx, ownerId: player.id });
    }
    player.tileCount = claimed.length;
    return changes;
  }

  /** Birkaç rastgele nötr kara tile'ı dener, her biri için etraftaki boş alanı (floodUnowned) ölçer, en genişini döndürür. */
  private pickSpawnTiles(): number[] {
    const { terrain, owner } = this.map;
    const n = terrain.length;
    let best: number[] = [];
    const attempts = 60;

    for (let i = 0; i < attempts && best.length < C.SPAWN_TILE_COUNT; i++) {
      const idx = Math.floor(Math.random() * n);
      if (terrain[idx] !== Terrain.Land || owner[idx] !== -1) continue;
      const claim = this.floodUnowned(idx, C.SPAWN_TILE_COUNT);
      if (claim.length > best.length) best = claim;
    }
    return best;
  }

  /** anchor'dan başlayıp, sadece sahipsiz (-1) kara tile'ları üzerinden BFS ile en fazla maxTiles tile toplar. */
  private floodUnowned(anchor: number, maxTiles: number): number[] {
    const result: number[] = [];
    const visited = new Set<number>([anchor]);
    const queue: number[] = [anchor];
    let head = 0;

    while (head < queue.length && result.length < maxTiles) {
      const idx = queue[head++];
      if (this.map.owner[idx] !== -1) continue;
      result.push(idx);

      const x = idx % this.map.width;
      const y = Math.floor(idx / this.map.width);
      for (const [nx, ny] of this.map.neighbors(x, y)) {
        const nIdx = this.map.index(nx, ny);
        if (visited.has(nIdx) || !this.map.isLand(nx, ny)) continue;
        visited.add(nIdx);
        queue.push(nIdx);
      }
    }
    return result;
  }

  /**
   * Bot AI hedef seçimi — sürekli/mantıksız saldırmasınlar diye:
   * 1) Asker `BOT_ATTACK_TROOP_FRACTION`'ın altındaysa hiç yeni cephe açmaz (kritik düşükse
   *    ayrıca sunucu tarafı tüm cephelerini iptal edip dinlenmeye sokar — bkz. server/index.ts).
   * 2) `BOT_MAX_CONCURRENT_ORDERS` hedefe ulaştıysa yeni cephe AÇMAZ.
   * 3) Zaten savaştığı bir hedefi BİR DAHA seçmez — insan oyuncunun bilinçli tekrar tıklaması
   *    gibi boost'lamaz; her cephe kendi temposunda (boost=1) ilerler. Aksi halde bot her karar
   *    turunda (800ms) aynı cepheyi boost'layıp MAX_BOOST'a kilitler, bu da askerini sürekli
   *    sıfıra çeker — "sürekli 0 gözükme" hatasının asıl kök nedeni buydu.
   */
  getBotAttackTarget(playerId: number): number | null {
    const player = this.players.get(playerId);
    if (!player) return null;
    if (player.troops < player.maxTroops * C.BOT_ATTACK_TROOP_FRACTION) return null;

    const frontier = this.frontierTiles.get(playerId);
    if (!frontier || frontier.length === 0) return null;

    const activeTargets = new Set<number>();
    for (const order of this.attackOrders) {
      if (order.playerId === playerId) activeTargets.add(order.targetOwnerId);
    }
    if (activeTargets.size >= C.BOT_MAX_CONCURRENT_ORDERS) return null;

    for (let attempt = 0; attempt < 10; attempt++) {
      const idx = frontier[Math.floor(Math.random() * frontier.length)];
      const x = idx % this.map.width;
      const y = Math.floor(idx / this.map.width);

      for (const [nx, ny] of this.map.neighbors(x, y)) {
        if (!this.map.isLand(nx, ny)) continue;
        const nIdx = this.map.index(nx, ny);
        const owner = this.map.owner[nIdx];
        if (owner === playerId || activeTargets.has(owner)) continue;
        return nIdx;
      }
    }
    return null;
  }

  private frontierArrayFor(playerId: number): number[] {
    let arr = this.frontierTiles.get(playerId);
    if (!arr) {
      arr = [];
      this.frontierTiles.set(playerId, arr);
    }
    return arr;
  }

  private frontierIndexFor(playerId: number): Map<number, number> {
    let idx = this.frontierIndex.get(playerId);
    if (!idx) {
      idx = new Map();
      this.frontierIndex.set(playerId, idx);
    }
    return idx;
  }

  private addFrontier(playerId: number, tileIdx: number): void {
    const idxMap = this.frontierIndexFor(playerId);
    if (idxMap.has(tileIdx)) return;
    const arr = this.frontierArrayFor(playerId);
    idxMap.set(tileIdx, arr.length);
    arr.push(tileIdx);
  }

  private removeFrontier(playerId: number, tileIdx: number): void {
    const idxMap = this.frontierIndex.get(playerId);
    if (!idxMap) return;
    const pos = idxMap.get(tileIdx);
    if (pos === undefined) return;

    const arr = this.frontierTiles.get(playerId);
    if (!arr) return;
    const lastPos = arr.length - 1;
    const lastTile = arr[lastPos];
    arr[pos] = lastTile;
    idxMap.set(lastTile, pos);
    arr.pop();
    idxMap.delete(tileIdx);
  }

  private isFrontierCandidate(idx: number, ownerId: number): boolean {
    const x = idx % this.map.width;
    const y = Math.floor(idx / this.map.width);
    return this.map.neighbors(x, y).some(([nx, ny]) => this.map.owner[this.map.index(nx, ny)] !== ownerId);
  }

  private refreshFrontierTile(idx: number): void {
    const owner = this.map.owner[idx];
    if (owner === -1) return;
    if (this.isFrontierCandidate(idx, owner)) this.addFrontier(owner, idx);
    else this.removeFrontier(owner, idx);
  }

  /** Bir tile'ın sahibi değişince (idx artık map.owner[idx] = yeni sahip) hem kendisinin hem komşularının sınır durumunu günceller. */
  private updateFrontierOnOwnerChange(idx: number, previousOwnerId: number): void {
    const newOwnerId = this.map.owner[idx];
    if (previousOwnerId !== -1 && previousOwnerId !== newOwnerId) {
      this.removeFrontier(previousOwnerId, idx);
    }
    this.refreshFrontierTile(idx);

    const x = idx % this.map.width;
    const y = Math.floor(idx / this.map.width);
    for (const [nx, ny] of this.map.neighbors(x, y)) {
      this.refreshFrontierTile(this.map.index(nx, ny));
    }
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
