import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { GameMap } from "../core/GameMap";
import { GameState, TileChange } from "../core/GameState";
import { TICK_RATE } from "../core/constants";
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

interface MapFile {
  width: number;
  height: number;
  terrain: number[];
}

/**
 * `resources/maps/<id>.json`'dan (Faz 8, `scripts/build-map.ts` ile üretilir)
 * gerçek dünya haritasını yükler. Dosya yoksa (ör. `npm run build:maps` hiç
 * çalıştırılmamışsa) placeholder dairesel adaya düşer — geliştirme sırasında
 * kesintisiz çalışmaya devam edebilmek için.
 */
function loadMap(): GameMap {
  const mapPath = fileURLToPath(new URL("../../resources/maps/europe.json", import.meta.url));
  if (!existsSync(mapPath)) {
    console.warn(`[server] ${mapPath} bulunamadı, placeholder dairesel adaya düşülüyor (npm run build:maps çalıştırın)`);
    return GameMap.generateIsland(400, 300, 42);
  }
  const data = JSON.parse(readFileSync(mapPath, "utf-8")) as MapFile;
  return GameMap.fromTerrain(data.width, data.height, data.terrain);
}

const map = loadMap();
const gameState = new GameState(map);
const socketPlayerIds = new Map<WebSocket, number>();
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

function toDTO(): PlayerStateDTO[] {
  return Array.from(gameState.players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    troops: Math.round(p.troops),
    gold: Math.round(p.gold),
    tileCount: p.tileCount,
  }));
}

function toBuildingDTOs(): BuildingDTO[] {
  return Array.from(gameState.buildings.values()).map((b) => ({
    id: b.id,
    type: b.type,
    ownerId: b.ownerId,
    tileIndex: b.tileIndex,
  }));
}

function toSiegeDTOs(): SiegeDTO[] {
  return gameState.getActiveSieges().map((s) => {
    const region = gameState.regions[s.regionId];
    return {
      regionId: s.regionId,
      attackerId: s.playerId,
      garrison: Math.round(region.garrison),
      maxGarrison: Math.round(region.maxGarrison),
    };
  });
}

