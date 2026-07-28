# Faz 7 — Savaş Gemisi + Deniz Savaşı

**Bağımlılık:** Faz 6 (liman, ticaret gemisi, su pathfinding, `TradeShip`/interpolasyon deseni)
**Boyut:** Orta-Büyük — ilk oyuncu-kontrollü hareketli birim, ilk gerçek zamanlı birim-vs-birim çatışma.

## Amaç

Faz 6 ticareti pasif bıraktı; bu faz onu **riske** sokuyor. Savaş gemisi, oyuncunun aktif olarak yönlendirdiği ilk birim: ticaret yollarını koruma/kesme, kıyı bölgelerini bombalama. Deniz katmanına askeri boyut ekler ve mevcut kara-savaşı (kuşatma) mekaniğinden ayrı, gerçek zamanlı bir çatışma sistemi kurar.

## OpenFront'ta nasıl çalışıyor (tasarım referansı)

Rehber sayfalarına göre: savaş gemisi pahalı bir birim, bir oyuncunun sahip olduğu gemi sayısı arttıkça bir sonrakinin maliyeti de artıyor (fiyat tavana kadar katlanıyor). Sabit bir can puanı var, mermi başına sabit hasar veriyor, canı bir eşiğin altına düşünce otomatik en yakın limana geri çekilip onarılıyor. Düşman ticaret gemilerine değince onları avlıyor/ele geçiriyor (v24'te transport/ticaret gemisi hedef önceliği yükseltilmiş). Kıyı savunma yapıları da menzildeki gemilere mermi atabiliyor.

## Bizim oyuna nasıl uyarlanacak

- Savaş gemisi, mevcut "bölgeye tıkla → kuşatma kuyruğa gir" desenine **uymuyor** — bu ilk kez bir birimin serbest `(x, y)` koordinatında var olduğu ve oyuncunun onu suyun **herhangi bir noktasına** yönlendirebildiği mekanik. Yeni bir input modu gerekiyor: "gemi seç → hedef su tile'ına tıkla → hareket emri".
- Çatışma çözümü tamamen yeni bir tick-bazlı alt sistem: `resolveNavalCombat(state)` — her tick, birbirine menzil içindeki düşman gemi çiftlerini bulur, hasar uygular, HP 0 olanı yok eder, eşik altına düşeni limana geri döndürür.
- Ticaret gemisi yakalama: `GameState`'teki gemi ilerleme kontrolüne, "bu tile'da düşman savaş gemisi var mı" kontrolü eklenir; varsa ticaret gemisi el değiştirir (mevcut sahibine gitmesi gereken altın yerine yakalayana tek seferlik bonus ödeme yapılır) ya da yok edilir (basitlik için: **yok et + yakalayana sabit bonus altın**, "gemiyi devral" mekaniği bu fazda opsiyonel — bkz. Açık sorular).

## Veri modeli değişiklikleri

**`src/core/types.ts`**
```ts
interface Warship {
  id: number;
  ownerId: number;
  homePortBuildingId: number;
  x: number; y: number;          // mevcut pozisyon (sunucu otoritesi)
  hp: number;
  maxHp: number;
  state: "idle" | "moving" | "returning";
  targetX?: number; targetY?: number;
  path?: { x: number; y: number }[];
}
```

**`src/core/protocol.ts`**
```ts
interface BuildWarshipMessage { type: "buildWarship"; portBuildingId: number; }
interface MoveShipMessage { type: "moveShip"; shipId: number; targetX: number; targetY: number; }
```
`ClientMessage` union'a ekle. `TickMessage`/`InitMessage`'a `warships: WarshipDTO[]` (pozisyon + hp) ekle — savaş gemileri ticaret gemisinin aksine oyuncu emriyle rota değiştirebildiği için pozisyonu ticaret gemisinden daha sık senkronlamak gerekebilir (öneri: yine `path+spawnTick` yayınla, ama oyuncu yeni hedef verince path'i **yeniden yayınla**, sürekli tick başına x/y yayınlama).

## Sunucu değişiklikleri

- `GameState.ts`:
  - `buildWarship`: sadece kendi limanından, katlanan maliyetle inşa; `WARSHIP_BUILD_TICKS` boyunca "inşa halinde" (limanda bekler, savunmasız).
  - `moveShip`: hedefe `findWaterPath` ile rota hesapla, `state="moving"`.
  - Yeni tick fazı `resolveNavalCombat`: mesafe ≤ `WARSHIP_RANGE` olan düşman çiftlerine `WARSHIP_DAMAGE_PER_TICK` uygula; HP ≤ `WARSHIP_RETREAT_HP_FRACTION × maxHp` olanı otomatik en yakın kendi limanına döndür (`state="returning"`); HP ≤ 0 olanı sil.
  - Ticaret gemisi ilerleme kontrolüne düşman savaş gemisi çakışması ekle (yukarıda açıklandığı gibi yok et + bonus).
- `server/index.ts`: `warships` alanını broadcast'e ekle, yeni mesaj tiplerini yönlendir.

## İstemci değişiklikleri

- `renderer.ts`: gemi ikonu (yön/rota göstermek için basit üçgen), üstünde ince HP çubuğu, geri çekilirken farklı renk/ikon durumu.
- `main.ts`: gemiye tıklayınca "seçili" state'e al (görsel halka), sonra suya tıklayınca `moveShip` yolla; sağ tık seçimi iptal etsin (mevcut sağ-tık = iptal deseniyle tutarlı).

## Denge sabitleri (başlangıç önerisi)

| Sabit | Önerilen değer | Anlamı |
|---|---|---|
| `WARSHIP_COST_BASE` | 800 | ilk savaş gemisi maliyeti |
| `WARSHIP_COST_INCREMENT` | 400 | her ek gemi için artış (katlanma değil, doğrusal artış — OpenFront'un agresif katlanması bizim küçük oyuncu sayımızda çok hızlı erişilemez hale getirir) |
| `WARSHIP_COST_CAP` | 3000 | maliyet tavanı |
| `WARSHIP_BUILD_TICKS` | 30 (3 sn) | inşa süresi |
| `WARSHIP_MAX_HP` | 200 | can puanı |
| `WARSHIP_DAMAGE_PER_TICK` | 20 | menzildeki düşmana tick başına hasar |
| `WARSHIP_RANGE` | 6 (tile) | çatışma/mermi menzili |
| `WARSHIP_SPEED_TILES_PER_TICK` | 1.2 | hareket hızı |
| `WARSHIP_RETREAT_HP_FRACTION` | 0.3 | bu oranın altında otomatik geri çekilme |
| `TRADE_SHIP_CAPTURE_BONUS_GOLD` | 100 | düşman ticaret gemisini yok edince bonus |

## Yapılacaklar (checklist)

- [ ] `types.ts`: `Warship` tipi
- [ ] `protocol.ts`: `BuildWarshipMessage`, `MoveShipMessage`, `WarshipDTO`, tick/init entegrasyonu
- [ ] `constants.ts`: yukarıdaki sabitler
- [ ] `GameState.ts`: inşa, hareket, `resolveNavalCombat`, ticaret gemisi avlama
- [ ] `server/index.ts`: yeni mesajları yönlendir, `warships` broadcast'e ekle
- [ ] `renderer.ts`: gemi çizimi + HP çubuğu
- [ ] `main.ts`: gemi seçme/hareket ettirme input akışı

## Kabul kriterleri

- Limanda savaş gemisi inşa edilip suya hareket ettirilebiliyor.
- İki düşman gemisi menzile girince otomatik hasarlaşıyor, biri yok oluyor ya da düşük HP'de limana kaçıyor.
- Savaş gemisi bir düşman ticaret gemisinin yoluna girince onu yok edip bonus altın kazanıyor.

## Açık sorular / riskler

- **Gemi ele geçirme vs. yok etme**: OpenFront'ta yakalanan ticaret gemisi el değiştiriyor (kargo değeri kadar altın kazandırıyor). Basitlik için ilk sürümde "yok et + sabit bonus" öneriliyor; ele geçirip yeniden yönlendirme (kargo değerini kazanana ödeme) ileride küçük bir iyileştirme olarak eklenebilir.
- Kıyı savunma yapılarının (mevcut `DefensePost`) gemilere ateş etmesi bu fazın kapsamında mı? Öneri: hayır, ayrı bir küçük ek faz olarak sonraya bırakılsın — bu faz sadece gemi-vs-gemi çatışmaya odaklansın.
- Bot AI'nin savaş gemisi kullanması: Faz 6'daki gibi, bot'lara "ticaret gemin saldırı altındaysa/limanın tehdit altındaysa gemi inşa et" gibi çok basit bir kural eklenebilir; tam taktik AI bu fazın kapsamı dışında.
