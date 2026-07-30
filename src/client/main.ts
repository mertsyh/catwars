import { MAX_BOT_COUNT, WARSHIP_SPEED_TILES_PER_TICK } from "../core/constants";
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

const SPAWN_ZOOM = 8;
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
const botCountEl = document.getElementById("botCount") as HTMLInputElement;
const startBtnEl = document.getElementById("startBtn") as HTMLButtonElement;

/** Windows/Retina gibi ölçeklendirilmiş ekranlarda canvas'ın bulanık görünmemesi için
 *  çizim yüzeyi devicePixelRatio ile büyütülür, CSS boyutu ise mantıksal (CSS) piksel
 *  cinsinden sabit tutulur (3x+ ekranlarda aşırı büyümeyi önlemek için dpr 2 ile sınırlanır). */
function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
}

/** Fare olaylarının clientX/clientY'si (CSS piksel) canvas'ın çizim uzayına (device piksel) çevrilir. */
function toCanvasCoords(clientX: number, clientY: number): { x: number; y: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return { x: clientX * dpr, y: clientY * dpr };
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
let mapHeight = 0;
let terrain: Uint8Array = new Uint8Array(0);
let ownerByTile: Int32Array = new Int32Array(0);
let coastalTile: Uint8Array = new Uint8Array(0);
/** Kendi toprağımızın sınır tile'ları (bkz. updateBorderFlag) — isTileAttackable'ın, tıklanan tile'ın
 *  bize tam bitişik olup olmadığına değil, hedef sahibinin toprağı bana HERHANGİ bir noktada değiyor mu'ya
 *  bakabilmesi için tutulur; taramayı tüm haritaya değil kendi sınır uzunluğuma indirger. */
let selfBorderTiles = new Set<number>();
let hasCenteredOnSpawn = false;
let armedBuilding: "city" | "defensePost" | "port" | "warship" | null = null;
let leaderboardCollapsed = false;
/** Panel üzerinde fare basılıyken renderPanel() rebuild'ini duraklatır (bkz. renderPanel yorumu). */
let panelPointerDown = false;

const LEADERBOARD_SIZE = 10;

let ws: WebSocket;

/** Harita seçim ekranındaki "Oyuna Katıl" tıklamasıyla tetiklenir — bağlantı önceden açılmaz. */
function startGame(mapId: string, botCount: number): void {
  startScreenEl.style.display = "none";
  statusEl.textContent = "bağlanılıyor...";

  const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${wsProtocol}//${location.host}/ws`);

  ws.addEventListener("open", () => {
    statusEl.textContent = "bağlandı, harita bekleniyor...";
    const name = `Oyuncu-${Math.floor(Math.random() * 1000)}`;
    ws.send(JSON.stringify({ type: "join", name, mapId, botCount }));
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

botCountEl.max = String(MAX_BOT_COUNT);

startBtnEl.addEventListener("click", () => {
  const botCount = Math.max(0, Math.min(MAX_BOT_COUNT, Number(botCountEl.value) || 0));
  startGame(mapSelectEl.value, botCount);
});

function handleMap(msg: MapMessage): void {
  mapWidth = msg.width;
  mapHeight = msg.height;
  terrain = Uint8Array.from(msg.terrain);
  ownerByTile = new Int32Array(msg.width * msg.height).fill(-1);
  coastalTile = computeCoastalTiles(msg.width, msg.height, msg.terrain);
  selfBorderTiles = new Set();

  renderer.initTerrain(msg.width, msg.height, msg.terrain);
  statusEl.textContent = `harita alındı: ${msg.width}x${msg.height}`;
}

/** Bir kara tile'ının en az bir su komşusu olup olmadığını işaretler (liman yerleşimi için hover/tık doğrulaması). */
function computeCoastalTiles(width: number, height: number, terrainSrc: ArrayLike<number>): Uint8Array {
  const coastal = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (terrainSrc[idx] !== 1) continue;
      const isCoast =
        (x > 0 && terrainSrc[idx - 1] !== 1) ||
        (x < width - 1 && terrainSrc[idx + 1] !== 1) ||
        (y > 0 && terrainSrc[idx - width] !== 1) ||
        (y < height - 1 && terrainSrc[idx + width] !== 1);
      if (isCoast) coastal[idx] = 1;
    }
  }
  return coastal;
}

/** Bir tile'ın 4 yönlü kara/su komşularının index'leri (harita kenarında eksik yön atlanır). */
function tileNeighbors(idx: number): number[] {
  const x = idx % mapWidth;
  const y = Math.floor(idx / mapWidth);
  const result: number[] = [];
  if (x > 0) result.push(idx - 1);
  if (x < mapWidth - 1) result.push(idx + 1);
  if (y > 0) result.push(idx - mapWidth);
  if (y < mapHeight - 1) result.push(idx + mapWidth);
  return result;
}

/** Tile'ın güncel sahiplik rengini (kendi rengi veya nötr kara rengi) yeniden boyar — su tile'ları hiç etkilenmez. */
function paintTile(idx: number): void {
  if (terrain[idx] !== 1) return;
  const owner = ownerByTile[idx];
  const player = owner === -1 ? null : players.get(owner);
  renderer.setOwnership(idx, player ? hexToRgb(player.color) : LAND_COLOR);
}

/** Sahipli bir tile'ın komşularından biri farklı sahipse (veya suysa) sınır (border) olarak işaretler —
 *  bölge sistemi kalkınca sınırların TEK göstergesi bu. Nötr toprak asla sınır olarak işaretlenmez; böylece
 *  iki bölge arasındaki koyu çizgi iki taraflı değil, sahipli tarafta tek piksellik ince bir çizgi olur. */
function updateBorderFlag(idx: number): void {
  if (terrain[idx] !== 1) {
    renderer.setBorderFlag(idx, false);
    return;
  }
  const owner = ownerByTile[idx];
  const isBorder = owner !== -1 && tileNeighbors(idx).some((n) => ownerByTile[n] !== owner);
  renderer.setBorderFlag(idx, isBorder);

  if (owner === selfId && isBorder) {
    selfBorderTiles.add(idx);
  } else {
    selfBorderTiles.delete(idx);
  }
}

/** Bir tile'ın sahipliği değişince kendisini ve komşularını (onların sınır durumu da değişebileceği için) yeniden boyar. */
function repaintTileAndNeighbors(idx: number): void {
  updateBorderFlag(idx);
  paintTile(idx);
  for (const n of tileNeighbors(idx)) {
    updateBorderFlag(n);
    paintTile(n);
  }
}

function applyOwnershipChange(idx: number, ownerId: number): void {
  ownerByTile[idx] = ownerId;
  repaintTileAndNeighbors(idx);
}

function handleInit(msg: InitMessage): void {
  selfId = msg.selfId;
  updatePlayers(msg.players);
  updateBuildings(msg.buildings);

  for (let i = 0; i < msg.owner.length; i++) ownerByTile[i] = msg.owner[i];
  // Sınır bayrağı boyamadan ÖNCE hesaplanmalı — paintTile, renderer.writePixel içinde borderTiles'ı okuyup
  // koyulaştırmayı o an uyguluyor; sıra ters olursa ilk çizimde hiç kimsenin (botlar dahil) sınırı görünmez,
  // yalnızca sonradan el değiştiren tile'lar (bkz. repaintTileAndNeighbors) doğru sırayla yeniden boyandığı
  // için düzelir — bu da aktif oynayan tarafın sınırı görünürken botlarınkinin görünmemesine yol açardı.
  for (let i = 0; i < msg.owner.length; i++) {
    if (terrain[i] !== 1) continue;
    updateBorderFlag(i);
    paintTile(i);
  }

  tradeShips = new Map(msg.tradeShips.map((s) => [s.id, s]));
  warships = new Map(msg.warships.map((s) => [s.id, s]));
  renderer.setServerTimeSync(msg.tick);
  renderer.setContestedTiles(msg.contestedTiles);
  updateTradeShipRenderer();
  updateWarshipRenderer();

  if (!hasCenteredOnSpawn) {
    hasCenteredOnSpawn = centerCameraOnSelf();
  }
  statusEl.textContent = "oyuna katıldın — fare tekerleği: zoom, sürükle: kaydır";
}

function handleTick(msg: TickMessage): void {
  updatePlayers(msg.players);
  updateBuildings(msg.buildings);

  for (const change of msg.changes) {
    applyOwnershipChange(change.i, change.o);
  }

  for (const ship of msg.spawnedTradeShips) tradeShips.set(ship.id, ship);
  for (const id of msg.arrivedTradeShipIds) tradeShips.delete(id);
  warships = new Map(msg.warships.map((s) => [s.id, s]));
  if (selectedWarshipId !== null && !warships.has(selectedWarshipId)) selectedWarshipId = null;
  renderer.setServerTimeSync(msg.tick);
  renderer.setContestedTiles(msg.contestedTiles);
  updateTradeShipRenderer();
  updateWarshipRenderer();

  if (!hasCenteredOnSpawn) {
    hasCenteredOnSpawn = centerCameraOnSelf();
  }

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
  renderer.setPlayerLabels(
    list
      .filter((p) => p.tileCount > 0)
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        centerX: p.centerX,
        centerY: p.centerY,
        troops: p.troops,
        tileCount: p.tileCount,
      })),
  );
  renderPanel();
}

