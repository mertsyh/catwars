# OpenFrontClone — Proje Durumu

OpenFront.io / territorial.io tarzı, tarayıcı tabanlı, gerçek zamanlı çok oyunculu bir toprak fetih oyununun küçük ölçekli (1-2 oyuncu + botlar) klonu. Bu dosya, o ana kadar neyin yapıldığını ve bundan sonra nereye gidilmek istendiğini özetler — yeni bir konuşmada kaldığımız yerden devam edebilmek için.

## Teknoloji Yığını

- **TypeScript** (tüm proje), **Vite** (client dev server/build), **Node.js + `ws`** (server), **tsx** (server'ı TS olarak doğrudan çalıştırmak için)
- Paket yöneticisi: npm. `npm run dev` hem client (5173) hem server'ı (3000) `concurrently` ile başlatır.
- Node.js kurulu ama sistem PATH'ine eklenmemişti; kullanıcı `PATH`'ine kalıcı olarak eklendi (`C:\Program Files\nodejs`).

## Mimari

```
src/
  core/     → paylaşılan, deterministik oyun mantığı (client + server ikisi de import eder)
  client/   → Vite giriş noktası, Canvas2D render, input/UI (Node'suz, tarayıcıda çalışır)
  server/   → WebSocket sunucusu, tick döngüsü, bot AI
```

`core` katmanı render veya network'ten tamamen bağımsızdır — bu sayede hem server (yetkili simülasyon) hem de gelecekte client-side prediction aynı kodu paylaşabilir.

### `core` dosyaları
- `GameMap.ts` — terrain (kara/deniz) ızgarası, `owner` (tile→oyuncu) ve `regionOf` (tile→bölge) dizileri. `fromTerrain()` (Faz 8) önceden üretilmiş bir terrain grid'inden kurar — sunucu bunu `resources/maps/<id>.json` ile kullanıyor (Faz 9: hangi `id` seçildiğine göre). `generateIsland()` placeholder/"Rastgele Ada" dairesel üretimi, dosya yoksa fallback olarak da korunuyor.
- `maps.ts` (Faz 9) — `MAP_REGISTRY` (istemcinin harita seçim dropdown'ında ve sunucunun `mapId` doğrulamasında kullandığı ortak liste), `WORLD_MAP_SPECS` (build-time bbox'lar), `DEFAULT_MAP_ID`, `RANDOM_ISLAND_MAP_ID`.
- `regions.ts` — Voronoi tabanlı bölge üretimi (`generateRegions`): rastgele + Lloyd gevşetmeli tohum noktalarından ~80 dengeli "ülke" bölgesi, komşuluk grafiği, merkez koordinatı.
- `civilizationNames.ts` — bölgelere atanan ~108 tarihi medeniyet/ülke ismi havuzu.
- `Player.ts` — oyuncu kaynakları (asker, altın, toprak sayısı, şehir sayısı) ve `maxTroops` hesaplaması.
- `GameState.ts` — **oyunun kalbi**: oyuncu ekleme/çıkarma, bölge doğuşu, kuşatma (siege) sistemi, bina inşası, tick döngüsü, kazanma koşulu.
- `protocol.ts` — client↔server WebSocket mesaj tipleri.
- `constants.ts` — tüm denge sabitleri (aşağıda).

### `server/index.ts`
- Harita + bölgeleri bir kere üretir, `GameState` oluşturur.
- 3 bot spawn eder, her 800ms'de bot'lara rastgele komşu bölge saldırısı yaptırır.
- WebSocket bağlantılarını `Player`'a eşler, `join`/`attack`/`build`/`cancelAttacks` mesajlarını işler.
- 10 tick/saniye ana döngü: `GameState.tickOnce()` çağırır, değişiklikleri tüm client'lara yayınlar.

### `client/` 
- `renderer.ts` — Canvas2D üzerinde sürekli `requestAnimationFrame` döngüsü ile çizim: tile renklendirme (kuşatma ilerledikçe gerçek tile renkleri anlık güncellenir, ayrı bir "kuşatma ilerleme" overlay'i yok), bölge sınırları (koyu ton), bölge isim etiketleri, bina ikonları, hover vurgusu, tıklama ripple animasyonu, kamera (pan/zoom).
- `main.ts` — WebSocket bağlantısı, input yönetimi (sürükle=pan, tekerlek=zoom, tık=saldır/inşa, sağ tık=iptal), UI paneli, bina barı.

## Şu An Çalışan Oyun Mekaniği

1. **Harita**: 400×300 tile'lık placeholder dairesel ada, ~80 **bölgeye** (ülkeye) bölünmüş. Her bölge rastgele bir medeniyet ismi taşır (Roma, Peçenek, Sriwijaya, Kuş, ...), boyutları kabaca dengeli.
2. **Doğuş**: Her oyuncu (insan veya bot) rastgele nötr bir bölgeye tüm gücüyle sahip olarak başlar — "herkes aynı boyda başlar" prensibi.
3. **Kaynaklar**: Asker (troops, saldırı/savunma için harcanır) ve Altın (pasif, toprağa bağlı birikir, henüz sadece bina inşasında kullanılıyor).
4. **Saldırı = Orantılı Parçalı Kuşatma**: Sınıra bitişik bir bölgeye tıklayınca o bölgeye **kuşatma emri** kuyruklanır. Kuşatma artık bölgenin TAMAMINI alana kadar beklemek zorunda bırakmıyor — her tick harcanan asker gücüyle orantılı sayıda tile, saldırganın sınırından içeri BFS sırasıyla **anında saldırgana geçiyor** (bölge birden fazla oyuncu arasında bölünebilir; bkz. `docs/phases/`de olmayan, kullanıcı isteğiyle sonradan eklenen bu mekanik için `GameState.ts`'teki `computeCaptureOrder`/`tickOnce`). Çok askerin varsa bölge birkaç tick'te büyük ölçüde senin olur; az askerle sadece küçük bir dilim alırsın ve geri kalanı almak için asker biriktirip devam etmen gerekir.
   - Aynı bölgeye tekrar tıklamak (veya sınırındaki başka bir tile'a) mevcut kuşatmayı **boost**'lar (hız çarpanı artar, max 4x).
   - Sağ tık, o oyuncunun **tüm aktif kuşatmalarını iptal** eder (o ana kadar alınmış tile'lar sende kalır, sadece geri kalanı almaktan vazgeçmiş olursun).
   - Düşman bölgesi kuşatmak nötr bölgeden **1.5x** daha pahalıdır (kuşatma başlarken donar, bölgenin çoğunluk sahibi kuşatma sırasında değişse bile sabit kalır).
   - Zaten tamamen sahip olduğun bir bölgeye tekrar saldıramazsın; kısmen sahip olduğun bir bölgeye (başka bir saldırgandan devraldığın ya da yarım bıraktığın) devam saldırısı yapabilirsin.
5. **Binalar**: Ekranın altındaki bar'dan Şehir (300 altın, +50 asker kapasitesi) veya Savunma Karakolu (200 altın, bulunduğu bölgede başlayacak yeni kuşatmaların savunmasına +80 katkı sağlar) seçilir, sonra haritada kendi tile'ınıza tıklanır. Bir tile ele geçirilirse üzerindeki bina yıkılır (karakol yıkılırsa bölgenin savunma bonusu da otomatik düşer).
6. **Bot AI**: 3 bot, periyodik olarak sahip oldukları bölgelerin rastgele bir komşusuna kuşatma başlatır — insan oyuncuyla aynı `queueAttack` API'sini kullanır.
7. **Kazanma koşulu**: Toprağın %72'sini kontrol eden oyuncu kazanır.
8. **Kamera/kontroller**: Doğuşta oyuncunun bölgesine otomatik zoom, fare tekerleğiyle zoom (imlece göre), sürükleyerek pan, hover'da geçerli/geçersiz hedef rengi (yeşil/kırmızı/beyaz), her tıklamada anlık ripple animasyonu (görsel geri bildirim).
9. **Liman + Ticaret Gemisi** (Faz 6): kıyı bölgesindeki bir tile'a Liman (450 altın, her ek liman 2x pahalılaşır, tavan 3600) inşa edilebilir. Limanı olan oyuncular arasında periyodik olarak otomatik **ticaret gemileri** doğar, su üzerinde BFS ile bulunmuş rotayı takip ederek karşı limana ulaşır ve varışta her iki liman sahibine altın öder. Bot'lar da düşük olasılıkla liman inşa eder.
10. **Savaş Gemisi + Deniz Savaşı** (Faz 7): limanda Savaş Gemisi (800 altın, her ek gemi +400, tavan 3000; 3 sn inşa süresi) inşa edilip suyun herhangi bir noktasına yönlendirilebilir (gemiye tıkla=seç, suya tıkla=hareket ettir, sağ tık=seçimi iptal et). Menzile giren düşman gemileri otomatik hasarlaşır; HP %30'un altına düşen gemi en yakın kendi limanına kaçıp onarılır, HP 0'a inen gemi yok olur. Düşman savaş gemisi, geçiş yolundaki (ilişkisiz) ticaret gemilerini yakalayıp yok edebilir ve bonus altın kazanır.
11. **Gerçek Dünya Haritası** (Faz 8): placeholder dairesel ada yerine gerçek bir kıyı şeridi — Natural Earth'ün public domain `ne_50m_land` kara poligonu verisinden (`resources/geo-source/`, gitignore'da) Avrupa bbox'ı (`lon -25..45, lat 34..72`) 400×300 tile'a scanline (even-odd) yöntemiyle rasterize ediliyor. `scripts/build-map.ts` (`npm run build:maps`) çıktıyı `resources/maps/europe.json`'a yazıyor; sunucu açılışta bunu okuyor, dosya yoksa placeholder daireye düşüyor.
12. **Çoklu Harita Desteği** (Faz 9): `src/core/maps.ts`'te `MAP_REGISTRY` (Avrupa, Afrika, Kuzey Amerika, Dünya + prosedürel "Rastgele Ada") ve build-time `WORLD_MAP_SPECS` (bbox'lar) tek kaynaktan tanımlanıyor; `scripts/build-map.ts` artık bu listedeki her bölge için ayrı `resources/maps/<id>.json` üretiyor. İstemci artık bağlanmadan önce bir harita seçim ekranı gösteriyor (`index.html`'deki `#startScreen`), seçilen `mapId` `join` mesajıyla sunucuya gidiyor. Sunucu, harita + `GameState`'i (ve bot'ları) artık açılışta değil **ilk oyuncu katıldığında** kuruyor — böylece o oyuncunun seçtiği harita geçerli oluyor; oyun bir kez kurulduktan sonra gelen farklı `mapId`'ler yok sayılıp mevcut harita kullanılıyor (tarayıcıda iki sekmeyle doğrulandı).

## Denge Sabitleri (`src/core/constants.ts`)

| Sabit | Değer | Anlamı |
|---|---|---|
| `TICK_RATE` | 10 | saniyede tick sayısı |
| `STARTING_TROOPS` | 60 | başlangıç asker |
| `BASE_MAX_TROOPS` / `TROOPS_PER_TILE` | 100 / 0.5 | asker kapasitesi = 100 + toprak×0.5 |
| `TROOP_REGEN_PER_TICK` | 0.5 | asker rejenerasyonu |
| `REGION_COUNT` | 80 | bölge sayısı |
| `BASE_GARRISON` / `GARRISON_PER_TILE` | 50 / 0.3 | tek bir kuşatmanın (hedeflediği tile'lar için) savunması = 50 + tile×0.3 + karakol bonusu — artık bölge üzerinde kalıcı değil, her yeni kuşatma başında anlık hesaplanır |
| `SIEGE_DAMAGE_PER_TICK` | 4 | temel kuşatma hasarı (boost ile çarpılır) |
| `ENEMY_SIEGE_COST_MULTIPLIER` | 1.5 | düşman bölgesi kuşatma maliyet çarpanı |
| `MAX_BOOST` | 4 | maksimum hızlandırma çarpanı |
| `WIN_LAND_FRACTION` | 0.72 | kazanma eşiği |
| `CITY_COST` / `CITY_TROOP_BONUS` | 300 / +50 | şehir maliyeti / bonusu |
| `DEFENSE_POST_COST` / `..._GARRISON_BONUS` | 200 / +80 | karakol maliyeti / bonusu |
| `PORT_COST_BASE` / `_MULTIPLIER` / `_CAP` | 450 / 2x / 3600 | liman maliyeti (her ek liman katlanır) |
| `MAX_TRADE_SHIPS` | 12 | aynı anda var olabilecek ticaret gemisi |
| `TRADE_SHIP_SPAWN_INTERVAL_TICKS` | 40 (4 sn) | liman başına doğuş denemesi aralığı |
| `TRADE_SHIP_SPEED_TILES_PER_TICK` | 1.5 | gemi hızı |
| `TRADE_SHIP_BASE_GOLD` / `_GOLD_PER_TILE` | 15 / 0.4 | varış geliri = 15 + mesafe×0.4 (iki sahibe yarı yarıya) |
| `TRADE_SHIP_CAPTURE_BONUS_GOLD` | 100 | düşman ticaret gemisi yakalanınca bonus |
| `WARSHIP_COST_BASE` / `_INCREMENT` / `_CAP` | 800 / +400 / 3000 | savaş gemisi maliyeti (doğrusal artış) |
| `WARSHIP_BUILD_TICKS` | 30 (3 sn) | inşa süresi |
| `WARSHIP_MAX_HP` / `_DAMAGE_PER_TICK` | 200 / 20 | can puanı / menzildeki düşmana tick başına hasar |
| `WARSHIP_RANGE` / `_CAPTURE_RANGE` | 6 / 3 (tile) | çatışma menzili / ticaret gemisi yakalama menzili |
| `WARSHIP_SPEED_TILES_PER_TICK` | 1.2 | hareket hızı |
| `WARSHIP_RETREAT_HP_FRACTION` | 0.3 | bu oranın altında otomatik geri çekilme |

## Geliştirme Süreci (kronolojik özet)

1. **Faz 0** — Proje iskeleti: TS + Vite + WS server, placeholder dairesel ada, uçtan uca "harita client'a ulaşıyor" doğrulaması.
2. **Faz 2** — İlk oyun döngüsü: tile-flood tabanlı toprak fethi (tıkla → BFS ile komşu tile'ları yut), asker/altın kaynakları, çok oyunculu senkron.
3. **Faz 4** — Basit bot AI (rastgele sınır hedefi seçip saldırma).
4. **Faz 5** — Şehir binası (asker kapasitesi bonusu).
5. **Savunma Karakolu** — ikinci bina türü, önce tile-yarıçapı tabanlı savunma çarpanı olarak eklendi.
6. **UX düzeltmesi** — kullanıcı geri bildirimi: "tıklayınca bir şey olmuyor, görsel geri dönüş yok". Kök neden: harita her zaman tam ekrana sığdırılıyordu, doğum bölgesi görünmüyordu. Çözüm: kamera pan/zoom, doğuşta otomatik odaklanma, hover vurgusu, tıklama ripple animasyonu.
7. **Saldırı mekaniği yeniden tasarımı** — kullanıcı geri bildirimi: "kendi kendine etrafa saldırıyor, sadece isteğime göre saldırmalıyım, iptal edebilmeliyim, hızlandırabilmeliyim". Tile-flood sınırsızdı; her tıklamayı **60 tile'lık sabit kapasiteli, iptal edilebilir, tekrar tıklamayla hızlanan emirlere** dönüştürdük.
8. **Bölge tabanlı büyük revizyon** — kullanıcı isteği: haritanın rastgele sınırlı, isimli "ülke" bölgelerinden oluşması, saldırının piksele değil bölgeye yapılması, herkesin aynı boyda başlaması, binalar için alt bar. Tile-flood tamamen kaldırıldı, yerine Voronoi bölge + garrison/kuşatma sistemi geldi.
9. **Faz 6 — Liman + Ticaret Gemisi** — [docs/phases/faz-06-liman-ticaret-gemisi.md](docs/phases/faz-06-liman-ticaret-gemisi.md) planına göre uygulandı: `RegionMeta`/`GameMap`'e kıyı tile tespiti, `src/core/pathfinding.ts`'te su üzerinde BFS rota bulma, `Port` binası (katlanan maliyet), `TradeShip` varlığı (doğuş/ilerleme/varış, istemci tarafında `spawnTick`+hız'dan lokal interpolasyon — her tick tam pozisyon yayınlanmıyor). Bot AI'ya düşük olasılıklı liman inşası eklendi.
10. **Faz 7 — Savaş Gemisi + Deniz Savaşı** — [docs/phases/faz-07-savas-gemisi-deniz-savasi.md](docs/phases/faz-07-savas-gemisi-deniz-savasi.md) planına göre uygulandı: `pathfinding.ts` genelleştirildi (`findWaterPath` → `findShipRoute`, kara/su herhangi bir kombinasyonu kabul eder; artı paylaşılan `positionAlongPath` — hem sunucu çarpışma/yakalama menzil kontrolü hem istemci render'ı aynı fonksiyonu kullanır). `Warship` varlığı (inşa→boşta→hareket→dönüş durum makinesi), oyuncu kontrollü hedefleme (gemiye tıkla=seç, suya tıkla=hareket ettir), tick-bazlı `resolveNavalCombat` (düşman çiftleri menzildeyken hasarlaşır, düşük HP'de otomatik geri çekilme, HP 0'da yok olma) ve `captureTradeShips` (düşman ticaret gemisini yakalayana bonus altın) eklendi.
11. **Faz 8 — Gerçek Dünya Haritası** — [docs/phases/faz-08-gercek-dunya-haritasi.md](docs/phases/faz-08-gercek-dunya-haritasi.md) planına göre uygulandı: `GameMap.fromTerrain()` (Node/fs'ten bağımsız, saf veri fabrikası — `core` katmanının client'ta da import edilebilir kalması için dosya okuma işi `server/index.ts`'e bırakıldı). `scripts/build-map.ts`, Natural Earth `ne_50m_land` (public domain, `resources/geo-source/`'a indirilir, commit'lenmez) verisinden Avrupa bbox'ını even-odd scanline algoritmasıyla rasterize edip `resources/maps/europe.json`'a yazıyor (`npm run build:maps`). Sunucu açılışta bu dosyayı okuyor; yoksa placeholder daireye düşüyor.
12. **Faz 9 — Çoklu Harita Desteği** (mevcut durum) — [docs/phases/faz-09-coklu-harita.md](docs/phases/faz-09-coklu-harita.md) planına göre uygulandı: `src/core/maps.ts` eklendi (`MAP_REGISTRY`, `WORLD_MAP_SPECS`, `DEFAULT_MAP_ID`, `RANDOM_ISLAND_MAP_ID`); `scripts/build-map.ts` tek sabit `REGIONS` dizisi yerine bu ortak listeyi kullanacak şekilde genelleştirildi. 5 harita: Avrupa (mevcut), Afrika, Kuzey Amerika, Dünya (tüm gezegen, `lon -180..180`) + prosedürel "Rastgele Ada". `protocol.ts`'teki `JoinMessage`'a opsiyonel `mapId` eklendi. `server/index.ts` büyük ölçüde refaktör edildi: harita + `GameState` artık modül yüklenirken değil, `ensureGame()` içinde **ilk `join` mesajında** kuruluyor (bot spawn'ı da buna taşındı); DTO fonksiyonları (`toDTO`, `toBuildingDTOs`, vb.) modül-seviyesi değişken yerine `state` parametresi alacak şekilde değiştirildi (null-safety için), iki `setInterval` (bot AI, tick döngüsü) `instance` null kontrolü ile korunuyor. İstemciye (`index.html` + `main.ts`) bağlanmadan önce gösterilen bir `#startScreen` (harita dropdown + "Oyuna Katıl" butonu) eklendi; WebSocket bağlantısı artık sayfa yüklenince değil, bu butona tıklanınca açılıyor ve seçilen `mapId` `join` mesajına ekleniyor. İki ayrı tarayıcı sekmesiyle uçtan uca doğrulandı: ilk sekme "Afrika" seçip oyunu kurdu, ikinci sekme "Kuzey Amerika" seçmesine rağmen zaten kurulu olan Afrika haritasına katıldı (spesifikasyondaki "oyun kurulduysa mapId yok sayılır" davranışı).
    - **Takip düzeltmesi (aynı faz içinde, kullanıcı geri bildirimiyle):** ilk sürümde Afrika/Kuzey Amerika kıtaları bbox'a çok sıkı oturtulmuştu (kıyı şeridi harita ızgarasının kenarına neredeyse değiyordu) — bu, o bölgeye yakınlaşan bir oyuncunun ekranının bir kısmının harita dışına (siyah arka plana) taşmasına yol açıyordu. Kök neden aslında `renderer.ts`'teki `clampCamera()`'ydı: kamerayı sadece `[0, width]` aralığına kırpıyordu, geçerli zoom'da görünür alanın (canvas/scale) haritadan büyük olup olmadığını hesaba katmıyordu. Düzeltme: `clampCamera()` artık zoom'a göre kamerayı harita kenarından en az yarım-viewport içeride tutuyor (harita görünür alandan küçükse o eksende ortalıyor — bu durum sadece bilinçli "zoom=1'de tüm haritayı göster" letterbox'ı için geçerli). Ayrıca kıta bbox'larına bolca boşluk eklendi (`src/core/maps.ts`) ve kullanıcının istediği **"Dünya"** (tüm gezegen, 570×220) haritası eklendi.
13. **Orantılı parçalı bölge alımı** (mevcut durum) — kullanıcı isteği: "bölgeyi almak için tıkladığımda ne kadar askerim varsa o kadarını alayım, tamamını alana kadar beklemek zorunda olmayalım". Yukarıdaki 8. maddedeki "bölge tabanlı büyük revizyon"un getirdiği **bölge bütünlüğü** (bölge = tek parça, tek sahip) ilkesi bilinçli olarak gevşetildi: bir bölge artık birden fazla oyuncu arasında bölünebilir.
    - `GameState.ts`: `Siege` artık `captureOrder` (saldırganın sınırından içeri BFS sırasıyla, henüz saldırgana ait olmayan tile'lar), `cursor`, kendi `garrison`/`maxGarrison`'ı ve donmuş `costMultiplier`'ı taşıyor — garrison artık bölgede değil, kuşatmada (her kuşatma kendi "fetih projesi"). Her tick, o an harcanan hasarın "satın aldığı" tile sayısı hesaplanıp `captureOrder`'dan o kadarı **anında** saldırgana geçiyor (tile'ın önceki sahibinin `tileCount`/asker/bina kaybı da o anda uygulanıyor) — bölgenin tamamen düşmesini beklemeye gerek yok.
    - `Region.garrison`/`maxGarrison` alanları kaldırıldı (artık `regions.ts`'de yok); `Region.ownerId` artık "tek sahip" değil, tile dağılımına bakılarak hesaplanan **çoğunluk sahibi** (`recomputeRegionOwner`) — sadece kaba bir gösterge.
    - `queueAttack`: "zaten sahibim" kontrolü tam bölge sahipliğine (`regionFullyOwnedBy`), "erişebiliyor muyum" kontrolü ise bölgenin kendisinde veya bir komşusunda en az bir tile'a sahip olmaya (`regionHasAnyTileOwnedBy`) göre değişti — böylece hem yarım bıraktığın bir bölgeyi bitirebiliyorsun hem de sadece bir köşeden (bölgenin tamamı değil) sıçrama yapabiliyorsun.
    - Savunma Karakolu artık bölgeye kalıcı bonus eklemiyor; her yeni kuşatmanın `maxGarrison`'ı, o bölgedeki MEVCUT karakol binalarına bakılarak anlık hesaplanıyor (`regionDefenseBonus`) — bina yıkılırsa bonus da otomatik gider.
    - Client tarafında artık gereksiz olan "yenilen tile" overlay sistemi (`computeEatOrder`/`eatOrderCache`, `renderer.ts`'teki `drawSiegeOverlays`) tamamen kaldırıldı — gerçek tile renkleri zaten anlık güncellendiği için ayrı bir sahte ilerleme efektine gerek kalmadı. Bina inşası / hover geçerliliği kontrolleri bölge çoğunluğu yerine doğrudan tile sahipliğine (`ownerByTile`) bakacak şekilde düzeltildi (aksi halde karışık bir bölgede yanlış tile'a inşaat izni verilebilirdi).
    - Tarayıcıda doğrulandı: küçük bir orduyla komşu bir bölgeye tıklayınca toprak sayısı **anında** (bir sonraki tick'te) artıyor, bot'ların kısmen fethettiği bölgeler haritada ince bir renkli şerit olarak görünüyor, tamamen sahip olunan bölgeye tekrar saldırı ve komşu olmayan bölgeye saldırı doğru şekilde reddediliyor.

## Bilinen ve Düzeltilen Hatalar

- **XSS açığı** (client, panel render): oyuncu isimleri `innerHTML` ile basılıyordu, kötü niyetli bir `join` mesajı script çalıştırabilirdi. `textContent` tabanlı güvenli DOM oluşturmaya çevrildi.
- **Genişleme zinciri kırılması** (tile-flood döneminde): bir tile zaten kendine aitse komşularını taramadan zincir kesiliyordu (iki emrin aynı noktada birleşmesi gibi durumlarda genişleme erken duruyordu). Düzeltildi.
- **Kuşatma sonsuz donması** (bölge modelinde, o dönemin hatası): asker azaldığında kuşatma hasarı bölgenin pasif garrison rejenerasyon hızına (0.5/tick) tam eşitlenip **sonsuza dek kilitleniyordu** — ikisi birbirini götürüyordu. O zamanki çözüm, kuşatma altındaki bölgelerin pasif rejenerasyon almaması oldu. Not: "orantılı parçalı bölge alımı" (13. madde) ile birlikte garrison artık bölgede kalıcı değil, her kuşatmaya özel ve hiç pasif rejenere olmuyor — bu hata sınıfı yapısal olarak imkânsız hale geldi (pozitif hasar her zaman kesin olarak azalır).
- **Kamera harita dışına taşıp siyah alan gösteriyordu** (Faz 9, kullanıcı geri bildirimiyle bulundu): `clampCamera()` zoom'u hesaba katmadan kamerayı `[0,width]`/`[0,height]`'e kırpıyordu; yakınlaştırılmış haldeyken kamera harita kenarına gidince ekranın bir kısmı haritanın dışına (siyah arka plana) taşıyordu — özellikle kıyı şeridi bbox kenarına yakın bölgelerde belirginleşiyordu. Düzeltildi: kırpma artık geçerli zoom'daki görünür alanı (canvas/scale) hesaba katıp kamerayı harita kenarından en az yarım-viewport içeride tutuyor.

## Bilinçli Basitleştirmeler / Sınırlamalar

- Gerçek dünya haritaları var (Avrupa, Afrika, Kuzey Amerika, Dünya) + prosedürel "Rastgele Ada" (Faz 8+9); OpenFront'un onlarca haritasıyla sayı yarışı hedeflenmiyor, bilinçli olarak 5 ile sınırlı tutuldu. "Dünya" haritası düşük çözünürlükte (570×220, ~1.6px/derece) — küçük ada ülkeleri zar zor render olabilir, bu bilinçli bir ödünleşim (bkz. Faz 9 açık sorular).
- Tek oyun modu (herkese karşı herkes). Takım modu, özel lobi yok. Harita seçimi var ama tam lobi UI'ı değil — sadece join-öncesi bir dropdown (Faz 12'de gerçek lobi sistemi gelecek).
- Liman + ticaret gemisi (Faz 6) ve savaş gemisi + deniz savaşı (Faz 7) var. Kıyı savunma yapılarının gemilere ateş etmesi yok; yakalanan ticaret gemisi el değiştirmiyor, doğrudan yok oluyor (bonus altın karşılığında).
- Nükleer silahlar (atom bombası, MIRV, SAM) yok.
- Tren/demiryolu sistemi yok.
- İttifak/diplomasi sistemi yok.
- Mobil/dokunmatik kontrol yok (sadece fare).
- Hosting/deploy yapılmadı — sadece local `npm run dev` ile çalışıyor.

## Bundan Sonra Yapılmak İstenenler (öneri sırası)

> Her maddenin ayrıntılı teknik planı — veri modeli, sunucu/istemci değişiklikleri, önerilen denge sabitleri, yapılacaklar listesi, kabul kriterleri ve açık sorularıyla birlikte — [`docs/phases/`](docs/phases/README.md) altında ayrı bir dosyada. Buradaki liste sadece hızlı bir özet; uygulamaya geçmeden önce ilgili faz dosyası okunmalı.

1. ~~**Liman + Ticaret Gemisi**~~ ([faz-06](docs/phases/faz-06-liman-ticaret-gemisi.md)) — **tamamlandı.**
2. ~~**Savaş Gemisi + deniz savaşı**~~ ([faz-07](docs/phases/faz-07-savas-gemisi-deniz-savasi.md)) — **tamamlandı.**
3. ~~**Gerçek dünya haritası**~~ ([faz-08](docs/phases/faz-08-gercek-dunya-haritasi.md)) — **tamamlandı** (Avrupa).
4. ~~**Çoklu harita desteği**~~ ([faz-09](docs/phases/faz-09-coklu-harita.md)) — **tamamlandı** (Avrupa, Afrika, Kuzey Amerika, Dünya, Rastgele Ada — 5 harita).
5. **Nükleer silahlar** ([faz-10](docs/phases/faz-10-nukleer-silahlar.md)) — Atom bombası → Hidrojen bombası → MIRV, SAM savunması.
6. **İttifak/diplomasi sistemi** ([faz-11](docs/phases/faz-11-ittifak-diplomasi.md)).
7. **Takım modları, özel lobiler** ([faz-12](docs/phases/faz-12-takim-modlari-lobiler.md)).
8. **Tren/demiryolu** ([faz-13](docs/phases/faz-13-fabrika-tren.md)) (deneysel, en son — OpenFront'ta da en son eklenen özellik).
9. Gerekirse: canlıya alma/hosting ([faz-14](docs/phases/faz-14-hosting-deploy.md)) (şu an 1-2 oyuncu için hiç gerek yok, ücretsiz katmanlar fazlasıyla yeterli).
10. **Görsel iyileştirmeler** ([faz-15](docs/phases/faz-15-gorsel-iyilestirmeler.md)) — mekanik eklemiyor, mevcut Canvas2D render'ı (su/kıyı, bölge sınırları, bina/birim ikonları, HUD, kamera geçişleri, opsiyonel minimap) cilalıyor; kendi içinde 15.1-15.6 alt fazlarına bölünmüş, bağımsız olarak istenen noktada alınabilir.

## Nasıl Çalıştırılır

```bash
npm install
npm run build:maps   # resources/maps/{europe,africa,north-america,world}.json üretir (bir kere; kaynak: resources/geo-source/)
npm run dev           # client: http://localhost:5173, server: http://localhost:3000
```

`resources/maps/*.json` dosyaları zaten repoda mevcutsa `build:maps` adımı atlanabilir — sadece dosyalar yoksa (veya haritaları yeniden üretmek isterseniz) gerekir. Bir harita dosyası bulunamazsa sunucu placeholder dairesel adaya düşer (konsola uyarı basar).

Oyuna bağlanmadan önce açılan ekrandan harita seçilir (Avrupa/Afrika/Kuzey Amerika/Dünya/Rastgele Ada — bkz. `src/core/maps.ts`), sonra "Oyuna Katıl" ile bağlanılır. Not: oyun zaten kurulu (başka biri katılmışsa) farklı bir harita seçimi yok sayılır, mevcut oyuna katılınır.

Kontroller: tekerlek=zoom, sürükle=pan, tık=bölgeye saldır (tekrar tıkla=hızlandır), sağ tık=saldırıları/gemi seçimini iptal et, alttaki bar'dan bina seç (Şehir/Karakol/Liman/Savaş Gemisi) + kendi bölgene (Savaş Gemisi için kendi limanına) tıkla=inşa et (Liman için tıklanan tile'ın kıyıya bitişik olması gerekir). Kendi savaş gemine tıkla=seç, sonra suya tıkla=hareket ettir.
