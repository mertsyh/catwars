# Faz 12 — Takım Modları + Özel Lobiler

**Bağımlılık:** Faz 11 (takım arkadaşlığı, "kalıcı ve bozulamaz ittifak" olarak modellenir)
**Boyut:** Büyük — sunucu mimarisinde gerçek bir değişiklik: "tek sürekli açık oyun" modelinden "oda bazlı çoklu oyun" modeline geçiş.

## Amaç

Bugün `server/index.ts` açılışta **tek bir** `GameState` üretiyor ve her bağlanan otomatik ona katılıyor (bkz. PROGRESS.md §"Bilinçli Basitleştirmeler": "Tek harita, tek oyun modu"). Bu faz, oyuncuların **önceden bir oda kurup** harita/takım/bot sayısı seçip kendi zamanlarında başlatabildiği bir lobi akışı + FFA dışında takım modları (Düo/Trio/Quad) ekliyor.

## OpenFront'ta nasıl çalışıyor (tasarım referansı)

Oyun modları arasında FFA, Düo/Trio/Quad (sabit takım boyutu) ve özel/turnuva lobileri var. Özel lobi bir kod ile paylaşılıyor, host harita ve diğer ayarları seçip oyunu başlatıyor.

## Bizim oyuna nasıl uyarlanacak

- Sunucu tarafında yeni bir **Lobby** kavramı: oyun başlamadan önceki bekleme odası durumu, `GameState`'ten tamamen ayrı bir nesne/state makinesi.
- Protokol iki katmana ayrılır: **lobi-öncesi mesajlar** (oda oluştur/katıl/takım seç/başlat) ve mevcut **oyun-içi mesajlar** (`AttackMessage` vb.) — bu ikisini karıştırmamak için ayrı mesaj union'ları (`LobbyClientMessage` / `GameClientMessage`) önerilir, `type` alanına göre sunucu hangi işleyiciye yönlendireceğini bilir.
- Takım arkadaşlığı, Faz 11'in ittifak durum makinesinde **yeni bir durum değil**, "otomatik, süresiz, bozulamaz `allied`" olarak modellenir: oyun başlarken aynı takımdaki oyuncu çiftleri arası ilişki doğrudan `allied` + `expiresAtTick=Infinity` + "breakAlliance engellenir" olarak kurulur. Bu, Faz 11'deki `canAttack` kontrolünün hiç değişmeden takım modunda da çalışması demek.
- Sunucu artık **tek** `GameState` yerine `Map<roomId, GameState>` tutar; her WebSocket bağlantısı bir `roomId`'ye eşlenir.

## Veri modeli değişiklikleri

**`src/core/protocol.ts`**
```ts
interface CreateLobbyMessage { type: "createLobby"; name: string; }
interface JoinLobbyMessage { type: "joinLobby"; code: string; name: string; }
interface SetTeamMessage { type: "setTeam"; team: number | null; } // null = FFA/takımsız
interface SetMapMessage { type: "setMap"; mapId: string; }         // Faz 9 kaydından
interface SetBotCountMessage { type: "setBotCount"; count: number; }
interface StartGameMessage { type: "startGame"; }                   // sadece host

interface LobbyStateMessage {
  type: "lobbyState";
  code: string;
  hostId: number;
  mapId: string;
  botCount: number;
  players: { id: number; name: string; team: number | null }[];
}
```
`src/core/types.ts`: `GameMode = "ffa" | "duos" | "trios" | "quads" | "custom"`.

## Sunucu değişiklikleri

- Yeni `src/server/Lobby.ts`: oda kodu üretimi (kısa, kolay paylaşılır — ör. 4 haneli), oyuncu listesi, host yetkisi, `startGame` çağrılınca ilgili `GameState`'i (seçilen `mapId`, `botCount`, takım atamalarıyla) örnekleyip odayı "oyun" durumuna geçirme.
- `server/index.ts`: mevcut "açılışta tek oyun kur" mantığı kalkar; bağlantılar önce lobi mesajlarıyla karşılanır, `startGame` sonrası o bağlantı grubu ilgili `GameState`'e yönlendirilir. **Hızlı oyun (lobisiz) FFA** varsayılan davranış olarak korunmalı — herkes ille lobi kurmak zorunda kalmamalı (bkz. Açık sorular).
- `GameState.ts`: `GameMode`/takım ataması constructor'a parametre olarak eklenir; kazanma koşulu takım modunda "bir **takımın** toplam toprağı %X" olacak şekilde genellenir.

## İstemci değişiklikleri

- `main.ts` / `client/index.html`: bağlanmadan önce bir ön-ekran — "Hızlı Oyna" (mevcut davranış) / "Lobi Kur" / "Koda Katıl" seçenekleri; lobi ekranında harita dropdown'ı (Faz 9), bot sayısı, takım slotu seçimi, oyuncu listesi, (host için) "Başlat" butonu.
- `renderer.ts`: takım arkadaşı bölgeleri, Faz 11'deki müttefik stiliyle **aynı** kenarlık kuralını kullanır (ekstra kod gerekmez, ilişki zaten `allied`).

## Yapılacaklar (checklist)

- [ ] `protocol.ts`: lobi mesaj ailesi + `GameMode`
- [ ] `src/server/Lobby.ts`: oda state makinesi, kod üretimi
- [ ] `server/index.ts`: bağlantı yönlendirmesini lobi-öncesi/oyun-içi olarak ikiye ayır, `Map<roomId, GameState>`
- [ ] `GameState.ts`: `GameMode`/takım parametreleri, takım-bazlı kazanma koşulu, Faz 11 ilişki makinesine kalıcı takım ittifakı enjeksiyonu
- [ ] `client`: ön-ekran (Hızlı Oyna / Lobi Kur / Katıl), lobi bekleme ekranı
- [ ] Hızlı Oyna varsayılanının hâlâ çalıştığını doğrula (geriye dönük uyumluluk)

## Kabul kriterleri

- İki farklı tarayıcı sekmesi aynı lobi koduyla aynı odaya katılabiliyor, takım seçip host "Başlat"a bastığında senkron bir oyun başlıyor.
- Takım modunda takım arkadaşları birbirine saldıramıyor, kazanma koşulu takım toplamına bakıyor.
- "Hızlı Oyna" hâlâ lobi kurmadan direkt FFA oyununa sokuyor (varsayılan davranış kaybolmuyor).

## Açık sorular / riskler

- **Hızlı Oyna'nın sunucu tarafı karşılığı**: arka planda otomatik, gizli bir "varsayılan FFA lobisi" mi oluşturulacak, yoksa lobi sistemini tamamen bypass eden ayrı bir kod yolu mu? Öneri: basitlik için gizli/otomatik lobi — kod tekrarını önler, tüm oyunlar aynı `GameState` oluşturma yolundan geçer.
- Bu faz mimaride en büyük kırılma noktası (tek oyun → çoklu oda); mevcut `server/index.ts`'in bot spawn/tick döngüsü kodu odaya özgü hale getirilmeli — refactor riski, dikkatli yapılmazsa mevcut tek-oyun akışını da bozabilir. Küçük adımlarla (önce `Map<roomId,...>` altyapısı, tek odayla test, sonra çoklu oda) ilerlemek öneriliyor.