function updateBuildings(list: BuildingDTO[]): void {
  buildings = new Map(list.map((b) => [b.id, b]));
  renderer.setBuildings(
    Array.from(buildings.values()).map((b) => ({ tileIndex: b.tileIndex, type: b.type })),
  );
}

/** true döner ancak kendi toprağımız henüz sunucudan gelmediyse (tileCount 0) false döner — çağıran, sonraki tick'te tekrar denemeli. */
function centerCameraOnSelf(): boolean {
  if (selfId === null || mapWidth === 0) return false;
  const self = players.get(selfId);
  if (!self || self.tileCount === 0) return false;
  renderer.centerOn(self.centerX + 0.5, self.centerY + 0.5, SPAWN_ZOOM);
  return true;
}

/** Liderlik tablosunda bir oyuncuya (kendisi dahil) tıklanınca kamerayı onun toprağının merkezine odaklar. */
function focusOnPlayer(player: PlayerStateDTO): void {
  if (player.tileCount === 0) return;
  renderer.centerOn(player.centerX + 0.5, player.centerY + 0.5, SPAWN_ZOOM);
}

/** Tile land mi, bize ait değil mi ve sahibinin toprağı bana haritanın HERHANGİ bir noktasında bitişik mi
 *  — tıklanan tile'ın tam kendi sınırımda olması gerekmez, o ülkenin/nötr bölgenin herhangi bir yerine
 *  tıklamak yeterli (sunucudaki queueAttack ile aynı kural, bkz. GameState.ts). */
