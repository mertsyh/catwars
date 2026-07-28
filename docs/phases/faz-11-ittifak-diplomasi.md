# Faz 11 — İttifak / Diplomasi Sistemi

**Bağımlılık:** yok (mevcut oyuncu/bölge modeliyle çalışır; Faz 6/10 ile bağlantılıysa da onları beklemesi gerekmez)
**Boyut:** Orta — yeni bir ilişki durum makinesi + saldırı/kuşatma mantığına ince ama yaygın bir kesişim.

## Amaç

Şu an tek oyunculararası etkileşim biçimi saldırı. İttifak sistemi, **saldırmama + kaynak paylaşımı** anlaşması ekleyerek oyuna diplomatik bir katman kazandırıyor — bu hem tek başına ilginç bir mekanik hem de Faz 12'nin (takım modları = kalıcı ittifak) ve Faz 13'ün (müttefik tren tarifesi) ön koşulu.

## OpenFront'ta nasıl çalışıyor (tasarım referansı)

Bir oyuncunun bölgesine sağ tıklayıp "el sıkışma" ikonuyla ittifak teklif ediliyor; kabul edilirse taraflar birbirine saldıramıyor, birbirine altın/asker gönderebiliyor. İttifakın bir süresi var, karşılıklı onayla yenilenebiliyor. İttifakı bozan tarafa kalıcıya yakın bir savunma cezası ve "hain" durumu uygulanıyor; ittifak bozulunca ticaret de otomatik olarak askıya alınıyor (embargo), manuel olarak kaldırılana/ittifak yenilenene kadar sürüyor.

## Bizim oyuna nasıl uyarlanacak

