import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { GameMap } from "../core/GameMap";
import { GameState, TileChange } from "../core/GameState";
import { TICK_RATE } from "../core/constants";
import { DEFAULT_MAP_ID, MAP_REGISTRY, RANDOM_ISLAND_MAP_ID } from "../core/maps";
import { TradeShip, Warship } from "../core/types";
import type {
  BuildingDTO,
  ClientMessage,
  MapMessage,
  PlayerStateDTO,
  RegionOwnerDTO,
  ServerMessage,
  SiegeDTO,
  TradeShipDTO,
  WarshipDTO,
} from "../core/protocol";

const PORT = Number(process.env.PORT ?? 3000);
const TICK_INTERVAL_MS = 1000 / TICK_RATE;
const BOT_COUNT = 3;
const BOT_DECISION_INTERVAL_MS = 800;
const BOT_PORT_BUILD_CHANCE = 0.05;

interface MapFile {
  width: number;
  height: number;
  terrain: number[];
}

/**
 * `resources/maps/<id>.json`'dan (Faz 8, `scripts/build-map.ts` ile üretilir)
 * gerçek dünya haritasını yükler. Dosya yoksa (ör. `npm run build:maps` hiç
 * çalıştırılmamışsa) placeholder dairesel adaya düşer — geliştirme sırasında
 * kesintisiz çalışmaya devam edebilmek için. `random-island` (Faz 9) hiçbir
 * zaman dosyadan okunmaz, her seferinde rastgele tohumla üretilir.
 */
function loadMapById(mapId: string): GameMap {
  const entry = MAP_REGISTRY.find((m) => m.id === mapId) ?? MAP_REGISTRY.find((m) => m.id === DEFAULT_MAP_ID)!;

  if (entry.id === RANDOM_ISLAND_MAP_ID) {
    return GameMap.generateIsland(entry.width, entry.height, Math.floor(Math.random() * 1_000_000));
  }

  const mapPath = fileURLToPath(new URL(`../../resources/maps/${entry.id}.json`, import.meta.url));
  if (!existsSync(mapPath)) {
    console.warn(`[server] ${mapPath} bulunamadı, placeholder dairesel adaya düşülüyor (npm run build:maps çalıştırın)`);
    return GameMap.generateIsland(entry.width, entry.height, 42);
  }
  const data = JSON.parse(readFileSync(mapPath, "utf-8")) as MapFile;
  return GameMap.fromTerrain(data.width, data.height, data.terrain);
}

interface GameInstance {
  map: GameMap;
  state: GameState;
}

/** Faz 9: harita + oyun, ilk oyuncu katılana kadar kurulmaz — böylece o oyuncunun seçtiği harita geçerli olur. */
let instance: GameInstance | null = null;
const botIds: number[] = [];

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("OpenFrontClone server ayakta\n");
});

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function broadcast(message: ServerMessage): void {
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

function toDTO(state: GameState): PlayerStateDTO[] {
  return Array.from(state.players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    troops: Math.round(p.troops),
    gold: Math.round(p.gold),
    tileCount: p.tileCount,
  }));
}

function toBuildingDTOs(state: GameState): BuildingDTO[] {
  return Array.from(state.buildings.values()).map((b) => ({
    id: b.id,
    type: b.type,
    ownerId: b.ownerId,
    tileIndex: b.tileIndex,
  }));
}

function toSiegeDTOs(state: GameState): SiegeDTO[] {
  return state.getActiveSieges().map((s) => ({
    regionId: s.regionId,
    attackerId: s.playerId,
    garrison: Math.round(s.garrison),
    maxGarrison: Math.round(s.maxGarrison),
  }));
}

function toRegionOwnerDTOs(state: GameState): RegionOwnerDTO[] {
  return state.regions.map((r) => ({ id: r.id, ownerId: r.ownerId }));
}

function toTradeShipDTO(s: TradeShip): TradeShipDTO {
  return {
    id: s.id,
    ownerId: s.ownerId,
    toOwnerId: s.toOwnerId,
    path: s.path,
    spawnTick: s.spawnTick,
    speedTilesPerTick: s.speedTilesPerTick,
    goldValue: s.goldValue,
  };
}

function toWarshipDTOs(state: GameState): WarshipDTO[] {
  return Array.from(state.warships.values()).map((s: Warship) => ({
    id: s.id,
    ownerId: s.ownerId,
    hp: Math.round(s.hp),
    maxHp: s.maxHp,
    state: s.state,
    path: s.path,
    pathStartTick: s.pathStartTick,
  }));
}

function broadcastChanges(state: GameState, changes: TileChange[]): void {
  if (changes.length === 0) return;
  broadcast({
    type: "tick",
    tick: state.tick,
    changes: changes.map((c) => ({ i: c.index, o: c.ownerId })),
    players: toDTO(state),
    buildings: toBuildingDTOs(state),
    sieges: toSiegeDTOs(state),
    spawnedTradeShips: [],
    arrivedTradeShipIds: [],
    warships: toWarshipDTOs(state),
  });
}

function spawnBots(state: GameState): void {
  for (let i = 0; i < BOT_COUNT; i++) {
    const { player, changes } = state.addPlayer(`Bot-${i + 1}`);
    botIds.push(player.id);
    console.log(`[server] bot eklendi: ${player.name} (#${player.id})`);
    broadcastChanges(state, changes);
  }
}