function isTileAttackable(tileIndex: number): boolean {
  if (selfId === null) return false;
  if (terrain[tileIndex] !== 1) return false;
  const targetOwner = ownerByTile[tileIndex];
  if (targetOwner === selfId) return false;
  for (const borderIdx of selfBorderTiles) {
    if (tileNeighbors(borderIdx).some((n) => ownerByTile[n] === targetOwner)) return true;
  }
  return false;
}

/** Liderlik tablosunda tek bir oyuncu satırı — tıklama, panelEl üzerindeki tek delege dinleyici ile yakalanır
 *  (bkz. data-player-id), her satıra ayrı listener eklemez. */
function buildLeaderboardRow(player: PlayerStateDTO, rank: number, isSelf: boolean): HTMLDivElement {
  const row = document.createElement("div");
  row.className = isSelf ? "row row-self" : "row";
  row.dataset.playerId = String(player.id);
  const rankSpan = document.createElement("span");
  rankSpan.className = "row-rank";
  rankSpan.textContent = `${rank}.`;
  const name = document.createElement("span");
  name.textContent = player.name;
  const count = document.createElement("span");
  count.textContent = String(player.tileCount);
  row.append(rankSpan, name, count);
  return row;
}

/** Sağ üst panel: kendi istatistiklerimiz (her zaman görünür) + açılıp kapanabilen ilk 10 liderlik tablosu
 *  (kendimiz ilk 10'da değilsek, en altta "···" ayracıyla kendi sıramız eklenir).
 *  Panel her tick'te yeniden çiziliyor; fare panel üzerinde basılıyken (bkz. panelPointerDown) bu
 *  yeniden çizim atlanır — aksi halde satırlar tam mousedown/mouseup arasında yer değiştirip
 *  tıklamanın altındaki canvas'a "sızmasına" yol açabiliyordu. */
