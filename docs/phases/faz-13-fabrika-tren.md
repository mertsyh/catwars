# Faz 13 — Fabrika + Tren/Demiryolu

**Bağımlılık:** Faz 6 (pathfinding deseni ve gemi ilerleme/interpolasyon deseni — kara versiyonu bunun üzerine kurulur), Faz 11 (müttefik/takım tarifesi farkı için ilişki bilgisi)
**Boyut:** Orta — Faz 6'nın kara üzerindeki tekrarı, deneysel/son öncelikli.

## Amaç

Bu, PROGRESS.md'nin kendi yol haritasında da **bilinçli olarak en sona** bırakılmış özellik ("OpenFront'ta da en son eklenen özellik"). Ticaret gemisinin kara karşılığı: fabrika + şehirler arasında otomatik çalışan trenler, kara üzerinden ek bir pasif gelir kanalı açıyor ve **ittifak/takım ilişkisini ekonomik olarak ödüllendiren** bir mekanik ekliyor (müttefik hattı, kendi hattından daha kazançlı).

## OpenFront'ta nasıl çalışıyor (tasarım referansı)

Fabrikalar otomatik olarak tren üretiyor; trenler istasyonlar (fabrika/şehir) arasında tile yolu üzerinde hareket ediyor, varışta altın ödüyor. Kendi ağınızdaki bir bağlantı daha az, müttefik/takım bağlantısı daha çok altın veriyor — bu, oyuncuları müttefikleriyle demiryolu hattı kurmaya teşvik ediyor.

## Bizim oyuna nasıl uyarlanacak

- Faz 6'da yazılan su pathfinding'i (`findWaterPath`), bu fazda genellenir: `src/core/pathfinding.ts` içine `findPath(map, fromTile, toTile, terrainFilter: TerrainValue)` — hem su (gemi) hem kara (tren) için aynı BFS'i kullanır.
- Tren durakları: fabrika **ve** şehir binaları (`BuildingType.City`) "istasyon" sayılır — yani mevcut şehir binasına yeni bir işlev ekleniyor, ayrı bir "istasyon" binası icat edilmiyor (basitlik tercihi, bkz. Açık sorular).
- Ödeme kademesi, Faz 11'in ilişki bilgisine bağlı: `sameOwner < allied/sameTeam`. Faz 11 yoksa (bu faz ondan önce yapılırsa) sadece iki kademe olur: kendi hattı vs. diğer oyuncu hattı (müttefik ayrımı yapılamaz) — bu yüzden bağımlılık tablosunda Faz 11 sonrası öneriliyor.

## Veri modeli değişiklikleri

**`src/core/types.ts`**
```ts
BuildingType.Factory = "factory"   // union'a ekle

interface Train {
  id: number;
  ownerId: number;
  fromBuildingId: number;   // fabrika
  toBuildingId: number;     // şehir/fabrika (istasyon)
  toOwnerId: number;
  path: { x: number; y: number }[];
  spawnTick: number;
  speedTilesPerTick: number;
  goldTier: "self" | "allied" | "other";
}
```

**`src/core/protocol.ts`**: `BuildMessage.buildingType` union'a `"factory"` ekle; tick/init mesajlarına `trains: TrainDTO[]` ekle (Faz 6'daki `tradeShips` ile birebir aynı desen).

## Sunucu değişiklikleri

- `src/core/pathfinding.ts`: `findWaterPath`'i genelleştirip `findPath(..., terrainFilter)` yap, `findWaterPath` onun `Terrain.Water` ile çağrılan bir sarmalayıcısı olsun (Faz 6 kodu bozulmadan).
- `GameState.ts`:
  - Fabrika inşası (kara bölgesine, kıyı şartı yok — Faz 6'daki liman kısıtından farklı).
  - Periyodik tren doğuşu: fabrika sahibinin kendi/müttefik/diğer şehirlerinden birini hedef seç, `findPath` ile kara rotası hesapla; rota yoksa (ör. deniz aşırı, bağlantısız kıta) o hedefi atla.
  - Varışta `goldTier`'a göre `TRAIN_GOLD_SELF` / `TRAIN_GOLD_ALLIED` / `TRAIN_GOLD_OTHER` öde.
- `server/index.ts`: `trains` broadcast'e ekle.

## İstemci değişiklikleri

- `renderer.ts`: fabrika ikonu, ray hattı (opsiyonel: path'i ince çizgiyle göster), hareket eden tren ikonu (Faz 6'daki gemi çiziminin kara versiyonu — kod paylaşımı için ortak bir `drawMovingUnit()` yardımcı fonksiyonu düşünülebilir).
- `main.ts`: bina barına "Fabrika" ekle.

## Denge sabitleri (başlangıç önerisi)

| Sabit | Önerilen değer | Anlamı |
|---|---|---|
| `FACTORY_COST` | 700 | fabrika maliyeti |
| `TRAIN_SPAWN_INTERVAL_TICKS` | 50 (5 sn) | fabrika başına ortalama tren doğuş aralığı |
| `TRAIN_SPEED_TILES_PER_TICK` | 1.0 | tren hızı (gemi/`TRADE_SHIP_SPEED`den biraz yavaş — kara rotaları genelde daha kısa/dolambaçlı) |
| `TRAIN_GOLD_SELF` | 10 | kendi şehrine varışta |
| `TRAIN_GOLD_ALLIED` | 35 | müttefik/takım şehrine varışta |
| `TRAIN_GOLD_OTHER` | 0 | ilişkisiz/düşman oyuncuya varış — izin verilmiyor, hedef seçiminde zaten elenir |

## Yapılacaklar (checklist)

- [ ] `pathfinding.ts`: `findPath` genellemesi (`findWaterPath` geriye dönük uyumlu kalır)
- [ ] `types.ts`: `BuildingType.Factory`, `Train`
- [ ] `protocol.ts`: `TrainDTO`, `BuildMessage` union güncelle
- [ ] `constants.ts`: yukarıdaki sabitler
- [ ] `GameState.ts`: fabrika inşası, tren doğuş/ilerleme/varış + Faz 11 ilişki sorgusuyla `goldTier` belirleme
- [ ] `server/index.ts`: `trains` broadcast'e ekle
- [ ] `renderer.ts`: fabrika ikonu + hareketli tren çizimi
- [ ] `main.ts`: bina barına "Fabrika" ekle

## Kabul kriterleri

- Fabrika inşa edilince, sahibinin şehirlerine doğru periyodik olarak trenler doğup kara üzerinde hareket ediyor.
- Müttefik/takım şehrine varan tren, kendi şehrine varandan belirgin biçimde daha çok altın veriyor.
- Karadan bağlantısız (ör. ayrı ada) şehirlere tren doğmuyor / hata vermiyor.

## Açık sorular / riskler

- **Ayrı bir "istasyon" binası mı, yoksa mevcut Şehir binası mı istasyon görevi görsün?** Bu dosya "mevcut Şehir" öneriyor (daha az yeni kavram) — OpenFront'ta ayrı bir istasyon kavramı olup olmadığı kamuya açık kaynaklarda net değildi, bu yüzden basitlik lehine karar verildi; playtest sonrası ayrı bina türüne bölünebilir.
- Bu faz **v24/"deneysel"** notuyla OpenFront'ta bile en yeni/en az oturmuş özellik — kendi implementasyonumuzda da ilk sürümün kaba/basit kalması makul, ince ayar (çoklu vagon, istasyon kapasitesi vb.) sonraki bir iyileştirme turuna bırakılabilir.
