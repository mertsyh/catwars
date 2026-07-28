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
- `GameMap.ts` — terrain (kara/deniz) ızgarası, `owner` (tile→oyuncu) ve `regionOf` (tile→bölge) dizileri. `generateIsland()` şu an **placeholder** bir dairesel ada üretiyor (gerçek dünya haritası pipeline'ı henüz yok).
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
- `renderer.ts` — Canvas2D üzerinde sürekli `requestAnimationFrame` döngüsü ile çizim: tile renklendirme, bölge sınırları (koyu ton), bölge isim etiketleri, kuşatma garrison çubukları, bina ikonları, hover vurgusu, tıklama ripple animasyonu, kamera (pan/zoom).
- `main.ts` — WebSocket bağlantısı, input yönetimi (sürükle=pan, tekerlek=zoom, tık=saldır/inşa, sağ tık=iptal), UI paneli, bina barı.

## Şu An Çalışan Oyun Mekaniği

1. **Harita**: 400×300 tile'lık placeholder dairesel ada, ~80 **bölgeye** (ülkeye) bölünmüş. Her bölge rastgele bir medeniyet ismi taşır (Roma, Peçenek, Sriwijaya, Kuş, ...), boyutları kabaca dengeli.
2. **Doğuş**: Her oyuncu (insan veya bot) rastgele nötr bir bölgeye tüm gücüyle sahip olarak başlar — "herkes aynı boyda başlar" prensibi.
3. **Kaynaklar**: Asker (troops, saldırı/savunma için harcanır) ve Altın (pasif, toprağa bağlı birikir, henüz sadece bina inşasında kullanılıyor).
4. **Saldırı = Kuşatma**: Sınıra bitişik bir bölgeye tıklayınca o bölgeye **kuşatma emri** kuyruklanır. Her bölgenin bir `garrison` (savunma gücü, tile sayısıyla orantılı) değeri vardır; kuşatma her tick garrison'u asker harcayarak azaltır. Garrison 0'a inince **bölgenin tamamı tek seferde** el değiştirir (kısmi/piksel piksel değil).
   - Aynı bölgeye tekrar tıklamak (veya sınırındaki başka bir tile'a) mevcut kuşatmayı **boost**'lar (hız çarpanı artar, max 4x).
   - Sağ tık, o oyuncunun **tüm aktif kuşatmalarını iptal** eder.
   - Düşman bölgesi kuşatmak nötr bölgeden **1.5x** daha pahalıdır.
   - Kuşatma altındaki bölgeler **pasif garrison rejenerasyonu almaz** (bkz. Bilinen ve Düzeltilen Hatalar).
5. **Binalar**: Ekranın altındaki bar'dan Şehir (300 altın, +50 asker kapasitesi) veya Savunma Karakolu (200 altın, bulunduğu bölgenin garrison'unu +80 artırır) seçilir, sonra haritada kendi bölgenize tıklanır. Bir bölge ele geçirilirse üzerindeki binalar yıkılır.
6. **Bot AI**: 3 bot, periyodik olarak sahip oldukları bölgelerin rastgele bir komşusuna kuşatma başlatır — insan oyuncuyla aynı `queueAttack` API'sini kullanır.
7. **Kazanma koşulu**: Toprağın %72'sini kontrol eden oyuncu kazanır.
8. **Kamera/kontroller**: Doğuşta oyuncunun bölgesine otomatik zoom, fare tekerleğiyle zoom (imlece göre), sürükleyerek pan, hover'da geçerli/geçersiz hedef rengi (yeşil/kırmızı/beyaz), her tıklamada anlık ripple animasyonu (görsel geri bildirim).

## Denge Sabitleri (`src/core/constants.ts`)

| Sabit | Değer | Anlamı |
|---|---|---|
| `TICK_RATE` | 10 | saniyede tick sayısı |
| `STARTING_TROOPS` | 60 | başlangıç asker |
| `BASE_MAX_TROOPS` / `TROOPS_PER_TILE` | 100 / 0.5 | asker kapasitesi = 100 + toprak×0.5 |
| `TROOP_REGEN_PER_TICK` | 0.5 | asker rejenerasyonu |
| `REGION_COUNT` | 80 | bölge sayısı |
| `BASE_GARRISON` / `GARRISON_PER_TILE` | 50 / 0.3 | bölge garrison'u = 50 + tile×0.3 |
| `SIEGE_DAMAGE_PER_TICK` | 4 | temel kuşatma hasarı (boost ile çarpılır) |
| `ENEMY_SIEGE_COST_MULTIPLIER` | 1.5 | düşman bölgesi kuşatma maliyet çarpanı |
| `MAX_BOOST` | 4 | maksimum hızlandırma çarpanı |
| `WIN_LAND_FRACTION` | 0.72 | kazanma eşiği |
| `CITY_COST` / `CITY_TROOP_BONUS` | 300 / +50 | şehir maliyeti / bonusu |
| `DEFENSE_POST_COST` / `..._GARRISON_BONUS` | 200 / +80 | karakol maliyeti / bonusu |

## Geliştirme Süreci (kronolojik özet)

1. **Faz 0** — Proje iskeleti: TS + Vite + WS server, placeholder dairesel ada, uçtan uca "harita client'a ulaşıyor" doğrulaması.
2. **Faz 2** — İlk oyun döngüsü: tile-flood tabanlı toprak fethi (tıkla → BFS ile komşu tile'ları yut), asker/altın kaynakları, çok oyunculu senkron.
3. **Faz 4** — Basit bot AI (rastgele sınır hedefi seçip saldırma).
4. **Faz 5** — Şehir binası (asker kapasitesi bonusu).
5. **Savunma Karakolu** — ikinci bina türü, önce tile-yarıçapı tabanlı savunma çarpanı olarak eklendi.
6. **UX düzeltmesi** — kullanıcı geri bildirimi: "tıklayınca bir şey olmuyor, görsel geri dönüş yok". Kök neden: harita her zaman tam ekrana sığdırılıyordu, doğum bölgesi görünmüyordu. Çözüm: kamera pan/zoom, doğuşta otomatik odaklanma, hover vurgusu, tıklama ripple animasyonu.
7. **Saldırı mekaniği yeniden tasarımı** — kullanıcı geri bildirimi: "kendi kendine etrafa saldırıyor, sadece isteğime göre saldırmalıyım, iptal edebilmeliyim, hızlandırabilmeliyim". Tile-flood sınırsızdı; her tıklamayı **60 tile'lık sabit kapasiteli, iptal edilebilir, tekrar tıklamayla hızlanan emirlere** dönüştürdük.
8. **Bölge tabanlı büyük revizyon** (mevcut durum) — kullanıcı isteği: haritanın rastgele sınırlı, isimli "ülke" bölgelerinden oluşması, saldırının piksele değil bölgeye yapılması, herkesin aynı boyda başlaması, binalar için alt bar. Tile-flood tamamen kaldırıldı, yerine Voronoi bölge + garrison/kuşatma sistemi geldi.

## Bilinen ve Düzeltilen Hatalar

- **XSS açığı** (client, panel render): oyuncu isimleri `innerHTML` ile basılıyordu, kötü niyetli bir `join` mesajı script çalıştırabilirdi. `textContent` tabanlı güvenli DOM oluşturmaya çevrildi.
- **Genişleme zinciri kırılması** (tile-flood döneminde): bir tile zaten kendine aitse komşularını taramadan zincir kesiliyordu (iki emrin aynı noktada birleşmesi gibi durumlarda genişleme erken duruyordu). Düzeltildi.
- **Kuşatma sonsuz donması** (bölge modelinde, en son bulunan hata): asker azaldığında kuşatma hasarı bölgenin pasif garrison rejenerasyon hızına (0.5/tick) tam eşitlenip **sonsuza dek kilitleniyordu** — ikisi birbirini götürüyordu. Kuşatma altındaki bölgeler artık pasif rejenerasyon almıyor; böylece her pozitif hasar er ya da geç garrison'u sıfırlıyor.

## Bilinçli Basitleştirmeler / Sınırlamalar

- Harita hâlâ **placeholder** bir daire — gerçek dünya kıtaları/coğrafyası yok.
- Tek harita, tek oyun modu (herkese karşı herkes). Takım modu, özel lobi yok.
- Liman, ticaret gemisi, savaş gemisi, deniz savaşı yok — tüm harita tek bir kara parçası.
- Nükleer silahlar (atom bombası, MIRV, SAM) yok.
- Tren/demiryolu sistemi yok.
- İttifak/diplomasi sistemi yok.
- Mobil/dokunmatik kontrol yok (sadece fare).
- Hosting/deploy yapılmadı — sadece local `npm run dev` ile çalışıyor.

## Bundan Sonra Yapılmak İstenenler (öneri sırası)

1. **Liman + Ticaret Gemisi** — pasif altın akışı sağlayan, haritada hareket eden ilk birim türü. Bu, deniz/lojistik katmanının temeli (kıyı bölgesi kavramı, gemi pathfinding, render'da hareketli sprite gerektirir — bugüne kadarki en büyük tekil ek olabilir).
2. **Savaş Gemisi + deniz savaşı** — ticaret gemilerini koruma/çalma.
3. **Gerçek dünya haritası** — placeholder daire yerine gerçek kıta/ülke şekilleri (bir GeoJSON → bitmap pipeline'ı gerekir).
4. **Çoklu harita desteği** — 40+ harita seçeneği (OpenFront'taki gibi).
5. **Nükleer silahlar** — Atom bombası → Hidrojen bombası → MIRV, SAM savunması.
6. **İttifak/diplomasi sistemi.**
7. **Takım modları, özel lobiler.**
8. **Tren/demiryolu** (deneysel, en son — OpenFront'ta da en son eklenen özellik).
9. Gerekirse: canlıya alma/hosting (şu an 1-2 oyuncu için hiç gerek yok, ücretsiz katmanlar fazlasıyla yeterli).

## Nasıl Çalıştırılır

```bash
npm install
npm run dev   # client: http://localhost:5173, server: http://localhost:3000
```

Kontroller: tekerlek=zoom, sürükle=pan, tık=bölgeye saldır (tekrar tıkla=hızlandır), sağ tık=saldırıları iptal et, alttaki bar'dan bina seç + kendi bölgene tıkla=inşa et.