- Yeni bir ilişki durum makinesi, oyuncu-çifti başına: `neutral → allianceRequested → allied → (süresi doldu | bozuldu) → embargoed`. Sıralı (kimden kime teklif) olduğu için anahtar `"${minId}-${maxId}"` değil, `pendingFrom`/`pendingTo` ayrı tutulmalı.
- Mevcut saldırı/kuşatma mantığına (`GameState.queueAttack` benzeri) tek bir kontrol eklenir: hedef bölge sahibiyle `allied` ilişkisi varsa saldırı reddedilir. Bu, tüm gelecekteki saldırı türlerinin (kuşatma, nükleer — Faz 10) ortak bir yerden geçmesini gerektirir; hâlâ ayrı yollardan geçiyorlarsa bu fazda ortak bir `canAttack(attackerId, targetOwnerId)` yardımcı fonksiyonuna toplanmalı.
- Bot AI: basit bir heuristic ile teklif kabul/red kararı verebilir (ör. "güçlü bir bot, zayıf bir insan oyuncudan gelen teklifi kabul etsin" gibi rastgele/uydurma bir kural yeterli — tam diplomasi AI'ı kapsam dışı).

## Veri modeli değişiklikleri

**`src/core/diplomacy.ts`** (yeni dosya)
```ts
type AllianceStatus = "none" | "pending" | "allied" | "embargoed";

interface AllianceRelation {
  a: number; b: number;           // oyuncu id'leri, a < b
  status: AllianceStatus;
  pendingFrom?: number;           // status="pending" iken teklifi kim attı
  alliedSinceTick?: number;
  expiresAtTick?: number;
  embargoUntilTick?: number;
  betrayalCount: { [playerId: number]: number };
}
```

**`src/core/protocol.ts`**
```ts
interface ProposeAllianceMessage { type: "proposeAlliance"; targetPlayerId: number; }
interface RespondAllianceMessage { type: "respondAlliance"; targetPlayerId: number; accept: boolean; }
interface BreakAllianceMessage { type: "breakAlliance"; targetPlayerId: number; }
interface SendGoldMessage { type: "sendGold"; targetPlayerId: number; amount: number; }
interface SendTroopsMessage { type: "sendTroops"; targetPlayerId: number; amount: number; }
```
`ClientMessage` union'a ekle. `TickMessage`/`InitMessage`'a `alliances: AllianceRelationDTO[]` ekle (client'ın hangi bölgeleri "müttefik" stiliyle çizeceğini bilmesi için).

## Sunucu değişiklikleri

- `GameState.ts`:
  - Yeni ilişki map'i `Map<string, AllianceRelation>`.
  - `proposeAlliance`/`respondAlliance`/`breakAlliance` handler'ları; kabul edilince `status="allied"`, `expiresAtTick` ayarlanır.
  - Mevcut saldırı başlatma noktasına (muhtemelen `queueAttack` veya benzeri) `if (isAllied(attackerId, targetOwnerId)) reject` kontrolü.
  - `breakAlliance`: `status="embargoed"`, `betrayalCount[breaker]++`, saldıran tarafın **çıkış** kuşatma hasarına `BETRAYAL_DEBUFF_MULTIPLIER` uygula (belirli bir süre — bkz. tablo).
  - Her tick: süresi dolan ittifakları `embargoed`'a çevir (otomatik "hain" cezası olmadan, sadece süre bitişi).
  - `sendGold`/`sendTroops`: basit kaynak transferi, sadece `allied` durumdaki çiftler arasında.
- `server/index.ts`: yeni mesajları yönlendir, `alliances` broadcast'e ekle.

## İstemci değişiklikleri

- `main.ts`: sağ tık davranışı genişliyor — bugün "tüm saldırıları iptal et" (kendi bölgesi için anlamlı); başka bir oyuncunun bölgesine sağ tık artık küçük bir bağlam menüsü açmalı: "İttifak Teklif Et" / "İttifakı Boz" / (ittifak yoksa) mevcut davranış korunur. Kendi bölgesine sağ tık davranışı değişmez.
- `renderer.ts`: müttefik bölgeler farklı kenarlık stiliyle (ör. kesikli çizgi) çizilir; oyuncu panelinde küçük bir ittifak/hain rozet listesi.
- Basit bir bildirim/toast: "X sizinle ittifak istiyor" → kabul/red butonu.

## Denge sabitleri (başlangıç önerisi)

| Sabit | Önerilen değer | Anlamı |
|---|---|---|
| `ALLIANCE_DURATION_TICKS` | 3000 (5 dk) | ittifak süresi |
| `ALLIANCE_RENEW_WINDOW_TICKS` | 300 (30 sn) | süresi dolmadan önce yenileme teklifi gönderilebilecek pencere |
| `BETRAYAL_DEBUFF_MULTIPLIER` | 0.8 | ihanet edenin bu süre boyunca saldırı gücü çarpanı |
| `BETRAYAL_DEBUFF_DURATION_TICKS` | 1500 (2.5 dk) | cezanın süresi |
| `EMBARGO_DURATION_TICKS` | 600 (1 dk) | ittifak bozulunca otomatik ticaret ambargosu süresi (Faz 6 varsa: bu süre boyunca iki taraf arası yeni ticaret gemisi doğmaz) |

## Yapılacaklar (checklist)

- [ ] `src/core/diplomacy.ts`: `AllianceRelation`, durum geçiş fonksiyonları
- [ ] `protocol.ts`: yeni mesaj tipleri + `AllianceRelationDTO`
- [ ] `constants.ts`: yukarıdaki sabitler
- [ ] `GameState.ts`: handler'lar + mevcut saldırı yoluna `canAttack` kontrolü + tick'te süre dolumu kontrolü
- [ ] `server/index.ts`: mesaj yönlendirme + broadcast
- [ ] `main.ts`: sağ-tık bağlam menüsü, teklif bildirim UI'ı
- [ ] `renderer.ts`: müttefik kenarlık stili, hain rozeti
- [ ] Bot AI: basit kabul/red heuristiği

## Kabul kriterleri

- Bir oyuncu diğerine ittifak teklif edebiliyor, karşı taraf kabul/red edebiliyor.
- İttifak süresince taraflar birbirine saldıramıyor, altın/asker gönderebiliyor.
- İttifakı bozan tarafa geçici saldırı-gücü cezası uygulanıyor ve UI'da görünüyor.
- Süresi dolan ittifak otomatik olarak biter, taraflar tekrar saldırabilir hale gelir.

## Açık sorular / riskler

- Bitişik-olmayan saldırılar (Faz 10 nükleer) da `canAttack` kontrolünden geçmeli — bu faz Faz 10'dan önce yapılırsa, Faz 10 kendi fırlatma handler'ına aynı kontrolü eklemeyi unutmamalı (bu README'nin bağımlılık tablosunda not edilmiştir).
- Çoklu-oyunculu (>2) ittifak/blok kavramı (OpenFront'ta yok, ikili ittifaklardan oluşan gevşek ağlar var) — bu fazın kapsamı **sadece ikili ilişkiler**, "koalisyon" gibi grup kavramları kapsam dışı.
