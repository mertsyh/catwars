import { TICK_RATE } from "../core/constants";
import { positionAlongPath } from "../core/pathfinding";

type RGB = [number, number, number];

const WATER_COLOR: RGB = [14, 42, 74];
const SHALLOW_WATER_COLOR: RGB = [72, 132, 168];
export const LAND_COLOR: RGB = [47, 82, 51];
const BORDER_DARKEN = 0.72;
/** Kıyıdan bu kadar tile uzağa kadar su, derin su rengine doğru gradyanla geçer. */
const MAX_COAST_DIST = 3;

const MIN_ZOOM = 1;
const MAX_ZOOM = 30;
const RIPPLE_DURATION_MS = 450;
const LABEL_MIN_SCALE = 5;

export function hexToRgb(hex: string): RGB {
  const value = parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export interface BuildingMarker {
  tileIndex: number;
  type: string;
}

export interface RegionLabel {
  id: number;
  name: string;
  centerX: number;
  centerY: number;
}

export interface TradeShipRenderData {
  id: number;
  /** Kaynak liman tile'ından hedef limana, aradaki su üzerinden tam tile-index rotası. */
  path: number[];
  spawnTick: number;
  speedTilesPerTick: number;
  color: string;
}

export interface WarshipRenderData {
  id: number;
  path: number[];
  pathStartTick: number;
  speedTilesPerTick: number;
  hp: number;
  maxHp: number;
  state: string;
  color: string;
  selected: boolean;
}

export type HoverKind = "self" | "valid" | "invalid";
export type RippleKind = "attack" | "build" | "invalid" | "cancel" | "move";

interface Ripple {
  x: number;
  y: number;
  start: number;
  kind: RippleKind;
}

interface Transform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const RIPPLE_COLORS: Record<RippleKind, string> = {
  attack: "231, 76, 60",
  build: "255, 224, 102",
  invalid: "150, 150, 150",
  cancel: "224, 224, 224",
  move: "79, 163, 255",
};

const HOVER_COLORS: Record<HoverKind, string> = {
  self: "255, 255, 255",
  valid: "120, 220, 120",
  invalid: "220, 80, 80",
};

export class MapRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly off: HTMLCanvasElement;
  private readonly offCtx: CanvasRenderingContext2D;
  private imageData: ImageData | null = null;
  private imageDirty = false;
  private mapWidth = 0;
  private mapHeight = 0;
  private borderTiles: Uint8Array | null = null;

  private camX = 0;
  private camY = 0;
  private zoom = MIN_ZOOM;

  private buildingMarkers: BuildingMarker[] = [];
  private regionLabels: RegionLabel[] = [];
  private hoverTiles: number[] = [];
  private hoverKind: HoverKind = "invalid";
  private ripples: Ripple[] = [];
  private rafId: number | null = null;
  private tradeShips: TradeShipRenderData[] = [];
  private warships: WarshipRenderData[] = [];
  private syncTick = 0;
  private syncTimestamp = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context alınamadı");
    this.ctx = ctx;

    this.off = document.createElement("canvas");
    const offCtx = this.off.getContext("2d");
    if (!offCtx) throw new Error("2D context alınamadı (offscreen)");
    this.offCtx = offCtx;
  }

  initTerrain(width: number, height: number, terrain: ArrayLike<number>, borderTiles: Uint8Array): void {
    this.mapWidth = width;
    this.mapHeight = height;
    this.borderTiles = borderTiles;
    this.off.width = width;
    this.off.height = height;
    this.camX = width / 2;
    this.camY = height / 2;
    this.zoom = MIN_ZOOM;

    const coastDist = this.computeCoastDistance(width, height, terrain, MAX_COAST_DIST);
    const imageData = this.offCtx.createImageData(width, height);
    for (let i = 0; i < width * height; i++) {
      if (terrain[i] === 1) {
        this.writePixel(imageData, i, LAND_COLOR);
      } else {
        const d = coastDist[i];
        const shallowness = d <= MAX_COAST_DIST ? 1 - (d - 1) / MAX_COAST_DIST : 0;
        this.writePixel(imageData, i, this.lerpColor(WATER_COLOR, SHALLOW_WATER_COLOR, shallowness));
      }
    }
    this.imageData = imageData;
    this.imageDirty = true;
    this.start();
  }

  /**
   * Multi-source BFS: her kara tile'ından su yönüne doğru yayılan bir mesafe haritası.
   * Su tile'ları için sonuç 1 (karaya bitişik) .. maxDist+1 ("uzak"/derin su) arası;
   * kara tile'ları 0. Yayılma maxDist adımda durduğu için (kara/su oranından bağımsız
   * olarak) büyük haritalarda bile maliyeti kıyı uzunluğuyla orantılı kalır.
   */
  private computeCoastDistance(width: number, height: number, terrain: ArrayLike<number>, maxDist: number): Uint8Array {
    const n = width * height;
    const far = maxDist + 1;
    const dist = new Uint8Array(n).fill(far);
    const queue = new Int32Array(n);
    let qHead = 0;
    let qTail = 0;

    for (let i = 0; i < n; i++) {
      if (terrain[i] === 1) {
        dist[i] = 0;
        queue[qTail++] = i;
      }
    }

    while (qHead < qTail) {
      const idx = queue[qHead++];
      const d = dist[idx];
      if (d >= maxDist) continue;
      const x = idx % width;
      const nd = d + 1;
      if (x > 0 && dist[idx - 1] > nd) {
        dist[idx - 1] = nd;
        queue[qTail++] = idx - 1;
      }
      if (x < width - 1 && dist[idx + 1] > nd) {
        dist[idx + 1] = nd;
        queue[qTail++] = idx + 1;
      }
      if (idx - width >= 0 && dist[idx - width] > nd) {
        dist[idx - width] = nd;
        queue[qTail++] = idx - width;
      }
      if (idx + width < n && dist[idx + width] > nd) {
        dist[idx + width] = nd;
        queue[qTail++] = idx + width;
      }
    }

    return dist;
  }

  private lerpColor(a: RGB, b: RGB, t: number): RGB {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  setOwnership(index: number, color: RGB): void {
    if (!this.imageData) return;
    this.writePixel(this.imageData, index, color);
    this.imageDirty = true;
  }

  setBuildings(markers: BuildingMarker[]): void {
    this.buildingMarkers = markers;
  }

  setRegionLabels(regions: RegionLabel[]): void {
    this.regionLabels = regions;
  }

  setTradeShips(ships: TradeShipRenderData[]): void {
    this.tradeShips = ships;
  }

  setWarships(ships: WarshipRenderData[]): void {
    this.warships = ships;
  }

  /** Sunucudan bir tick/init mesajı geldiğinde, gemi pozisyonlarını gerçek zamanda interpole edebilmek için kalibrasyon noktası. */
  setServerTimeSync(tick: number): void {
    this.syncTick = tick;
    this.syncTimestamp = performance.now();
  }

  /** Şu anki gerçek zamana göre tahmini sunucu tick'i — main.ts'in savaş gemisi seçim hit-test'i için. */
  getEstimatedTick(): number {
    return this.syncTick + ((performance.now() - this.syncTimestamp) / 1000) * TICK_RATE;
  }

  setHoverRegion(tiles: number[], kind: HoverKind): void {
    this.hoverTiles = tiles;
    this.hoverKind = kind;
  }

  addRipple(worldX: number, worldY: number, kind: RippleKind): void {
    this.ripples.push({ x: worldX, y: worldY, start: performance.now(), kind });
  }

  centerOn(x: number, y: number, zoom?: number): void {
    this.camX = x;
    this.camY = y;
    if (zoom !== undefined) this.zoom = this.clampZoom(zoom);
    this.clampCamera();
  }

  zoomBy(clientX: number, clientY: number, factor: number): void {
    const before = this.screenToWorld(clientX, clientY);
    this.zoom = this.clampZoom(this.zoom * factor);
    const after = this.screenToWorld(clientX, clientY);
    this.camX += before.x - after.x;
    this.camY += before.y - after.y;
    this.clampCamera();
  }

  panBy(dxScreen: number, dyScreen: number): void {
    const { scale } = this.getTransform();
    this.camX -= dxScreen / scale;
    this.camY -= dyScreen / scale;
    this.clampCamera();
  }

  screenToWorld(px: number, py: number): { x: number; y: number } {
    const { scale, offsetX, offsetY } = this.getTransform();
    return { x: (px - offsetX) / scale, y: (py - offsetY) / scale };
  }

  screenToTileIndex(px: number, py: number): number | null {
    if (this.mapWidth === 0) return null;
    const { x, y } = this.screenToWorld(px, py);
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.mapWidth || ty >= this.mapHeight) return null;
    return ty * this.mapWidth + tx;
  }

  private start(): void {
    if (this.rafId !== null) return;
    const loop = (): void => {
      this.renderFrame();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private renderFrame(): void {
    if (this.imageDirty && this.imageData) {
      this.offCtx.putImageData(this.imageData, 0, 0);
      this.imageDirty = false;
    }
    this.present();
  }

  private present(): void {
    const { ctx, canvas, off, mapWidth, mapHeight } = this;
    if (mapWidth === 0) return;
    const { scale, offsetX, offsetY } = this.getTransform();

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, mapWidth, mapHeight, offsetX, offsetY, mapWidth * scale, mapHeight * scale);

    this.drawBuildingMarkers(scale, offsetX, offsetY);
    this.drawHoverRegion(scale, offsetX, offsetY);
    this.drawTradeShips(scale, offsetX, offsetY);
    this.drawWarships(scale, offsetX, offsetY);
    this.drawRegionLabels(scale, offsetX, offsetY);
    this.drawRipples(scale, offsetX, offsetY);
  }

  private getTransform(): Transform {
    const { canvas, mapWidth, mapHeight, zoom } = this;
    const baseScale = Math.min(canvas.width / mapWidth, canvas.height / mapHeight);
    const scale = baseScale * zoom;
    const offsetX = canvas.width / 2 - this.camX * scale;
    const offsetY = canvas.height / 2 - this.camY * scale;
    return { scale, offsetX, offsetY };
  }

  private clampZoom(zoom: number): number {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  }

  /**
   * Kamerayı harita sınırlarına kırpar — ama sadece 0..width aralığına değil.
   * Geçerli zoom'da görünür alan (canvas boyutu / scale) haritadan darsa,
   * kamera merkezini harita kenarından en az yarım-viewport içeride tutar;
   * böylece ekranın bir kısmı haritanın dışına (siyah arka plana) taşmaz.
   * Görünür alan haritadan genişse (ör. zoom=1'de en/boy oranı uyuşmuyorsa)
   * o eksende ortalanır — bu durumda letterbox bar'ları beklenen davranıştır.
   */
  private clampCamera(): void {
    const { scale } = this.getTransform();
    const halfViewW = this.canvas.width / (2 * scale);
    const halfViewH = this.canvas.height / (2 * scale);

    this.camX =
      halfViewW * 2 > this.mapWidth
        ? this.mapWidth / 2
        : Math.max(halfViewW, Math.min(this.mapWidth - halfViewW, this.camX));
    this.camY =
      halfViewH * 2 > this.mapHeight
        ? this.mapHeight / 2
        : Math.max(halfViewH, Math.min(this.mapHeight - halfViewH, this.camY));
  }

  private drawBuildingMarkers(scale: number, offsetX: number, offsetY: number): void {
    if (this.buildingMarkers.length === 0) return;
    const { ctx, mapWidth } = this;
    const radius = Math.max(2, scale * 0.6);

    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.lineWidth = 1;

    for (const marker of this.buildingMarkers) {
      const x = marker.tileIndex % mapWidth;
      const y = Math.floor(marker.tileIndex / mapWidth);
      const px = offsetX + (x + 0.5) * scale;
      const py = offsetY + (y + 0.5) * scale;

      if (marker.type === "defensePost") {
        ctx.fillStyle = "#b0bec5";
        ctx.fillRect(px - radius, py - radius, radius * 2, radius * 2);
        ctx.strokeRect(px - radius, py - radius, radius * 2, radius * 2);
      } else if (marker.type === "port") {
        ctx.fillStyle = "#4fa3ff";
        ctx.beginPath();
        ctx.moveTo(px, py - radius);
        ctx.lineTo(px + radius, py + radius);
        ctx.lineTo(px - radius, py + radius);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillStyle = "#ffe066";
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  /**
   * Gemi pozisyonu sunucudan her tick alınmaz — doğuşta gelen path/spawnTick/
   * hız bilgisinden, en son senkronize edilen tick + geçen gerçek zamana göre
   * lokal olarak interpole edilir (bkz. setServerTimeSync, positionAlongPath).
   */
  private drawTradeShips(scale: number, offsetX: number, offsetY: number): void {
    if (this.tradeShips.length === 0) return;
    const { ctx, mapWidth } = this;
    const estimatedTick = this.getEstimatedTick();
    const radius = Math.max(1.5, scale * 0.28);

    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.lineWidth = 1;

    for (const ship of this.tradeShips) {
      if (ship.path.length <= 1) continue;
      const pos = positionAlongPath(ship.path, mapWidth, ship.spawnTick, ship.speedTilesPerTick, estimatedTick);

      ctx.fillStyle = ship.color;
      ctx.beginPath();
      ctx.arc(offsetX + (pos.x + 0.5) * scale, offsetY + (pos.y + 0.5) * scale, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  /** Savaş gemileri: yön göstermeden basit daire + üstünde HP çubuğu; seçiliyse beyaz halka, inşa halindeyken soluk. */
  private drawWarships(scale: number, offsetX: number, offsetY: number): void {
    if (this.warships.length === 0) return;
    const { ctx, mapWidth } = this;
    const estimatedTick = this.getEstimatedTick();
    const radius = Math.max(2, scale * 0.32);

    for (const ship of this.warships) {
      const pos = positionAlongPath(ship.path, mapWidth, ship.pathStartTick, ship.speedTilesPerTick, estimatedTick);
      const px = offsetX + (pos.x + 0.5) * scale;
      const py = offsetY + (pos.y + 0.5) * scale;
      const building = ship.state === "building";

      ctx.globalAlpha = building ? 0.5 : 1;

      ctx.fillStyle = ship.color;
      ctx.strokeStyle = ship.state === "returning" ? "rgba(255, 224, 102, 0.9)" : "rgba(0, 0, 0, 0.5)";
      ctx.lineWidth = Math.max(1, scale * 0.1);
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (ship.selected) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
        ctx.lineWidth = Math.max(1, scale * 0.08);
        ctx.beginPath();
        ctx.arc(px, py, radius + scale * 0.18, 0, Math.PI * 2);
        ctx.stroke();
      }

      const barWidth = radius * 2.2;
      const barY = py - radius - scale * 0.22;
      const hpFraction = Math.max(0, Math.min(1, ship.hp / ship.maxHp));
      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.fillRect(px - barWidth / 2, barY, barWidth, scale * 0.1);
      ctx.fillStyle = hpFraction > 0.5 ? "#6fcf6f" : hpFraction > 0.25 ? "#e8c547" : "#e05c5c";
      ctx.fillRect(px - barWidth / 2, barY, barWidth * hpFraction, scale * 0.1);

      ctx.globalAlpha = 1;
    }
  }

  private drawHoverRegion(scale: number, offsetX: number, offsetY: number): void {
    if (this.hoverTiles.length === 0) return;
    const { ctx, mapWidth } = this;
    const color = HOVER_COLORS[this.hoverKind];
    ctx.fillStyle = `rgba(${color}, 0.55)`;

    for (const idx of this.hoverTiles) {
      const x = idx % mapWidth;
      const y = Math.floor(idx / mapWidth);
      ctx.fillRect(offsetX + x * scale, offsetY + y * scale, scale + 0.5, scale + 0.5);
    }
  }

  private drawRegionLabels(scale: number, offsetX: number, offsetY: number): void {
    if (scale < LABEL_MIN_SCALE || this.regionLabels.length === 0) return;
    const { ctx, canvas } = this;
    const fontSize = Math.min(16, Math.max(9, scale * 0.35));
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(2, fontSize * 0.18);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";

    for (const region of this.regionLabels) {
      const px = offsetX + region.centerX * scale;
      const py = offsetY + region.centerY * scale;
      if (px < -50 || py < -20 || px > canvas.width + 50 || py > canvas.height + 20) continue;
      ctx.strokeText(region.name, px, py);
      ctx.fillText(region.name, px, py);
    }
  }

  private drawRipples(scale: number, offsetX: number, offsetY: number): void {
    if (this.ripples.length === 0) return;
    const now = performance.now();
    const { ctx } = this;

    this.ripples = this.ripples.filter((r) => now - r.start < RIPPLE_DURATION_MS);

    for (const ripple of this.ripples) {
      const age = (now - ripple.start) / RIPPLE_DURATION_MS;
      const px = offsetX + ripple.x * scale;
      const py = offsetY + ripple.y * scale;
      const radius = scale * (0.4 + age * 3);
      const alpha = 0.7 * (1 - age);

      ctx.beginPath();
      ctx.strokeStyle = `rgba(${RIPPLE_COLORS[ripple.kind]}, ${alpha})`;
      ctx.lineWidth = Math.max(1, scale * 0.15);
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private writePixel(imageData: ImageData, index: number, [r, g, b]: RGB): void {
    const darken = this.borderTiles?.[index] ? BORDER_DARKEN : 1;
    const o = index * 4;
    imageData.data[o] = r * darken;
    imageData.data[o + 1] = g * darken;
    imageData.data[o + 2] = b * darken;
    imageData.data[o + 3] = 255;
  }
}
