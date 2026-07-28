# Faz 14 — Hosting / Deploy (opsiyonel)

**Bağımlılık:** yok, herhangi bir noktada yapılabilir
**Boyut:** Küçük — ama önceliği düşük, sadece gerçekten ihtiyaç doğarsa (bkz. Amaç).

## Amaç

PROGRESS.md bunu zaten "gerekirse" diye işaretliyor: proje şu an 1-2 oyuncu + bot için local `npm run dev` ile çalışıyor ve bu yeterli. Bu faz yalnızca **gerçek uzak oyuncularla** (aynı ağda olmayan) oynanmak istendiğinde devreye girmeli — erken yapılırsa zaman kaybı olur.

## Bizim oyuna nasıl uyarlanacak

Mevcut mimari zaten deploy'a uygun ayrılmış: `src/client` statik build (Vite `build` script'i zaten var), `src/server` bağımsız bir Node/WS süreci (`tsx watch src/server/index.ts`). İki parçayı ayrı barındırmak gerekiyor çünkü WebSocket sunucusu **uzun ömürlü bağlantı** istiyor — çoğu "serverless" platform (ör. fonksiyon-bazlı hosting) buna uygun değil.

## Yapılacaklar (checklist)

- [ ] İstemci için: `npm run build` çıktısını statik bir barındırma hedefine (herhangi bir statik dosya sunucusu) taşı.
- [ ] Sunucu için: uzun ömürlü WS bağlantısını destekleyen bir host seç (küçük bir VPS ya da kalıcı süreç çalıştırabilen bir platform); serverless/fonksiyon-bazlı platformlardan kaçın.
- [ ] `src/client/main.ts`'teki sabit kodlanmış `ws://localhost:3000` bağlantı adresini, build zamanında/ortam değişkeniyle ayarlanabilir hale getir (ör. `import.meta.env.VITE_WS_URL`).
- [ ] CORS/origin kontrolü: `server/index.ts`'teki WS sunucusunun sadece beklenen istemci origin'inden bağlantı kabul ettiğini doğrula (local geliştirmede önemsiz, herkese açık deploy'da güvenlik açısından önemli).
- [ ] Basit bir sağlık kontrolü / yeniden başlatma stratejisi (sunucu çökerse otomatik restart) — barındırma platformunun sunduğu mekanizma kullanılabilir, özel kod gerekmeyebilir.

## Kabul kriterleri

- Farklı bir ağdaki bir kullanıcı, paylaşılan bir URL üzerinden bağlanıp çalışan bir oyuna katılabiliyor.
- WS bağlantı adresi kaynak koduna sabit yazılı değil, ortam bazlı ayarlanabiliyor.

## Açık sorular / riskler

- Bu faz, diğer tüm fazlardan **bağımsız** ve isteğe bağlıdır — hangi noktada yapılacağı tamamen "gerçek uzak oyunculu test isteniyor mu" sorusuna bağlı, yol haritasında sabit bir sıraya sahip değil (bu yüzden numarası en sonda ama zorunlu bir bağımlılık zinciri yok).
- Maliyet: seçilecek platforma göre ücretsiz katman yeterli olabilir (mevcut oyuncu ölçeği çok düşük) — ücretli bir seçim yapılmadan önce kullanıcıyla teyitleşilmeli.
