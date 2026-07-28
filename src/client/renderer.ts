type RGB = [number, number, number];

const WATER_COLOR: RGB = [14, 42, 74];
export const LAND_COLOR: RGB = [47, 82, 51];
const BORDER_DARKEN = 0.72;

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

export interface SiegeBar {
  regionId: number;
  attackerColor: string;
  garrison: number;
  maxGarrison: number;
}

export type HoverKind = "self" | "valid" | "invalid";
export type RippleKind = "attack" | "build" | "invalid" | "cancel";

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
  private regionById = new Map<number, RegionLabel>();
  private sieges: SiegeBar[] = [];
  private hoverTiles: number[] = [];
  private hoverKind: HoverKind = "invalid";
  private ripples: Ripple[] = [];
  private rafId: number | null = null;

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

    const imageData = this.offCtx.createImageData(width, height);
    for (let i = 0; i < width * height; i++) {
      this.writePixel(imageData, i, terrain[i] === 1 ? LAND_COLOR : WATER_COLOR);
    }
    this.imageData = imageData;
    this.imageDirty = true;
    this.start();
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
    this.regionById = new Map(regions.map((r) => [r.id, r]));
  }

  setSieges(sieges: SiegeBar[]): void {
    this.sieges = sieges;
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
    this.drawSieges(scale, offsetX, offsetY);
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

  private clampCamera(): void {
    this.camX = Math.max(0, Math.min(this.mapWidth, this.camX));
    this.camY = Math.max(0, Math.min(this.mapHeight, this.camY));
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
      } else {
        ctx.fillStyle = "#ffe066";
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
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

  private drawSieges(scale: number, offsetX: number, offsetY: number): void {
    if (this.sieges.length === 0) return;
    const { ctx } = this;
    const barWidth = 56;
    const barHeight = 8;

    for (const siege of this.sieges) {
      const region = this.regionById.get(siege.regionId);
      if (!region) continue;
      const px = offsetX + region.centerX * scale;
      const py = offsetY + region.centerY * scale;
      const fraction = siege.maxGarrison > 0 ? Math.max(0, siege.garrison / siege.maxGarrison) : 0;

      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillRect(px - barWidth / 2 - 2, py - barHeight / 2 - 2, barWidth + 4, barHeight + 4);

      ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
      ctx.fillRect(px - barWidth / 2, py - barHeight / 2, barWidth, barHeight);

      ctx.fillStyle = siege.attackerColor;
      ctx.fillRect(px - barWidth / 2, py - barHeight / 2, barWidth * fraction, barHeight);

      ctx.fillStyle = "#fff";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${Math.round(siege.garrison)} / ${Math.round(siege.maxGarrison)}`, px, py - barHeight / 2 - 5);
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
