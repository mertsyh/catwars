import type {
  BuildingDTO,
  GameOverMessage,
  InitMessage,
  MapMessage,
  PlayerStateDTO,
  ServerMessage,
  SiegeDTO,
  TickMessage,
} from "../core/protocol";
import { hexToRgb, LAND_COLOR, MapRenderer } from "./renderer";
import type { HoverKind } from "./renderer";

const SPAWN_ZOOM = 6;
const DRAG_THRESHOLD = 4;
const ZOOM_IN_FACTOR = 1.15;
const ZOOM_OUT_FACTOR = 1 / 1.15;

const statusEl = document.getElementById("status") as HTMLDivElement;
const panelEl = document.getElementById("panel") as HTMLDivElement;
const bannerEl = document.getElementById("banner") as HTMLDivElement;
const canvas = document.getElementById("game") as HTMLCanvasElement;
const cityBtn = document.getElementById("btn-city") as HTMLButtonElement;
const defenseBtn = document.getElementById("btn-defense") as HTMLButtonElement;

function resize(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

const renderer = new MapRenderer(canvas);
window.addEventListener("resize", resize);
resize();

let selfId: number | null = null;
let players = new Map<number, PlayerStateDTO>();
let buildings = new Map<number, BuildingDTO>();
let mapWidth = 0;
let mapHeight = 0;
let ownerByTile: Int32Array = new Int32Array(0);
let regionOf: Int32Array = new Int32Array(0);
let isBorderTile: Uint8Array = new Uint8Array(0);
let tilesByRegion: number[][] = [];
let regionNeighbors = new Map<number, number[]>();
let regionOwner = new Map<number, number>();
let hasCenteredOnSpawn = false;
let armedBuilding: "city" | "defensePost" | null = null;

const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
const ws = new WebSocket(`${wsProtocol}//${location.host}/ws`);

ws.addEventListener("open", () => {
  statusEl.textContent = "bağlandı, harita bekleniyor...";
  const name = `Oyuncu-${Math.floor(Math.random() * 1000)}`;
  ws.send(JSON.stringify({ type: "join", name }));
});

ws.addEventListener("close", () => {
  statusEl.textContent = "bağlantı koptu";
});

ws.addEventListener("error", () => {
  statusEl.textContent = "bağlantı hatası";
});

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data) as ServerMessage;
  switch (msg.type) {
    case "map":
      handleMap(msg);
      break;
    case "init":
      handleInit(msg);
      break;
    case "tick":
      handleTick(msg);
      break;
    case "gameOver":
      handleGameOver(msg);
      break;
  }
});

function handleMap(msg: MapMessage): void {
  mapWidth = msg.width;
  mapHeight = msg.height;
  ownerByTile = new Int32Array(msg.width * msg.height).fill(-1);
  regionOf = Int32Array.from(msg.regionOf);
  regionNeighbors = new Map(msg.regions.map((r) => [r.id, r.neighbors]));

  isBorderTile = computeBorderTiles(msg.width, msg.height, regionOf);
  tilesByRegion = groupTilesByRegion(regionOf, msg.regions.length);

  renderer.initTerrain(msg.width, msg.height, msg.terrain, isBorderTile);
  renderer.setRegionLabels(msg.regions.map((r) => ({ id: r.id, name: r.name, centerX: r.centerX, centerY: r.centerY })));
  statusEl.textContent = `harita alındı: ${msg.width}x${msg.height}, ${msg.regions.length} bölge`;
}

function computeBorderTiles(width: number, height: number, regionOfTile: Int32Array): Uint8Array {
  const border = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const rid = regionOfTile[idx];
      if (rid === -1) continue;
      const isEdge =
        (x > 0 && regionOfTile[idx - 1] !== rid) ||
        (x < width - 1 && regionOfTile[idx + 1] !== rid) ||
        (y > 0 && regionOfTile[idx - width] !== rid) ||
        (y < height - 1 && regionOfTile[idx + width] !== rid);
      if (isEdge) border[idx] = 1;
    }
  }
  return border;
}

function groupTilesByRegion(regionOfTile: Int32Array, regionCount: number): number[][] {
  const groups: number[][] = Array.from({ length: regionCount }, () => []);
  for (let i = 0; i < regionOfTile.length; i++) {
    const rid = regionOfTile[i];
    if (rid !== -1) groups[rid].push(i);
  }
  return groups;
}

