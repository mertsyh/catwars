import { WARSHIP_SPEED_TILES_PER_TICK } from "../core/constants";
import { DEFAULT_MAP_ID, MAP_REGISTRY } from "../core/maps";
import { positionAlongPath } from "../core/pathfinding";
import type {
  BuildingDTO,
  GameOverMessage,
  InitMessage,
  MapMessage,
  PlayerStateDTO,
  ServerMessage,
  TickMessage,
  TradeShipDTO,
  WarshipDTO,
} from "../core/protocol";
import { hexToRgb, LAND_COLOR, MapRenderer } from "./renderer";
import type { HoverKind } from "./renderer";

const SPAWN_ZOOM = 6;
const DRAG_THRESHOLD = 4;
const ZOOM_IN_FACTOR = 1.15;
const ZOOM_OUT_FACTOR = 1 / 1.15;
const SHIP_SELECT_RADIUS = 1.5;

const statusEl = document.getElementById("status") as HTMLDivElement;
const panelEl = document.getElementById("panel") as HTMLDivElement;
const bannerEl = document.getElementById("banner") as HTMLDivElement;
const canvas = document.getElementById("game") as HTMLCanvasElement;
const cityBtn = document.getElementById("btn-city") as HTMLButtonElement;
const defenseBtn = document.getElementById("btn-defense") as HTMLButtonElement;
const portBtn = document.getElementById("btn-port") as HTMLButtonElement;
const warshipBtn = document.getElementById("btn-warship") as HTMLButtonElement;
const startScreenEl = document.getElementById("startScreen") as HTMLDivElement;
const mapSelectEl = document.getElementById("mapSelect") as HTMLSelectElement;
const startBtnEl = document.getElementById("startBtn") as HTMLButtonElement;

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
let tradeShips = new Map<number, TradeShipDTO>();
let warships = new Map<number, WarshipDTO>();
let selectedWarshipId: number | null = null;
let mapWidth = 0;
let ownerByTile: Int32Array = new Int32Array(0);
let regionOf: Int32Array = new Int32Array(0);
let isBorderTile: Uint8Array = new Uint8Array(0);
let coastalTile: Uint8Array = new Uint8Array(0);
let tilesByRegion: number[][] = [];
let regionNeighbors = new Map<number, number[]>();
let hasCenteredOnSpawn = false;
let armedBuilding: "city" | "defensePost" | "port" | "warship" | null = null;

let ws: WebSocket;

