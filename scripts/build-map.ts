import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WORLD_MAP_SPECS } from "../src/core/maps";

/**
 * Build-time script — runtime kodunun parçası değil. Natural Earth'ün public
 * domain kara poligonu verisini (bkz. resources/geo-source/, .gitignore'da,
 * `npm run build:maps` her seferinde yeniden indirir) `WORLD_MAP_SPECS`
 * (bkz. src/core/maps.ts, Faz 9) içindeki her bölge için hedef
 * genişlik×yükseklik tile grid'ine rasterize edip `resources/maps/<id>.json`
 * olarak yazar.
 *
 * OpenFrontIO'nun kendi harita asset'leri kullanılmıyor (CC BY-SA 4.0,
 * share-alike gerektiriyor) — bkz. docs/phases/faz-08-gercek-dunya-haritasi.md.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SOURCE_GEOJSON = path.join(ROOT, "resources/geo-source/ne_50m_land.geojson");
const OUTPUT_DIR = path.join(ROOT, "resources/maps");

type Ring = [number, number][];
type Edge = [number, number, number, number];

interface GeoJsonFeatureCollection {
  features: { geometry: { type: string; coordinates: unknown } }[];
}

function extractRings(geometry: { type: string; coordinates: unknown }): Ring[] {
  if (geometry.type === "Polygon") {
    return geometry.coordinates as Ring[];
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as Ring[][]).flat();
  }
  return [];
}

function loadEdges(geojsonPath: string): Edge[] {
  const data = JSON.parse(readFileSync(geojsonPath, "utf-8")) as GeoJsonFeatureCollection;
  const edges: Edge[] = [];
  for (const feature of data.features) {
    for (const ring of extractRings(feature.geometry)) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [lon0, lat0] = ring[i];
        const [lon1, lat1] = ring[i + 1];
        if (lat0 === lat1) continue; // yatay kenar, scanline'da katkısı yok
        edges.push([lon0, lat0, lon1, lat1]);
      }
    }
  }
  return edges;
}

/**
 * Even-odd scanline dolgusu: her tile satırı bir enleme karşılık gelir; o
 * enlemi kesen TÜM kenarlar (dünya genelinde) bulunup boylama göre sıralanır,
 * ardışık çiftler arası "içeride" sayılır. Bu, iç içe halkaları (göl gibi
 * delikler) ve ayrık poligonları (adalar) sarma yönünden bağımsız doğru ele
 * alır — çıktı sadece bbox'a denk gelen piksellere kırpılır, kesişim mantığı
 * kırpılmaz (uzak kıtalardaki kenarlar da pariteyi doğru etkiler).
 */
function rasterize(edges: Edge[], bbox: [number, number, number, number], width: number, height: number): Uint8Array {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const terrain = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    const lat = maxLat - ((y + 0.5) / height) * (maxLat - minLat);
    const intersections: number[] = [];

    for (const [lon0, lat0, lon1, lat1] of edges) {
      const crosses = (lat0 <= lat && lat1 > lat) || (lat1 <= lat && lat0 > lat);
      if (!crosses) continue;
      const t = (lat - lat0) / (lat1 - lat0);
      intersections.push(lon0 + t * (lon1 - lon0));
    }
    intersections.sort((a, b) => a - b);

    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const xStart = Math.max(0, Math.round(((intersections[i] - minLon) / (maxLon - minLon)) * width));
      const xEnd = Math.min(width, Math.round(((intersections[i + 1] - minLon) / (maxLon - minLon)) * width));
      for (let x = xStart; x < xEnd; x++) {
        terrain[y * width + x] = 1;
      }
    }
  }

  return terrain;
}

function main(): void {
  const edges = loadEdges(SOURCE_GEOJSON);
  mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const region of WORLD_MAP_SPECS) {
    const terrain = rasterize(edges, region.bbox, region.width, region.height);
    const landCount = terrain.reduce((sum, v) => sum + v, 0);
    const outPath = path.join(OUTPUT_DIR, `${region.id}.json`);

    writeFileSync(
      outPath,
      JSON.stringify({
        id: region.id,
        name: region.name,
        width: region.width,
        height: region.height,
        terrain: Array.from(terrain),
      }),
    );

    const pct = ((landCount / terrain.length) * 100).toFixed(1);
    console.log(`[build-map] ${region.id}: ${region.width}x${region.height}, kara: ${landCount} tile (%${pct}) -> ${outPath}`);
  }
}

main();