function handleInit(msg: InitMessage): void {
  selfId = msg.selfId;
  updatePlayers(msg.players);
  updateBuildings(msg.buildings);

  for (let i = 0; i < msg.owner.length; i++) {
    ownerByTile[i] = msg.owner[i];
    if (msg.owner[i] !== -1) {
      const player = players.get(msg.owner[i]);
      if (player) renderer.setOwnership(i, hexToRgb(player.color));
    }
  }
  regionOwner = new Map(msg.regionOwners.map((r) => [r.id, r.ownerId]));
  updateSieges(msg.sieges);

  if (!hasCenteredOnSpawn) {
    centerCameraOnSelf();
    hasCenteredOnSpawn = true;
  }
  statusEl.textContent = "oyuna katıldın — fare tekerleği: zoom, sürükle: kaydır";
}

function handleTick(msg: TickMessage): void {
  updatePlayers(msg.players);
  updateBuildings(msg.buildings);
  updateSieges(msg.sieges);

  for (const change of msg.changes) {
    ownerByTile[change.i] = change.o;
    const rid = regionOf[change.i];
    if (rid !== -1) regionOwner.set(rid, change.o);
    const player = change.o === -1 ? null : players.get(change.o);
    renderer.setOwnership(change.i, player ? hexToRgb(player.color) : LAND_COLOR);
  }
  renderPanel();
}

function handleGameOver(msg: GameOverMessage): void {
  bannerEl.textContent = `${msg.winnerName} KAZANDI!`;
  bannerEl.style.display = "flex";
}

function updatePlayers(list: PlayerStateDTO[]): void {
  players = new Map(list.map((p) => [p.id, p]));
  renderPanel();
}

function updateBuildings(list: BuildingDTO[]): void {
  buildings = new Map(list.map((b) => [b.id, b]));
  renderer.setBuildings(
    Array.from(buildings.values()).map((b) => ({ tileIndex: b.tileIndex, type: b.type })),
  );
}

const eatOrderCache = new Map<string, number[]>();

/**
 * Bir bölgenin tile'larını, saldırganın toprağına komşu sınırdan başlayıp
 * BFS ile içeri doğru yayılan sırayla döndürür — kuşatma ilerledikçe
 * "yenilen" alanın saldırgan yönünden içeri doğru büyümesi için.
 */
function computeEatOrder(regionId: number, attackerId: number): number[] {
  const tiles = tilesByRegion[regionId] ?? [];
  if (tiles.length === 0) return [];
  const tileSet = new Set(tiles);

  const neighborsOf = (idx: number): number[] => {
    const x = idx % mapWidth;
    const y = Math.floor(idx / mapWidth);
    const out: number[] = [];
    if (x > 0) out.push(idx - 1);
    if (x < mapWidth - 1) out.push(idx + 1);
    if (y > 0) out.push(idx - mapWidth);
    if (y < mapHeight - 1) out.push(idx + mapWidth);
    return out;
  };

  const frontier: number[] = [];
  for (const idx of tiles) {
    if (!isBorderTile[idx]) continue;
    if (neighborsOf(idx).some((n) => ownerByTile[n] === attackerId)) frontier.push(idx);
  }
  if (frontier.length === 0) frontier.push(tiles[0]);

  const visited = new Set(frontier);
  const order = [...frontier];
  for (let head = 0; head < order.length; head++) {
    for (const n of neighborsOf(order[head])) {
      if (tileSet.has(n) && !visited.has(n)) {
        visited.add(n);
        order.push(n);
      }
    }
  }
  return order;
}

function updateSieges(list: SiegeDTO[]): void {
  const activeKeys = new Set<string>();

  const overlays = list.map((s) => {
    const key = `${s.regionId}:${s.attackerId}`;
    activeKeys.add(key);
    let tiles = eatOrderCache.get(key);
    if (!tiles) {
      tiles = computeEatOrder(s.regionId, s.attackerId);
      eatOrderCache.set(key, tiles);
    }
    const progress = s.maxGarrison > 0 ? Math.min(1, Math.max(0, 1 - s.garrison / s.maxGarrison)) : 0;
    return {
      attackerColor: players.get(s.attackerId)?.color ?? "#ffffff",
      tiles,
      progress,
    };
  });

  for (const key of eatOrderCache.keys()) {
    if (!activeKeys.has(key)) eatOrderCache.delete(key);
  }

  renderer.setSiegeOverlays(overlays);
}

function centerCameraOnSelf(): void {
  if (selfId === null || mapWidth === 0) return;
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let i = 0; i < ownerByTile.length; i++) {
    if (ownerByTile[i] === selfId) {
      sumX += i % mapWidth;
      sumY += Math.floor(i / mapWidth);
      count++;
    }
  }
  if (count === 0) return;
  renderer.centerOn(sumX / count + 0.5, sumY / count + 0.5, SPAWN_ZOOM);
}

