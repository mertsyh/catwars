# Faz Planı — OpenFront Tarzı Özellik Yol Haritası

Bu klasör, [PROGRESS.md](../../PROGRESS.md)'nin sonundaki "Bundan Sonra Yapılmak İstenenler" listesini, her biri kendi başına uygulanabilir, somut bir teknik plana çeviren faz dosyalarını içerir. Amaç, **openfront.io / OpenFrontIO** oyununun mekanik zenginliğine (liman-ticaret, deniz savaşı, gerçek dünya haritaları, nükleer silahlar, ittifak sistemi, takım modları, tren ağı) **kendi mimarimizde, kendi kodumuzla, kendi sanat/asset'lerimizle ve kendi denge sayılarımızla** yaklaşmak.

## Çalışma ilkesi: kod/asset kopyalama yok

OpenFrontIO'nun kodu AGPL-3.0, asset'leri CC BY-SA 4.0 ile lisanslı. Bu proje onlardan bağımsız bir implementasyon olduğu için:

- **Hiçbir kaynak dosyaları okunmadı, kopyalanmadı veya buraya yapıştırılmadı.** Aşağıdaki fazlarda "OpenFront'ta nasıl çalışıyor" bölümleri, herkese açık wiki/rehber sayfalarından (openfront.miraheze.org, openfront.fyi vb.) edinilen **davranış/mekanik açıklamalarının** kendi cümlelerimizle özetidir — kaynak kod veya görsel asset değil. Oyun kuralları/mekanikleri (örn. "kuşatma silahları hasar verir", "ittifak kurulabilir") telif konusu değildir; kopyalamaktan kaçındığımız şey kod ve asset'lerdir.
- Sayısal denge değerleri (maliyetler, hasar, süreler) **birebir kopyalanmamıştır** — OpenFront'un ekonomisi yüzlerce oyunculu, binlerce tile'lı devasa haritalar için ayarlanmış; bizimki 1-2 oyuncu + bot ölçeğinde. Her fazda "orantı" referans alınmış, kendi `constants.ts` ölçeğimize (bkz. `CITY_COST=300`, `DEFENSE_POST_COST=200`) göre yeniden türetilmiştir.
- Görsel asset'ler (sprite, ikon, harita PNG/GeoJSON'ları) kendi kaynaklarımızdan üretilecek/çizilecek — bkz. Faz 8'de veri kaynağı notu.

## Faz sırası ve bağımlılıklar

| # | Dosya | Başlık | Bağımlılık |
|---|---|---|---|
| 6 | [faz-06-liman-ticaret-gemisi.md](faz-06-liman-ticaret-gemisi.md) | Liman + Ticaret Gemisi | — |
| 7 | [faz-07-savas-gemisi-deniz-savasi.md](faz-07-savas-gemisi-deniz-savasi.md) | Savaş Gemisi + Deniz Savaşı | Faz 6 |
| 8 | [faz-08-gercek-dunya-haritasi.md](faz-08-gercek-dunya-haritasi.md) | Gerçek Dünya Haritası | — |
| 9 | [faz-09-coklu-harita.md](faz-09-coklu-harita.md) | Çoklu Harita Desteği | Faz 8 |
| 10 | [faz-10-nukleer-silahlar.md](faz-10-nukleer-silahlar.md) | Nükleer Silahlar | — |
| 11 | [faz-11-ittifak-diplomasi.md](faz-11-ittifak-diplomasi.md) | İttifak / Diplomasi Sistemi | — |
| 12 | [faz-12-takim-modlari-lobiler.md](faz-12-takim-modlari-lobiler.md) | Takım Modları + Özel Lobiler | Faz 11 (takım = kalıcı ittifak) |
| 13 | [faz-13-fabrika-tren.md](faz-13-fabrika-tren.md) | Fabrika + Tren/Demiryolu | Faz 6 (pathfinding), Faz 11 (müttefik tarifesi) |
| 14 | [faz-14-hosting-deploy.md](faz-14-hosting-deploy.md) | Hosting/Deploy (opsiyonel) | — |

Numaralandırma PROGRESS.md'deki mevcut "Faz 0/2/4/5" geçmişinin devamıdır (Faz 1/3 daha önce de atlanmış, sıralı olmaları şart değil — bkz. mevcut dosyanın "Geliştirme Süreci" bölümü). Bağımlılığı olmayan fazlar (6, 8, 10, 11) paralel/istenen sırada alınabilir; 7/9/12/13 kendi bağımlılıklarından önce başlamamalı.

## Her faz dosyasının şablonu

Her `faz-NN-*.md` dosyası şu bölümleri içerir:

1. **Amaç** — bu faz neden var, hangi boşluğu kapatıyor.
2. **OpenFront'ta nasıl çalışıyor** — kısa, kavramsal referans (kod yok).
3. **Bizim oyuna nasıl uyarlanacak** — bölge/tile tabanlı mevcut modelimize (Voronoi bölgeler, kuşatma sistemi) nasıl oturduğu.
4. **Veri modeli değişiklikleri** — `src/core/types.ts`, `protocol.ts`, `constants.ts`'e eklenecek somut tipler/mesajlar.
5. **Sunucu ve istemci değişiklikleri** — hangi dosyalar, hangi fonksiyonlar.
6. **Denge sabitleri (başlangıç önerisi)** — tablo halinde, mevcut ölçeğe göre türetilmiş sayılar (ilk oynanışta ayarlanacak, kesin değil).
7. **Yapılacaklar (checklist)** — uygulama sırasına göre adımlar.
8. **Kabul kriterleri** — "bu faz bitti" demek için gözlemlenebilir davranış.
9. **Açık sorular / riskler** — tasarım kararı gerektiren, henüz netleşmemiş noktalar.

## Genel mimari hatırlatması

Tüm fazlar mevcut ayrımı korumalı ([PROGRESS.md](../../PROGRESS.md) → "Mimari"):

- **`src/core/`** — deterministik, render/network'ten bağımsız oyun mantığı. Yeni birim tipleri (gemi, tren, füze) burada `tick()` ile ilerler.
- **`src/server/`** — yetkili simülasyonu çalıştırır, `ClientMessage`/`ServerMessage` (`protocol.ts`) üzerinden client'larla konuşur.
- **`src/client/`** — Canvas2D render + input; sunucudan gelen DTO'ları çizer, kendi oyun mantığı çalıştırmaz.

Yeni hareketli birimler (ticaret gemisi, savaş gemisi, tren, füze) için ortak bir desen öneriliyor: sunucu **tam pozisyonu her tick'te yaymak yerine** doğuş anındaki `path` + `startTick` + `speed` bilgisini bir kere yollar, istemci pozisyonu lokal olarak interpole eder (bkz. Faz 6). Bu, `TickMessage` boyutunu küçük tutar ve mevcut `TileChangeDTO` deltası deseniyle tutarlıdır.
