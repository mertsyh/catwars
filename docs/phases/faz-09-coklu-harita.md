# Faz 9 — Çoklu Harita Desteği

**Bağımlılık:** Faz 8 (harita üretim pipeline'ı)
**Boyut:** Küçük-Orta — çoğunlukla Faz 8'in genellenmesi + basit bir seçim ekranı.

## Amaç

OpenFront onlarca/yüzlerce harita sunuyor; biz bu ölçeğe ihtiyaç duymuyoruz (bkz. Açık sorular) ama **tek sabit kodlanmış harita** yerine birkaç seçilebilir harita sunmak, tekrar oynanabilirliği ciddi artırıyor ve Faz 8'in pipeline'ını gerçek anlamda yeniden kullanılabilir kılıyor.

## OpenFront'ta nasıl çalışıyor (tasarım referansı)

Oyuncu oyuna girmeden önce bir harita seçiyor (dünya, kıta, ülke veya kurgusal/arcade haritalar). Her harita kendi kara/su maskesi + isim + önizleme görseline sahip, ayrı bir dosya/varlık olarak paketleniyor.

## Bizim oyuna nasıl uyarlanacak

- Faz 8'deki `scripts/build-map.ts` script'i tek harita yerine bir **liste** için çalıştırılır (ör. `europe`, `africa`, `world`, ve mevcut `generateIsland()` de "Rastgele Ada" adıyla listede bir seçenek olarak kalabilir — geriye dönük uyumluluk + hızlı test için değerli).
- Yeni bir kayıt dosyası `src/core/maps.ts`: `MAP_REGISTRY: { id: string; name: string; width: number; height: number }[]`.
- Oyuna katılma akışı bugün "bağlan → otomatik oyuna düş" şeklinde; bu fazda **join öncesi bir harita seçim adımı** gerekiyor. Bu, Faz 12'deki lobi sisteminin küçük bir öncüsü — o yüzden burada minimal tutulmalı (tam lobi UI'ı değil, sadece bir dropdown).

## Veri modeli değişiklikleri

**`src/core/protocol.ts`**
```ts
interface JoinMessage {
  type: "join";
  name: string;
  mapId?: string;   // opsiyonel, ilk bağlanan oyuncu seçer, sonrakiler mevcut oyuna katılır
}
```
Not: Faz 12'ye kadar hâlâ "tek sürekli açık oyun" mimarisi korunuyor (bkz. Faz 12), yani `mapId` sadece **henüz kimse katılmamışken sunucu ilk açıldığında/reset olduğunda** anlamlı olur. Sunucu zaten çalışan bir oyuna farklı `mapId` ile gelen isteği yok sayıp mevcut haritayı kullanır.

## Yapılacaklar (checklist)

- [ ] `scripts/build-map.ts`'i çoklu harita üretecek şekilde genelleştir (bbox/isim parametreleri)
- [ ] En az 3-4 harita üret: 1-2 gerçek dünya bölgesi (Faz 8) + mevcut `generateIsland()`'ı "Rastgele Ada" olarak kayıtta tut
- [ ] `src/core/maps.ts`: `MAP_REGISTRY`
- [ ] `protocol.ts`: `JoinMessage.mapId`
- [ ] `client/index.html` + `main.ts`: bağlanmadan önce basit bir harita seçim dropdown'ı (isim listesi `MAP_REGISTRY`'den)
- [ ] `server/index.ts`: ilk oyuncunun seçtiği `mapId`'ye göre haritayı yükle

## Kabul kriterleri

- Kullanıcı oyuna girmeden önce en az 3-4 harita arasından seçim yapabiliyor.
- Farklı haritalar gerçekten farklı, ayırt edilebilir düzenler üretiyor.
- Var olan tüm mekanikler (kuşatma, liman, gemi) her haritada değişikliksiz çalışıyor.

## Açık sorular / riskler

- **Kaç harita yeterli?** OpenFront'un 100+ haritası, yüzlerce eşzamanlı oyuncuyu farklı lobilere dağıtmak için var — bizim 1-2 oyuncu + bot ölçeğimizde bu motivasyon yok. Öneri: bu fazı 3-5 haritayla sınırla, "çeşitlilik" asıl hedef, "OpenFront'la sayı yarışı" değil.
- Harita başına ayrı bir Voronoi bölge/isim ataması mı, yoksa her sunucu başlangıcında yeniden mi üretilsin? Öneri: `regions.ts` zaten deterministik değil (rastgele tohum) — her başlangıçta yeniden üretmek çeşitliliği artırır, önceden hesaplayıp dosyaya gömmek gerekmez (sadece `terrain` önceden hesaplanır, `regions` runtime'da üretilmeye devam eder).