function isRegionAdjacentToSelf(regionId: number): boolean {
  if (selfId === null) return false;
  const neighbors = regionNeighbors.get(regionId) ?? [];
  return neighbors.some((nid) => regionOwner.get(nid) === selfId);
}

function renderPanel(): void {
  panelEl.replaceChildren();

  const self = selfId !== null ? players.get(selfId) : undefined;
  if (self) {
    const div = document.createElement("div");
    div.className = "self";
    div.textContent = `${self.name} — Altın: ${self.gold} | Asker: ${self.troops} | Toprak: ${self.tileCount}`;
    panelEl.appendChild(div);
  }

  const others = Array.from(players.values())
    .filter((p) => p.id !== selfId)
    .sort((a, b) => b.tileCount - a.tileCount);

  for (const p of others) {
    const row = document.createElement("div");
    row.className = "row";
    const name = document.createElement("span");
    name.textContent = p.name;
    const count = document.createElement("span");
    count.textContent = String(p.tileCount);
    row.append(name, count);
    panelEl.appendChild(row);
  }
}

function updateHover(clientX: number, clientY: number): void {
  const tileIndex = renderer.screenToTileIndex(clientX, clientY);
  if (tileIndex === null || selfId === null) {
    renderer.setHoverRegion([], "invalid");
    return;
  }
  const regionId = regionOf[tileIndex];
  if (regionId === -1) {
    renderer.setHoverRegion([], "invalid");
    return;
  }

  let kind: HoverKind;
  if (regionOwner.get(regionId) === selfId) {
    kind = "self";
  } else {
    kind = isRegionAdjacentToSelf(regionId) ? "valid" : "invalid";
  }

  const borderOfRegion = (tilesByRegion[regionId] ?? []).filter((idx) => isBorderTile[idx] === 1);
  renderer.setHoverRegion(borderOfRegion, kind);
}

function setArmedBuilding(type: "city" | "defensePost" | null): void {
  armedBuilding = type;
  cityBtn.classList.toggle("active", type === "city");
  defenseBtn.classList.toggle("active", type === "defensePost");
}

function handleClick(clientX: number, clientY: number): void {
  if (selfId === null) return;
  const tileIndex = renderer.screenToTileIndex(clientX, clientY);
  if (tileIndex === null) return;
  const regionId = regionOf[tileIndex];
  if (regionId === -1) return;
  const world = renderer.screenToWorld(clientX, clientY);

  if (armedBuilding) {
    if (regionOwner.get(regionId) === selfId) {
      renderer.addRipple(world.x, world.y, "build");
      ws.send(JSON.stringify({ type: "build", buildingType: armedBuilding, tileIndex }));
    } else {
      renderer.addRipple(world.x, world.y, "invalid");
    }
    setArmedBuilding(null);
    return;
  }

  const looksValid = regionOwner.get(regionId) !== selfId && isRegionAdjacentToSelf(regionId);
  renderer.addRipple(world.x, world.y, looksValid ? "attack" : "invalid");
  ws.send(JSON.stringify({ type: "attack", regionId }));
}

cityBtn.addEventListener("click", () => {
  setArmedBuilding(armedBuilding === "city" ? null : "city");
});
defenseBtn.addEventListener("click", () => {
  setArmedBuilding(armedBuilding === "defensePost" ? null : "defensePost");
});

let dragging = false;
let dragMoved = false;
let downX = 0;
let downY = 0;
let lastMouseX = 0;
let lastMouseY = 0;

canvas.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  dragging = true;
  dragMoved = false;
  downX = lastMouseX = event.clientX;
  downY = lastMouseY = event.clientY;
  canvas.style.cursor = "grabbing";
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (selfId === null) return;
  const world = renderer.screenToWorld(event.clientX, event.clientY);
  renderer.addRipple(world.x, world.y, "cancel");
  ws.send(JSON.stringify({ type: "cancelAttacks" }));
});

window.addEventListener("mousemove", (event) => {
  if (dragging) {
    if (
      !dragMoved &&
      (Math.abs(event.clientX - downX) > DRAG_THRESHOLD || Math.abs(event.clientY - downY) > DRAG_THRESHOLD)
    ) {
      dragMoved = true;
    }
    if (dragMoved) {
      renderer.panBy(event.clientX - lastMouseX, event.clientY - lastMouseY);
    }
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
  } else {
    updateHover(event.clientX, event.clientY);
  }
});

window.addEventListener("mouseup", (event) => {
  if (!dragging) return;
  dragging = false;
  canvas.style.cursor = "grab";
  if (!dragMoved) {
    handleClick(event.clientX, event.clientY);
  }
});

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
    renderer.zoomBy(event.clientX, event.clientY, factor);
  },
  { passive: false },
);
