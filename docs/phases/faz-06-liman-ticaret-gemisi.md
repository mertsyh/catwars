# Faz 6 — Liman + Ticaret Gemisi

**Bağımlılık:** yok (mevcut placeholder daire harita bile bir su halkasına sahip, bu yeterli)
**Boyut:** Büyük — deniz/lojistik katmanının temeli, ilk hareketli birim türü, ilk pathfinding kodu.

## Amaç

Şu ana kadar tek kaynağımız toprağa bağlı pasif altın (`GOLD_PER_TILE_PER_TICK`) ve şehir binası. Liman + ticaret gemisi, **aktif olmayan ama toprağın ötesinde bir ekonomi katmanı** ekliyor: kıyı bölgesine yatırım yapan oyuncu, otomatik çalışan bir ticaret ağından pasif gelir kazanır. Bu aynı zamanda Faz 7 (savaş gemisi), Faz 9 (çoklu harita/deniz haritaları) ve Faz 13'ün (tren) üzerine kurulacağı "su üstünde hareket eden birim" desenini kurar.

## OpenFront'ta nasıl çalışıyor (tasarım referansı)

Kamuya açık rehberlere göre (openfront.fyi, openfront.miraheze.org — kod incelenmedi): oyuncular kıyı tile'larına **Liman** inşa eder; ilk liman ucuzdur, bir oyuncunun ikinci/üçüncü limanı katlanarak pahalılaşır. Limanlar arasında otomatik **ticaret gemileri** doğar ve iki liman arasında mekik dokur; varışta **her iki ucun sahibine** mesafeyle orantılı (mesafe arttıkça orantısız artan) altın verir — bu, uzak müttefiklerle ticareti teşvik eder. Düşman savaş gemileri ticaret gemilerini yakalayıp yok edebilir/gasp edebilir. Aynı anda sistemde bulunabilecek toplam gemi sayısı bir tavanla sınırlıdır.

## Bizim oyuna nasıl uyarlanacak

- "Kıyı bölgesi" kavramı: bir `RegionMeta`, en az bir tile'ı `Terrain.Water`'a bitişik olan bir land tile içeriyorsa kıyı sayılır. Bunu region üretiminden sonra bir kere hesaplayıp `RegionMeta.isCoastal: boolean` olarak ekle.
- Ticaret gemisi, bölge değil **su tile grid'i üzerinde** hareket eden ilk varlık. Bu yüzden ilk kez gerçek bir su pathfinding'ine ihtiyaç var: `src/core/pathfinding.ts` içinde `findWaterPath(map, fromTile, toTile): number[]` (BFS, çünkü tile maliyeti düz — A* şart değil).
- Sunucu her tick'te gemi pozisyonu yayınlamak yerine (bant genişliği israfı), gemi doğduğunda `path + spawnTick + speed` bir kere gönderilir; istemci `(currentTick - spawnTick) * speed` ile pozisyonu lokal interpole eder. Bu desen Faz 7/13'te de tekrar kullanılacak (bkz. [README](README.md) "Genel mimari hatırlatması").

## Veri modeli değişiklikleri

**`src/core/types.ts`**
```ts
BuildingType.Port = "port"   // BuildingType union'a ekle

interface TradeShip {
  id: number;
  ownerId: number;        // gemiyi doğuran oyuncu (kaynak liman sahibi)
  fromPortBuildingId: number;
  toPortBuildingId: number;
  toOwnerId: number;      // hedef liman sahibi (gelir bu ikisine paylaşılır)
  path: { x: number; y: number }[];
  spawnTick: number;
  speedTilesPerTick: number;
  goldValue: number;      // varışta ikiye bölünüp dağıtılacak toplam
}
```

**`src/core/protocol.ts`**
- `TickMessage` ve `InitMessage`'a `tradeShips: TradeShipDTO[]` ekle (aktif gemilerin `path`/`spawnTick`/`speed` bilgisi — sadece doğuş/yok oluşta değişir, tam DTO'yu her tick tekrar yollamak yerine `TileChangeDTO` deseniyle sadece `spawned`/`arrived`/`destroyed` event'leri yayınlanabilir).
- `BuildMessage.buildingType` union'a `"port"` ekle.

**`src/core/constants.ts`** — aşağıdaki "Denge sabitleri" tablosuna bak.

## Sunucu değişiklikleri

- `GameMap.ts` / `regions.ts`: bölge üretiminden sonra `isCoastal` hesapla.
- `GameState.ts`:
  - `build` handler: `"port"` tipi sadece kıyı bölgesindeki tile'a izin versin; maliyeti oyuncunun mevcut liman sayısına göre katlanarak hesapla (bkz. tablo).
  - Yeni `tradeShips: Map<number, TradeShip>` state'i + her tick: (a) yeni gemi doğurma zamanlayıcısı (rastgele bir liman çifti seç, ağırlık = 1/mesafe değil, mesafeyle **orantılı** gelir teşvik ediyorsa seçim ağırlığı düz rastgele kalabilir), (b) mevcut gemilerin ilerlemesini kontrol et, path sonuna ulaşanlara altın öde ve state'ten sil.
  - `MAX_TRADE_SHIPS` tavanına ulaşıldıysa yeni doğuş atlanır.
