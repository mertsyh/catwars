import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { GameMap } from "../core/GameMap";
import { GameState, TileChange } from "../core/GameState";
import { TICK_RATE } from "../core/constants";
import type {
  BuildingDTO,
  ClientMessage,
  MapMessage,
  PlayerStateDTO,
  RegionOwnerDTO,
  ServerMessage,
  SiegeDTO,
} from "../core/protocol";

const PORT = Number(process.env.PORT ?? 3000);
const MAP_WIDTH = 400;
const MAP_HEIGHT = 300;
const TICK_INTERVAL_MS = 1000 / TICK_RATE;
const BOT_COUNT = 3;
const BOT_DECISION_INTERVAL_MS = 800;

const map = GameMap.generateIsland(MAP_WIDTH, MAP_HEIGHT, 42);
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

function broadcastChanges(changes: TileChange[]): void {
  if (changes.length === 0) return;
  broadcast({
    type: "tick",
    changes: changes.map((c) => ({ i: c.index, o: c.ownerId })),
    players: toDTO(),
    buildings: toBuildingDTOs(),
    sieges: toSiegeDTOs(),
  });
}

for (let i = 0; i < BOT_COUNT; i++) {
  const { player, changes } = gameState.addPlayer(`Bot-${i + 1}`);
  botIds.push(player.id);
  console.log(`[server] bot eklendi: ${player.name} (#${player.id})`);
  broadcastChanges(changes);
}

setInterval(() => {
  for (const botId of botIds) {
    if (!gameState.players.has(botId)) continue;
    const targetRegionId = gameState.getRandomAdjacentRegion(botId);
    if (targetRegionId !== null) {
      gameState.queueAttack(botId, targetRegionId);
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
        owner: Array.from(map.owner),
        regionOwners: toRegionOwnerDTOs(),
        players: toDTO(),
        buildings: toBuildingDTOs(),
        sieges: toSiegeDTOs(),
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
  const changes = gameState.tickOnce();

  broadcast({
    type: "tick",
    changes: changes.map((c) => ({ i: c.index, o: c.ownerId })),
    players: toDTO(),
    buildings: toBuildingDTOs(),
    sieges: toSiegeDTOs(),
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