/** Faz 9: harita seçim ekranındaki "Oyuna Katıl" tıklamasıyla tetiklenir — bağlantı önceden açılmaz. */
function startGame(mapId: string): void {
  startScreenEl.style.display = "none";
  statusEl.textContent = "bağlanılıyor...";

  const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${wsProtocol}//${location.host}/ws`);

  ws.addEventListener("open", () => {
    statusEl.textContent = "bağlandı, harita bekleniyor...";
    const name = `Oyuncu-${Math.floor(Math.random() * 1000)}`;
    ws.send(JSON.stringify({ type: "join", name, mapId }));
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
}

for (const entry of MAP_REGISTRY) {
  const option = document.createElement("option");
  option.value = entry.id;
  option.textContent = `${entry.name} (${entry.width}x${entry.height})`;
  if (entry.id === DEFAULT_MAP_ID) option.selected = true;
  mapSelectEl.appendChild(option);
}

startBtnEl.addEventListener("click", () => startGame(mapSelectEl.value));

function handleMap(msg: MapMessage): void {
  mapWidth = msg.width;
  ownerByTile = new Int32Array(msg.width * msg.height).fill(-1);
  regionOf = Int32Array.from(msg.regionOf);
  regionNeighbors = new Map(msg.regions.map((r) => [r.id, r.neighbors]));

  isBorderTile = computeBorderTiles(msg.width, msg.height, regionOf);
  coastalTile = computeCoastalTiles(msg.width, msg.height, msg.terrain);
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

/** Bir kara tile'ının en az bir su komşusu olup olmadığını işaretler (liman yerleşimi için hover/tık doğrulaması). */
function computeCoastalTiles(width: number, height: number, terrain: ArrayLike<number>): Uint8Array {
  const coastal = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (terrain[idx] !== 1) continue;
      const isCoast =
        (x > 0 && terrain[idx - 1] !== 1) ||
        (x < width - 1 && terrain[idx + 1] !== 1) ||
        (y > 0 && terrain[idx - width] !== 1) ||
        (y < height - 1 && terrain[idx + width] !== 1);
      if (isCoast) coastal[idx] = 1;
    }
  }
  return coastal;
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
  tradeShips = new Map(msg.tradeShips.map((s) => [s.id, s]));
  warships = new Map(msg.warships.map((s) => [s.id, s]));
  renderer.setServerTimeSync(msg.tick);
  updateTradeShipRenderer();
  updateWarshipRenderer();

  if (!hasCenteredOnSpawn) {
    centerCameraOnSelf();
    hasCenteredOnSpawn = true;
  }
  statusEl.textContent = "oyuna katıldın — fare tekerleği: zoom, sürükle: kaydır";
}

function handleTick(msg: TickMessage): void {
  updatePlayers(msg.players);
  updateBuildings(msg.buildings);

  for (const change of msg.changes) {
    ownerByTile[change.i] = change.o;
    const player = change.o === -1 ? null : players.get(change.o);
    renderer.setOwnership(change.i, player ? hexToRgb(player.color) : LAND_COLOR);
  }

  for (const ship of msg.spawnedTradeShips) tradeShips.set(ship.id, ship);
  for (const id of msg.arrivedTradeShipIds) tradeShips.delete(id);
  warships = new Map(msg.warships.map((s) => [s.id, s]));
  if (selectedWarshipId !== null && !warships.has(selectedWarshipId)) selectedWarshipId = null;
  renderer.setServerTimeSync(msg.tick);
  updateTradeShipRenderer();
  updateWarshipRenderer();

  renderPanel();
}

function updateTradeShipRenderer(): void {
  renderer.setTradeShips(
    Array.from(tradeShips.values()).map((s) => ({
      id: s.id,
      path: s.path,
      spawnTick: s.spawnTick,
      speedTilesPerTick: s.speedTilesPerTick,
      color: players.get(s.ownerId)?.color ?? "#ffffff",
    })),
  );
}

function updateWarshipRenderer(): void {
  renderer.setWarships(
    Array.from(warships.values()).map((s) => ({
      id: s.id,
      path: s.path,
      pathStartTick: s.pathStartTick,
      speedTilesPerTick: WARSHIP_SPEED_TILES_PER_TICK,
      hp: s.hp,
      maxHp: s.maxHp,
      state: s.state,
      color: players.get(s.ownerId)?.color ?? "#ffffff",
      selected: s.id === selectedWarshipId,
    })),
  );
}

/** Tıklanan dünya koordinatına en yakın, kendi savaş gemimizi bulur (seçim hit-test'i). */
function findOwnWarshipNear(worldX: number, worldY: number): number | null {
  if (selfId === null) return null;
  const estimatedTick = renderer.getEstimatedTick();
  let bestId: number | null = null;
  let bestDistSq = SHIP_SELECT_RADIUS * SHIP_SELECT_RADIUS;

  for (const ship of warships.values()) {
    if (ship.ownerId !== selfId) continue;
    const pos = positionAlongPath(ship.path, mapWidth, ship.pathStartTick, WARSHIP_SPEED_TILES_PER_TICK, estimatedTick);
    const dx = pos.x + 0.5 - worldX;
    const dy = pos.y + 0.5 - worldY;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestId = ship.id;
    }
  }
  return bestId;
}