- `server/index.ts`: yeni `tradeShips` alanını broadcast payload'ına ekle.

## İstemci değişiklikleri

- `renderer.ts`: liman ikonu (bölge içindeki kıyı tile'ında), hareket eden gemi için küçük bir üçgen/nokta + `spawnTick`'ten interpole edilen pozisyon.
- `main.ts`: alt bina barına "Liman" seçeneği ekle; sadece geçerli (kıyı) hedef üzerinde hover'da yeşil vurgu göster (mevcut hover-renk mantığına ek kural).

## Denge sabitleri (başlangıç önerisi)

Mevcut ölçek `CITY_COST=300`, `DEFENSE_POST_COST=200` referans alınarak türetildi — OpenFront'un 125.000→1.000.000 altın liman maliyetleri bizim ekonomimize doğrudan taşınamaz (oran olarak limanın şehirden ~1.5-2x pahalı olması fikri korundu).

| Sabit | Önerilen değer | Anlamı |
|---|---|---|
| `PORT_COST_BASE` | 450 | ilk liman maliyeti |
| `PORT_COST_MULTIPLIER` | 2 | her ek liman için çarpan |
| `PORT_COST_CAP` | 3600 | maliyetin katlanmasının duracağı tavan |
| `TRADE_SHIP_SPAWN_INTERVAL_TICKS` | 40 (≈4 sn) | limanı olan oyuncu başına ortalama doğuş aralığı |
| `TRADE_SHIP_SPEED_TILES_PER_TICK` | 1.5 | gemi hızı |
| `TRADE_SHIP_BASE_GOLD` | 15 | sabit taban gelir |
| `TRADE_SHIP_GOLD_PER_TILE` | 0.4 | mesafeye bağlı ek gelir (düz orantılı; süper-lineer OpenFront varyasyonu ileride eklenebilir, bkz. Açık sorular) |
| `MAX_TRADE_SHIPS` | 12 | sahnede aynı anda olabilecek toplam gemi (1-2 oyuncu + bot ölçeği için) |

## Yapılacaklar (checklist)

- [ ] `RegionMeta.isCoastal` hesapla ve `MapMessage`'a ekle
- [ ] `src/core/pathfinding.ts`: `findWaterPath` (BFS)
- [ ] `types.ts`: `BuildingType.Port`, `TradeShip` tipi
- [ ] `protocol.ts`: `TradeShipDTO`, tick/init mesajlarına ekleme, `BuildMessage` union güncelle
- [ ] `constants.ts`: yukarıdaki sabitler
- [ ] `GameState.ts`: liman inşası (katlanan maliyet), gemi doğuş/ilerleme/varış tick mantığı
- [ ] `server/index.ts`: broadcast payload'ına `tradeShips` ekle
- [ ] `renderer.ts`: liman ikonu + hareketli gemi çizimi (interpolasyon)
- [ ] `main.ts`: bina barına "Liman" ekle, kıyı-only hover kuralı

## Kabul kriterleri

- Kıyı bölgesine liman inşa edilebiliyor, kıyı olmayan bölgeye inşa engelleniyor.
- En az iki limanlı oyuncu (veya oyuncu+bot) arasında gemiler otomatik doğup suyun üzerinde limandan limana hareket ediyor.
- Gemi varışta her iki liman sahibine altın veriyor, oyuncu paneli altın artışını gösteriyor.
- Aynı anda `MAX_TRADE_SHIPS` üstünde gemi oluşmuyor.

## Açık sorular / riskler

- **Süper-lineer mesafe geliri** (OpenFront'taki `10000 + 150×mesafe^1.1` deseni): bizim ölçekte anlamlı fark yaratır mı, yoksa düz orantı yeterli mi? İlk sürümde düz orantı ile başla, oynanış testiyle karar ver.
- Bot AI liman inşa etmeli mi (Faz 6 kapsamında mı, yoksa bot AI'ya ayrı bir küçük iyileştirme mi)? Öneri: bu fazda bot'lara da basit "kıyı bölgesi varsa limanı inşa et" kuralı eklensin, yoksa insan oyuncu hep tek taraflı ticaret ağı kurar.
- Su bağlantısızlığı: placeholder daire haritada tüm su tek bir bileşen, ama Faz 8/9'daki gerçek haritalarda ayrık denizler/göller olabilir — `findWaterPath` başarısız (yol yok) durumunu zaten döndürmeli, gemi doğuşu bu durumda o liman çiftini atlamalı.