function toRegionOwnerDTOs(): RegionOwnerDTO[] {
  return gameState.regions.map((r) => ({ id: r.id, ownerId: r.ownerId }));
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

function toWarshipDTOs(): WarshipDTO[] {
  return Array.from(gameState.warships.values()).map((s: Warship) => ({
    id: s.id,
    ownerId: s.ownerId,
    hp: Math.round(s.hp),
    maxHp: s.maxHp,
    state: s.state,
    path: s.path,
    pathStartTick: s.pathStartTick,
  }));
}

function broadcastChanges(changes: TileChange[]): void {
  if (changes.length === 0) return;
  broadcast({
    type: "tick",
    tick: gameState.tick,
    changes: changes.map((c) => ({ i: c.index, o: c.ownerId })),
    players: toDTO(),
    buildings: toBuildingDTOs(),
    sieges: toSiegeDTOs(),
    spawnedTradeShips: [],
    arrivedTradeShipIds: [],
    warships: toWarshipDTOs(),
  });
}

for (let i = 0; i < BOT_COUNT; i++) {
  const { player, changes } = gameState.addPlayer(`Bot-${i + 1}`);
  botIds.push(player.id);
  console.log(`[server] bot eklendi: ${player.name} (#${player.id})`);
  broadcastChanges(changes);
}

const BOT_PORT_BUILD_CHANCE = 0.05;

setInterval(() => {
  for (const botId of botIds) {
    if (!gameState.players.has(botId)) continue;
    const targetRegionId = gameState.getRandomAdjacentRegion(botId);
    if (targetRegionId !== null) {
      gameState.queueAttack(botId, targetRegionId);
    }

    if (Math.random() < BOT_PORT_BUILD_CHANCE) {
      const coastTile = gameState.getOwnedCoastalTile(botId);
      if (coastTile !== null) gameState.buildPort(botId, coastTile);
    }
  }
}, BOT_DECISION_INTERVAL_MS);

wss.on("connection", (socket) => {
  const mapMessage: MapMessage = {
    type: "map",
    width: map.width,
    height: map.height,
    terrain: Array.from(map.terrain),
    regionOf: Array.from(map.regionOf),
    regions: gameState.regions.map((r) => ({
      id: r.id,
      name: r.name,
      centerX: r.centerX,
      centerY: r.centerY,
      neighbors: Array.from(r.neighbors),
    })),
  };
  send(socket, mapMessage);

  socket.on("message", (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === "join" && !socketPlayerIds.has(socket)) {
      const name = (message.name ?? "").toString().trim().slice(0, 20) || "Oyuncu";
      const { player, changes } = gameState.addPlayer(name);
      socketPlayerIds.set(socket, player.id);
      const homeRegion = gameState.regions.find((r) => r.ownerId === player.id);
      console.log(`[server] katıldı: ${player.name} (#${player.id}) bölge=${homeRegion?.name ?? "-"}`);

      send(socket, {
        type: "init",
        selfId: player.id,
        tick: gameState.tick,
        owner: Array.from(map.owner),
        regionOwners: toRegionOwnerDTOs(),
        players: toDTO(),
        buildings: toBuildingDTOs(),
        sieges: toSiegeDTOs(),
        tradeShips: Array.from(gameState.tradeShips.values()).map(toTradeShipDTO),
        warships: toWarshipDTOs(),
      });
      broadcastChanges(changes);
      return;
    }

    if (message.type === "attack") {
      const playerId = socketPlayerIds.get(socket);
      if (playerId !== undefined && Number.isInteger(message.regionId)) {
        gameState.queueAttack(playerId, message.regionId);
      }
    }

    if (message.type === "build") {
      const playerId = socketPlayerIds.get(socket);
      if (playerId !== undefined && Number.isInteger(message.tileIndex)) {
        if (message.buildingType === "defensePost") {
          gameState.buildDefensePost(playerId, message.tileIndex);
        } else if (message.buildingType === "port") {
          gameState.buildPort(playerId, message.tileIndex);
        } else {
          gameState.buildCity(playerId, message.tileIndex);
        }
      }
    }

    if (message.type === "cancelAttacks") {
      const playerId = socketPlayerIds.get(socket);
      if (playerId !== undefined) {
        gameState.cancelAttacks(playerId);
      }
    }

    if (message.type === "buildWarship") {
      const playerId = socketPlayerIds.get(socket);
      if (playerId !== undefined && Number.isInteger(message.portBuildingId)) {
        gameState.buildWarship(playerId, message.portBuildingId);
      }
    }

    if (message.type === "moveShip") {
      const playerId = socketPlayerIds.get(socket);
      if (playerId !== undefined && Number.isInteger(message.shipId) && Number.isInteger(message.targetTileIndex)) {
        gameState.moveShip(playerId, message.shipId, message.targetTileIndex);
      }
    }
  });

  socket.on("close", () => {
    const playerId = socketPlayerIds.get(socket);
    if (playerId === undefined) return;
    socketPlayerIds.delete(socket);
    console.log(`[server] ayrıldı: #${playerId}`);
    const changes = gameState.removePlayer(playerId);
    broadcastChanges(changes);
  });
});

setInterval(() => {
  if (gameState.players.size === 0) return;

  const wasUndecided = gameState.winnerId === null;
  const { changes, spawnedTradeShips, arrivedTradeShipIds } = gameState.tickOnce();

  broadcast({
    type: "tick",
    tick: gameState.tick,
    changes: changes.map((c) => ({ i: c.index, o: c.ownerId })),
    players: toDTO(),
    buildings: toBuildingDTOs(),
    sieges: toSiegeDTOs(),
    spawnedTradeShips: spawnedTradeShips.map(toTradeShipDTO),
    arrivedTradeShipIds,
    warships: toWarshipDTOs(),
  });

  if (wasUndecided && gameState.winnerId !== null) {
    const winner = gameState.players.get(gameState.winnerId);
    if (winner) {
      broadcast({ type: "gameOver", winnerId: winner.id, winnerName: winner.name });
      console.log(`[server] oyun bitti, kazanan: ${winner.name}`);
    }
  }
}, TICK_INTERVAL_MS);

httpServer.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT} üzerinde dinliyor`);
});