function renderPanel(): void {
  if (panelPointerDown) return;
  panelEl.replaceChildren();

  const self = selfId !== null ? players.get(selfId) : undefined;
  if (self) {
    const div = document.createElement("div");
    div.className = "self";
    div.dataset.playerId = String(self.id);
    div.textContent = `${self.name} — Altın: ${self.gold} | Asker: ${self.troops} | Toprak: ${self.tileCount}`;
    panelEl.appendChild(div);
  }

  const header = document.createElement("div");
  header.id = "leaderboardHeader";
  const title = document.createElement("span");
  title.textContent = "Liderlik Tablosu";
  const toggleBtn = document.createElement("button");
  toggleBtn.id = "leaderboardToggleBtn";
  toggleBtn.type = "button";
  toggleBtn.textContent = leaderboardCollapsed ? "▸ Göster" : "▾ Gizle";
  toggleBtn.addEventListener("click", () => {
    leaderboardCollapsed = !leaderboardCollapsed;
    renderPanel();
  });
  header.append(title, toggleBtn);
  panelEl.appendChild(header);

  if (leaderboardCollapsed) return;

  const ranked = Array.from(players.values())
    .filter((p) => p.tileCount > 0)
    .sort((a, b) => b.tileCount - a.tileCount);

  const top = ranked.slice(0, LEADERBOARD_SIZE);
  for (let i = 0; i < top.length; i++) {
    panelEl.appendChild(buildLeaderboardRow(top[i], i + 1, top[i].id === selfId));
  }

  const selfRank = selfId !== null ? ranked.findIndex((p) => p.id === selfId) : -1;
  if (selfRank >= LEADERBOARD_SIZE) {
    const separator = document.createElement("div");
    separator.className = "row-separator";
    separator.textContent = "···";
    panelEl.appendChild(separator);
    panelEl.appendChild(buildLeaderboardRow(ranked[selfRank], selfRank + 1, true));
  }
}

function updateHover(clientX: number, clientY: number): void {
  const { x, y } = toCanvasCoords(clientX, clientY);
  const tileIndex = renderer.screenToTileIndex(x, y);
  if (tileIndex === null || selfId === null) {
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
    kind = isTileAttackable(tileIndex) ? "valid" : "invalid";
  }

  renderer.setHoverRegion([tileIndex], kind);
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
  const { x, y } = toCanvasCoords(clientX, clientY);
  const tileIndex = renderer.screenToTileIndex(x, y);
  if (tileIndex === null) return;
  const world = renderer.screenToWorld(x, y);

  // Bir gemi seçiliyken herhangi bir yere tıklamak, suysa hareket emri verir.
  if (selectedWarshipId !== null) {
    const shipId = selectedWarshipId;
    setSelectedWarship(null);
    if (terrain[tileIndex] !== 1) {
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

  if (terrain[tileIndex] !== 1) return;

  const looksValid = isTileAttackable(tileIndex);
  renderer.addRipple(world.x, world.y, looksValid ? "attack" : "invalid");
  ws.send(JSON.stringify({ type: "attack", tileIndex }));
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

// Panel tek delege dinleyici ile satır tıklamalarını yakalar (bkz. buildLeaderboardRow'daki data-player-id);
// mousedown sırasında panelPointerDown bayrağı, tıklama tamamlanana kadar arkadaki tick'lerin satırları
// değiştirip tıklamayı canvas'a kaçırmasını önler.
panelEl.addEventListener("mousedown", () => {
  panelPointerDown = true;
});
panelEl.addEventListener("click", (event) => {
  const rowEl = (event.target as HTMLElement).closest<HTMLElement>("[data-player-id]");
  if (!rowEl) return;
  const player = players.get(Number(rowEl.dataset.playerId));
  if (player) focusOnPlayer(player);
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
  const { x, y } = toCanvasCoords(event.clientX, event.clientY);
  const world = renderer.screenToWorld(x, y);
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
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.panBy((event.clientX - lastMouseX) * dpr, (event.clientY - lastMouseY) * dpr);
    }
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
  } else if (event.target === canvas) {
    updateHover(event.clientX, event.clientY);
  } else {
    // Fare HUD öğelerinin (panel, build bar, ...) üzerindeyken altındaki tile'ı vurgulamayı bırak.
    renderer.setHoverRegion([], "invalid");
  }
});

window.addEventListener("mouseup", (event) => {
  panelPointerDown = false;
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
    const { x, y } = toCanvasCoords(event.clientX, event.clientY);
    renderer.zoomBy(x, y, factor);
  },
  { passive: false },
);
