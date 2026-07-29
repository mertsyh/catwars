# Faz 15 — Görsel İyileştirmeler

**Bağımlılık:** yok, herhangi bir noktada alınabilir; gameplay fazlarının (10-13) aksine bir mekanik eklemiyor, sadece mevcut oyunu daha iyi gösteriyor.
**Boyut:** Orta-Büyük — bu yüzden kendi içinde bağımsız alt fazlara bölündü; hepsi birden değil, istenen alt faz(lar) tek başına da alınabilir.

## Amaç

Şu anki render (`src/client/renderer.ts`) tamamen fonksiyonel ama minimal: düz renkli tile'lar, ince koyu bölge sınırları, temel geometrik bina ikonları (daire/kare/üçgen), noktacık gemiler + HP çubuğu, basit ripple tıklama efekti. Mekanikler (kuşatma, liman, savaş gemisi, çoklu harita) sağlam durumda — bu faz onları **değiştirmeden**, sadece oyunun görünürlüğünü/okunabilirliğini/"oyun hissini" artırmayı hedefliyor.

## Genel ilkeler

- **Performans öncelikli.** Mevcut Canvas2D + offscreen `ImageData` pipeline korunacak (bkz. `MapRenderer.initTerrain`/`writePixel`) — WebGL'e geçiş bu fazın kapsamı dışında (ayrı, çok daha büyük ve riskli bir iş, ayrı bir faz olarak ele alınmalı).
- **Her alt faz bağımsız** uygulanıp tek başına değerlendirilebilir olmalı; birbirine sıkı bağımlı olmayacak şekilde sıralandı (yine de üstteki alt fazlar altındakiler için temel oluşturuyor, bu yüzden numara sırası öneri sırası).
- **Piksel/blok estetiği bilinçli bir tercih gibi duruyor** (mevcut tile-bazlı, keskin kenarlı görünüm) — bu fazın hedefi "gerçekçi" render'a geçiş değil, mevcut stili cilalamak. Kesin yön Açık Sorular'da işaretli, uygulamaya geçmeden önce teyit edilmeli.
- Yeni asset'ler (sprite, ikon) **kendi çizilecek veya CC0/public domain kaynaklardan** olacak — bkz. `docs/phases/README.md`'deki "kod/asset kopyalama yok" ilkesi, bu faz için de geçerli.

## Alt Fazlar

### 15.1 — Su ve kıyı görselliği

Düz lacivert `WATER_COLOR` yerine hafif canlı bir görünüm.

- Sığ kıyı suyuna (karaya yakın birkaç tile) daha açık bir ton geçişi — `computeCoastalTiles` zaten var, aynı mantıkla "sudan karaya olan mesafe"yi 2-3 tile'a kadar hesaplayıp gradyan uygulanabilir.
- ~~Suya çok hafif bir hareket hissi: ... kaydırmak~~ — **kaldırıldı.** Kayan parıltı bandı (`buildWaterShimmer`/`drawWaterShimmer`) büyük haritalarda "dünya dönüyor" gibi algılandığı için kullanıcı isteğiyle tamamen geri alındı; su artık sadece statik kıyı gradyanıyla, animasyonsuz kalıyor.

### 15.2 — Bölge sınırları ve toprak geçişleri

- Bölge sınırlarını iki katmanlı çiz: dış koyu hat (mevcut `BORDER_DARKEN`) + üstüne ince, yarı saydam açık bir iç hat — haritaya hafif bir "kabartma" hissi verir.
- Yeni ele geçirilen tile'lar için kısa bir "flash" geçişi: `TileChangeDTO` her geldiğinde o tile birkaç yüz ms boyunca beyaza yakın bir tondan gerçek sahip rengine sönsün (orantılı parçalı alım mekaniğiyle zaten her tick birkaç tile değişiyor — bu geçiş, gözle takip etmeyi kolaylaştırır).
- **Not:** Faz 13'te (orantılı parçalı alım) kaldırılan eski "kuşatma yeme" overlay'inin yerini kısmen bu dolduruyor — ama artık gerçek sahiplik verisi üzerinden, sahte bir ilerleme efekti değil.

### 15.3 — Bina ve birim ikonları

- Şu anki temel şekiller (Şehir=daire, Karakol=kare, Liman=üçgen) yerine küçük, tutarlı bir pixel-art ikon seti (16×16 veya 24×24) — Şehir/Karakol/Liman/Savaş Gemisi/Ticaret Gemisi için.
- Sahiplik rengiyle **tint edilebilir taban + sabit detay katmanı** deseni (ör. gri bir siluet + oyuncu rengiyle boyanan bir alt katman), böylece her oyuncu rengi için ayrı sprite çizmeye gerek kalmaz.
- Savaş gemisi/ticaret gemisi için yön/rota bilgisi zaten var (`positionAlongPath`) — sprite'a hareket yönüne göre basit bir döndürme eklenebilir.

### 15.4 — HUD / UI polish