/** Oyunu (harita + GameState + bot'lar) ilk çağrıda kurar, sonrakilerde mevcut örneği döndürür (Faz 9). */
function ensureGame(requestedMapId: string | undefined): GameInstance {
  if (instance) return instance;

  const mapId = requestedMapId && MAP_REGISTRY.some((m) => m.id === requestedMapId) ? requestedMapId : DEFAULT_MAP_ID;
  const map = loadMapById(mapId);
  const state = new GameState(map);
  instance = { map, state };
  console.log(`[server] harita yüklendi: ${mapId} (${map.width}x${map.height})`);
  spawnBots(state);
  return instance;
}

function buildMapMessage(inst: GameInstance): MapMessage {
  return {
    type: "map",
    width: inst.map.width,
    height: inst.map.height,
    terrain: Array.from(inst.map.terrain),
    regionOf: Array.from(inst.map.regionOf),
    regions: inst.state.regions.map((r) => ({
      id: r.id,
      name: r.name,
      centerX: r.centerX,
      centerY: r.centerY,
      neighbors: Array.from(r.neighbors),
    })),
  };
}

const socketPlayerIds = new Map<WebSocket, number>();

wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === "join" && !socketPlayerIds.has(socket)) {
      const { map, state } = ensureGame(message.mapId);
      const name = (message.name ?? "").toString().trim().slice(0, 20) || "Oyuncu";
      const { player, changes } = state.addPlayer(name);
      socketPlayerIds.set(socket, player.id);
      const homeRegion = state.regions.find((r) => r.ownerId === player.id);
      console.log(`[server] katıldı: ${player.name} (#${player.id}) bölge=${homeRegion?.name ?? "-"}`);

      send(socket, buildMapMessage(instance!));
      send(socket, {
        type: "init",
        selfId: player.id,
        tick: state.tick,
        owner: Array.from(map.owner),
        regionOwners: toRegionOwnerDTOs(state),
        players: toDTO(state),
        buildings: toBuildingDTOs(state),
        sieges: toSiegeDTOs(state),
        tradeShips: Array.from(state.tradeShips.values()).map(toTradeShipDTO),
        warships: toWarshipDTOs(state),
      });
      broadcastChanges(state, changes);
      return;
    }

    if (!instance) return;
    const { state } = instance;
    const playerId = socketPlayerIds.get(socket);

    if (message.type === "attack") {
      if (playerId !== undefined && Number.isInteger(message.regionId)) {
        state.queueAttack(playerId, message.regionId);
      }
    }

    if (message.type === "build") {
      if (playerId !== undefined && Number.isInteger(message.tileIndex)) {
        if (message.buildingType === "defensePost") {
          state.buildDefensePost(playerId, message.tileIndex);
        } else if (message.buildingType === "port") {
          state.buildPort(playerId, message.tileIndex);
        } else {
          state.buildCity(playerId, message.tileIndex);
        }
      }
    }

    if (message.type === "cancelAttacks") {
      if (playerId !== undefined) {
        state.cancelAttacks(playerId);
      }
    }

    if (message.type === "buildWarship") {
      if (playerId !== undefined && Number.isInteger(message.portBuildingId)) {
        state.buildWarship(playerId, message.portBuildingId);
      }
    }

    if (message.type === "moveShip") {
      if (playerId !== undefined && Number.isInteger(message.shipId) && Number.isInteger(message.targetTileIndex)) {
        state.moveShip(playerId, message.shipId, message.targetTileIndex);
      }
    }
  });

  socket.on("close", () => {
    const playerId = socketPlayerIds.get(socket);
    if (playerId === undefined || !instance) return;
    socketPlayerIds.delete(socket);
    console.log(`[server] ayrıldı: #${playerId}`);
    const changes = instance.state.removePlayer(playerId);
    broadcastChanges(instance.state, changes);
  });
});

setInterval(() => {
  if (!instance) return;
  const { state } = instance;
  for (const botId of botIds) {
    if (!state.players.has(botId)) continue;
    const targetRegionId = state.getRandomAdjacentRegion(botId);
    if (targetRegionId !== null) {
      state.queueAttack(botId, targetRegionId);
    }

    if (Math.random() < BOT_PORT_BUILD_CHANCE) {
      const coastTile = state.getOwnedCoastalTile(botId);
      if (coastTile !== null) state.buildPort(botId, coastTile);
    }
  }
}, BOT_DECISION_INTERVAL_MS);

setInterval(() => {
  if (!instance) return;
  const { state } = instance;
  if (state.players.size === 0) return;

  const wasUndecided = state.winnerId === null;
  const { changes, spawnedTradeShips, arrivedTradeShipIds } = state.tickOnce();

  broadcast({
    type: "tick",
    tick: state.tick,
    changes: changes.map((c) => ({ i: c.index, o: c.ownerId })),
    players: toDTO(state),
    buildings: toBuildingDTOs(state),
    sieges: toSiegeDTOs(state),
    spawnedTradeShips: spawnedTradeShips.map(toTradeShipDTO),
    arrivedTradeShipIds,
    warships: toWarshipDTOs(state),
  });

  if (wasUndecided && state.winnerId !== null) {
    const winner = state.players.get(state.winnerId);
    if (winner) {
      broadcast({ type: "gameOver", winnerId: winner.id, winnerName: winner.name });
      console.log(`[server] oyun bitti, kazanan: ${winner.name}`);
    }
  }
}, TICK_INTERVAL_MS);

httpServer.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT} üzerinde dinliyor`);
});