function findOwnPortAtTile(tileIndex: number): BuildingDTO | null {
  if (selfId === null) return null;
  for (const building of buildings.values()) {
    if (building.tileIndex === tileIndex && building.type === "port" && building.ownerId === selfId) {
      return building;
    }
  }
  return null;
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

/** Bölgede en az bir tile'ımız var mı (bölge artık birden fazla oyuncu arasında bölünebilir — bkz. orantılı parçalı alım). */
function regionHasOwnTile(regionId: number): boolean {
  if (selfId === null) return false;
  return (tilesByRegion[regionId] ?? []).some((idx) => ownerByTile[idx] === selfId);
}

/** Bu bölgeye saldırabilir miyim: ya zaten içinde bir parçam var (devam ettirebilirim) ya da komşu bir bölgede tile'ım var. */
function isRegionAdjacentToSelf(regionId: number): boolean {
  if (selfId === null) return false;
  if (regionHasOwnTile(regionId)) return true;
  const neighbors = regionNeighbors.get(regionId) ?? [];
  return neighbors.some((nid) => regionHasOwnTile(nid));
}

/** Bölgedeki HER tile bize mi ait — artık saldırılacak bir şey kalmadı mı? */
function regionFullyOwnedBySelf(regionId: number): boolean {
  if (selfId === null) return false;
  const tiles = tilesByRegion[regionId] ?? [];
  return tiles.length > 0 && tiles.every((idx) => ownerByTile[idx] === selfId);
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
  if (armedBuilding) {
    const validTile = ownerByTile[tileIndex] === selfId && (armedBuilding !== "port" || coastalTile[tileIndex] === 1);
    kind = validTile ? "self" : "invalid";
  } else if (ownerByTile[tileIndex] === selfId) {
    kind = "self";
  } else {
    kind = isRegionAdjacentToSelf(regionId) ? "valid" : "invalid";
  }

  const borderOfRegion = (tilesByRegion[regionId] ?? []).filter((idx) => isBorderTile[idx] === 1);
  renderer.setHoverRegion(borderOfRegion, kind);
}

function setArmedBuilding(type: "city" | "defensePost" | "port" | "warship" | null): void {
  armedBuilding = type;
  cityBtn.classList.toggle("active", type === "city");
  defenseBtn.classList.toggle("active", type === "defensePost");
  portBtn.classList.toggle("active", type === "port");
  warshipBtn.classList.toggle("active", type === "warship");
}

function setSelectedWarship(id: number | null): void {
  selectedWarshipId = id;
  updateWarshipRenderer();
}

function handleClick(clientX: number, clientY: number): void {
  if (selfId === null) return;
  const tileIndex = renderer.screenToTileIndex(clientX, clientY);
  if (tileIndex === null) return;
  const world = renderer.screenToWorld(clientX, clientY);

  // Bir gemi seçiliyken herhangi bir yere tıklamak, suysa hareket emri verir.
  if (selectedWarshipId !== null) {
    const shipId = selectedWarshipId;
    setSelectedWarship(null);
    if (regionOf[tileIndex] === -1) {
      renderer.addRipple(world.x, world.y, "move");
      ws.send(JSON.stringify({ type: "moveShip", shipId, targetTileIndex: tileIndex }));
    } else {
      renderer.addRipple(world.x, world.y, "invalid");
    }
    return;
  }

  // Kendi gemimize tıklamak (bina/saldırı modunda değilken) onu seçer.
  if (!armedBuilding) {
    const clickedShipId = findOwnWarshipNear(world.x, world.y);
    if (clickedShipId !== null) {
      setSelectedWarship(clickedShipId);
      return;
    }
  }

  const regionId = regionOf[tileIndex];
  if (regionId === -1) return;

  if (armedBuilding === "warship") {
    const port = findOwnPortAtTile(tileIndex);
    if (port) {
      renderer.addRipple(world.x, world.y, "build");
      ws.send(JSON.stringify({ type: "buildWarship", portBuildingId: port.id }));
    } else {
      renderer.addRipple(world.x, world.y, "invalid");
    }
    setArmedBuilding(null);
    return;
  }

  if (armedBuilding) {
    const valid = ownerByTile[tileIndex] === selfId && (armedBuilding !== "port" || coastalTile[tileIndex] === 1);
    if (valid) {
      renderer.addRipple(world.x, world.y, "build");
      ws.send(JSON.stringify({ type: "build", buildingType: armedBuilding, tileIndex }));
    } else {
      renderer.addRipple(world.x, world.y, "invalid");
    }
    setArmedBuilding(null);
    return;
  }

  const looksValid = !regionFullyOwnedBySelf(regionId) && isRegionAdjacentToSelf(regionId);
  renderer.addRipple(world.x, world.y, looksValid ? "attack" : "invalid");
  ws.send(JSON.stringify({ type: "attack", regionId }));
}

cityBtn.addEventListener("click", () => {
  setArmedBuilding(armedBuilding === "city" ? null : "city");
});
defenseBtn.addEventListener("click", () => {
  setArmedBuilding(armedBuilding === "defensePost" ? null : "defensePost");
});
portBtn.addEventListener("click", () => {
  setArmedBuilding(armedBuilding === "port" ? null : "port");
});
warshipBtn.addEventListener("click", () => {
  setArmedBuilding(armedBuilding === "warship" ? null : "warship");
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
  if (selectedWarshipId !== null) {
    setSelectedWarship(null);
    return;
  }
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