- Panel (`#panel`), build bar (`#buildBar`), status metni şu an düz kutular — ince gradyan/gölge, oyuncu satırlarında kendi rengiyle eşleşen küçük bir renk rozeti.
- Build bar butonlarına durum stilleri: yetersiz altın (disabled görünüm), hover, seçili (zaten `active` class'ı var, görsel olarak güçlendirilebilir).
- Kazanma banner'ına (`#banner`) basit bir vurgu animasyonu (ör. ölçek/opaklık geçişi, konfeti gerekmez).
- Kuşatma/gemi durumları için küçük ikonlu bir bildirim/log şeridi (opsiyonel, kapsam dışına taşabilir — ayrı değerlendirilmeli).

### 15.5 — Kamera ve geri bildirim animasyonları

- `centerOn`/zoom geçişleri şu an anlık atlıyor (`this.camX = x` doğrudan atama) — kısa bir ease-out interpolasyonla yumuşatılabilir (özellikle doğuşta oyuncunun bölgesine zoom yaparken fark yaratır).
- Ripple efektlerine (`addRipple`) hafif varyasyon: saldırı ripple'ı için ince bir "kıvılcım" parçacığı, inşa ripple'ı için yükselen bir ikon parıltısı.
- **Not:** bu alt faz 15.2 ile kısmen örtüşüyor (ikisi de "bir şey oldu" geri bildirimi) — birlikte planlanması daha tutarlı sonuç verir.

### 15.6 (opsiyonel, ayrı bir mini-faz sayılabilir) — Minimap

- Küçük, ayrı bir canvas: tüm haritayı düşük çözünürlükte sahiplik renkleriyle çizer, ana görünümün kapladığı alanı bir dikdörtgenle gösterir.
- Çoklu harita desteğinden (Faz 9) sonra özellikle büyük haritalarda (Dünya, 570×220) faydası artıyor — küçük haritalarda (Avrupa, Afrika) önceliği daha düşük.
- Orta zorlukta, kendi başına yeterince kapsamlı olduğu için ayrı ele alınması önerilir; 15.1-15.5 ile bağımlılığı yok.

## Yapılacaklar (checklist)

- [x] 15.1 — Kıyı gradyanı (statik); su hareketi/parıltı animasyonu eklenmişti ama "dönüş efekti" gibi algılandığı için kaldırıldı
- [ ] 15.2 — Çift katmanlı bölge sınırı + tile ele geçirme flash geçişi
- [ ] 15.3 — Bina/birim pixel-art ikon seti (tint edilebilir taban deseni)
- [ ] 15.4 — Panel/build bar/banner görsel polish + buton durum stilleri
- [ ] 15.5 — Kamera ease-out geçişleri + ripple varyasyonları
- [ ] 15.6 — Minimap (opsiyonel)

## Kabul kriterleri

- Her alt faz, önceki mekanikleri (kuşatma, liman, gemi, çoklu harita) bozmadan tek başına açılıp kapatılabilecek kadar izole.
- Değişikliklerden sonra büyük haritalarda (Dünya, 570×220) FPS gözle görülür şekilde düşmüyor (özellikle 15.1 ve 15.5 için).
- Yeni asset'lerin hiçbiri OpenFrontIO'nun (veya başka bir üçüncü tarafın) telifli kaynağından türetilmiyor.

## Açık sorular / riskler

- **Stil yönü — karar verildi:** kullanıcı "yumuşak/modern gradyan" yönünü seçti (15.1 uygulamasından önce soruldu). Kıyı geçişi mesafeye göre yumuşak renk blend'i olarak uygulandı (bkz. `MapRenderer.computeCoastDistance`). 15.2-15.3 için de aksi belirtilmedikçe bu yön geçerli sayılabilir.
- **Su hareketi — geri alındı:** ilk uygulamada eklenen kayan parıltı bandı (`buildWaterShimmer`/`drawWaterShimmer`) büyük haritalarda "arkadaki dünya dönüyor" gibi bir izlenim verdiği için kullanıcı isteğiyle kaldırıldı. Su artık tamamen statik: sadece kıyı gradyanı var, hareketli katman yok.
- **Sprite kaynağı:** ikonlar tamamen sıfırdan mı çizilecek (kod içinde `drawImage`/prosedürel canvas çizimiyle) yoksa harici bir CC0 pixel-art seti mi kullanılacak? İkincisi hızlı ama kaynak/lisans doğrulaması gerektiriyor.
- **Performans bütçesi belirsiz:** su animasyonu, ease-out kamera ve parçacık efektleri toplamda büyük haritalarda ne kadar maliyetli olur, uygulama sırasında ölçülmeli (ör. `performance.now()` ile frame süresi loglanarak).
- Bu faz numaralandırması (`docs/phases/README.md`'deki tablo) diğer fazlardan bağımsız olduğu için güncellenmedi bırakılabilir ya da "bağımlılığı yok" satırıyla eklenebilir — küçük bir dokümantasyon kararı.
