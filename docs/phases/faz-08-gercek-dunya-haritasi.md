# Faz 8 — Gerçek Dünya Haritası

**Bağımlılık:** yok (Faz 6/7 mevcut placeholder daire üzerinde de çalışır; bu faz sadece terrain kaynağını değiştirir)
**Boyut:** Orta — çoğu iş bir kerelik offline pipeline, oyun mantığında değişiklik yok.

## Amaç

`GameMap.generateIsland()` şu an rastgele bir daire üretiyor (bkz. [PROGRESS.md](../../PROGRESS.md) "Bilinçli Basitleştirmeler"). Bu faz, gerçek kıta/kıyı şekillerine dayanan bir kara/su maskesi üretip mevcut `terrain: Uint8Array` yapısına **veri olarak** besliyor — `GameState`, kuşatma, bina, liman, gemi mantığının hiçbiri değişmiyor, çünkü hepsi zaten "terrain grid + Voronoi bölgeler" soyutlaması üzerine kurulu.

## OpenFront'ta nasıl çalışıyor (tasarım referansı)

OpenFront haritaları gerçek dünya kıyı şekillerine dayanıyor (Avrupa, Asya, Afrika vb. bölgesel haritalar + tam dünya haritası). Bu, oyunculara tanıdık bir coğrafya ve stratejik "darboğaz" noktaları (boğazlar, yarımadalar) sunuyor.

## Bizim oyuna nasıl uyarlanacak — veri kaynağı notu (önemli)

OpenFrontIO'nun kendi harita asset'leri **Creative Commons BY-SA 4.0** ile lisanslı — bu lisans atıf + "share-alike" (türetilmiş eseri aynı lisansla paylaşma) gerektirir. Bu projeyi o yükümlülüğe sokmamak için **onların harita dosyaları hiç kullanılmayacak/indirilmeyecek**. Bunun yerine tamamen bağımsız, kamu malı (public domain) bir coğrafya kaynağı kullanılacak:

- **Natural Earth** (naturalearthdata.com) — public domain, kıyı şeridi/kara poligonları `110m`/`50m`/`10m` çözünürlüklerde GeoJSON/Shapefile olarak sunuyor. Bu proje için önerilen kaynak budur.
- Alternatif: OpenStreetMap tabanlı veri (ODbL — paylaşım şartlı ama farklı bir lisans rejimi) — Natural Earth daha basit olduğu için öncelik onda.

## Pipeline tasarımı

Yeni bir **build-time script**, runtime kodu değil:

```
scripts/build-map.ts
  1. Natural Earth GeoJSON'unu (proje dışından, elle indirilmiş ya da fetch edilmiş) oku.
  2. Hedef bölge/bbox seç (ör. tek kıta ile başla — bkz. Açık sorular).
  3. Poligonu hedef genişlik×yükseklik tile grid'ine rasterize et
     (point-in-polygon testi; basit bir tarama-satır algoritması yeter, ağır GIS bağımlılığı gerekmez —
     gerekirse jenerik, OpenFront'la ilgisiz bir kütüphane olan `d3-geo`/`polygon-clipping` kullanılabilir).
  4. Çıktıyı mevcut `GameMap` formatına yaz: width, height, terrain: Uint8Array (0=Water,1=Land).
  5. `resources/maps/<isim>.json` (veya ikili .bin) olarak kaydet.
```

`src/core/GameMap.ts`, `generateIsland()` yerine (ya da onun yanında) `loadMapFromFile(path)` fonksiyonu kazanır. `server/index.ts` başlangıçta hangi haritayı yükleyeceğini seçer (bu fazda tek harita sabit kodlanabilir; çoklu seçim Faz 9'da).

## Veri modeli değişiklikleri

- `src/core/types.ts`: `interface MapAsset { width: number; height: number; terrain: Uint8Array }` — mevcut `GameMap` iç temsiliyle bire bir aynı, sadece dosyadan mı üretimden mi geldiği farklı.
- Protokolde değişiklik **yok** — `MapMessage` zaten `width/height/terrain` taşıyor, client'a hangi kaynaktan geldiği şeffaf.

## Yapılacaklar (checklist)

- [ ] Natural Earth `110m` veya `50m` kara poligonu verisini edin (proje dışı, `resources/geo-source/` gibi bir yere, `.gitignore`'a alınabilir çünkü ham kaynak büyük olabilir)
- [ ] `scripts/build-map.ts`: GeoJSON → rasterize → `resources/maps/<isim>.json` pipeline'ı yaz
- [ ] `GameMap.ts`: `loadMapFromFile()` ekle, mevcut `generateIsland()`'ı fallback/dev-mode olarak koru
- [ ] `regions.ts`: Voronoi bölge üretiminin yeni (düzensiz, dağınık takımada olabilen) kara maskesinde de dengeli bölgeler ürettiğini doğrula — küçük kopuk ada parçalarının tek başına aşırı küçük/garip bölge olmaması için minimum bölge boyutu kuralı gerekebilir
- [ ] `server/index.ts`: sabit kodlanmış harita dosyasını yükle
- [ ] Görsel doğrulama: üretilen silüetin tanınabilir olduğunu kontrol et (ör. Avrupa haritası Avrupa gibi görünüyor mu)

## Kabul kriterleri

- Sunucu, rastgele daire yerine gerçek bir kıyı şeridine dayanan haritayla açılıyor.
- Bölge üretimi, kuşatma, liman/gemi, bina sistemlerinin hepsi yeni haritada değişikliksiz çalışıyor.
- Harita verisi projede saklanan dosya `resources/maps/*.json`'dan geliyor, her sunucu başlangıcında yeniden hesaplanmıyor.

## Açık sorular / riskler

- **Kapsam: tek kıta mı, tüm dünya mı ilk sürümde?** Öneri: önce tek, tanınabilir bir bölge (ör. Avrupa) ile başla — tüm dünya haritası hem rasterize etmesi hem de Voronoi bölge dengesini tutturması daha zor, ve zaten Faz 9 "çoklu harita" onu doğal olarak genişletecek.
- **Tile çözünürlüğü**: mevcut placeholder 400×300. Gerçek kıyı şeridi detayı (körfezler, yarımadalar) daha yüksek çözünürlük ister ama performans/bölge sayısı dengesini bozabilir — ilk denemede aynı 400×300 ile başlanıp gerekirse artırılması öneriliyor.
- Kara kütlesinin birden fazla ayrık parçaya (adalar) bölünmesi, `findWaterPath`'in (Faz 6) bazı liman çiftleri arasında yol bulamaması anlamına gelebilir — bu Faz 6'da zaten "yol yoksa o çifti atla" olarak ele alınıyor, burada sadece hatırlatma.
