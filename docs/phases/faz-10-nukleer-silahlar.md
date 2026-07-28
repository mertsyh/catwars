# Faz 10 — Nükleer Silahlar

**Bağımlılık:** yok (bölge/tile modeli üzerinde çalışır, gemi/harita fazlarından bağımsız)
**Boyut:** Orta-Büyük — yeni bina türleri + yeni "alan hasarı" mekaniği + yeni bir uzun-menzilli hedefleme input modu.

## Amaç

Kuşatma sistemi şu an sadece **bitişik** bölgelere saldırmaya izin veriyor (bkz. PROGRESS.md §4: "Sınıra bitişik bir bölgeye tıklayınca..."). Nükleer silahlar, haritanın **herhangi bir yerine** vurabilen, hazırlık gerektiren (silo inşası), yıkıcı ama savunulabilir (SAM) bir üst-seviye askeri katman ekliyor — oyunun geç oyun dinamiğine derinlik katıyor.

## OpenFront'ta nasıl çalışıyor (tasarım referansı)

Füze Silosu, tüm nükleer silahları açmanın ön koşulu. Atom Bombası tek hedefe orta çaplı hasar veriyor; Hidrojen Bombası daha büyük ve yıkıcı; MIRV tek fırlatmada birden fazla savaş başlığına ayrılıp yayılı bir alana düşüyor. SAM Fırlatıcısı savunma yapısı — gelen Atom/Hidrojen bombasını olasılıksal olarak (silaha göre değişen bir yüzdeyle) engelliyor, MIRV'e karşı bizim basitleştirilmiş sürümümüzde farklı davranabilir (bkz. Açık sorular).

## Bizim oyuna nasıl uyarlanacak

- Hedefleme **bölge bazlı** olacak (tile bazlı değil) — mevcut saldırı input desenine (bölgeye tıkla) benziyor ama bitişiklik kontrolü yok, herhangi bir görünür bölgeye tıklanabilir.
- "Alan hasarı" ilk kez birden fazla bölgeyi tek olayda etkileyen bir mekanik — hedef bölge + `regions[].neighbors` grafiği üzerinden N-adım genişleyen bir hasar dağılımı (mevcut komşuluk grafiği zaten `regions.ts`'te var, yeniden kullanılabilir).
- Füze uçuşu, Faz 6'daki "path + spawnTick" interpolasyon desenini tekrar kullanır (görsel amaçlı, çarpışma hesaplaması ise varış tick'inde sunucuda anlık yapılır).

## Veri modeli değişiklikleri

**`src/core/types.ts`**
```ts
BuildingType.MissileSilo = "missileSilo"
BuildingType.SamLauncher = "samLauncher"

type NukeWeapon = "atom" | "hydrogen" | "mirv";

interface Missile {
  id: number;
  ownerId: number;
  weapon: NukeWeapon;
  fromTile: number;
  targetRegionId: number;
  launchTick: number;
  impactTick: number;
  intercepted: boolean;   // SAM sonucu, varışta belli olur ama erken hesaplanıp client'a haber verilir
}
```

**`src/core/protocol.ts`**
```ts
interface LaunchNukeMessage {
  type: "launchNuke";
  siloBuildingId: number;
  weapon: NukeWeapon;
  targetRegionId: number;
}
```
`BuildMessage.buildingType` union'a `"missileSilo" | "samLauncher"` ekle. Tick/init mesajlarına `missiles: MissileDTO[]` ekle.

## Sunucu değişiklikleri

- `GameState.ts`:
  - Silo inşası + fırlatma soğuma süresi (`SILO_COOLDOWN_TICKS`) takibi.
  - `launchNuke`: silo sahipliği + soğuma kontrolü, `Missile` state'ine ekle, `impactTick = now + uçuşSüresi(mesafe)`.
  - Her tick: `impactTick`'e ulaşan füzeler için:
    1. Menzildeki her düşman SAM'ı için engelleme olasılığı zar at (silaha göre farklı yüzde — bkz. tablo).
    2. Engellenmediyse `applyBlastDamage(targetRegionId, weapon)`: hedef bölgenin garrison'unu büyük oranda düşür/sıfırla, üzerindeki binaları yık; MIRV için hedef bölge + komşularına (graf üzerinden 1-2 adım) dağılan, merkeze göre azalan hasar uygula.
- `server/index.ts`: yeni mesajı yönlendir, `missiles` broadcast'e ekle.

## İstemci değişiklikleri

- `renderer.ts`: silo/SAM ikonları, füze için basit balistik-yay çizgisi animasyonu (spawnTick→impactTick interpolasyonu), varışta patlama efekti (dairesel genişleyen halka), SAM engellemesinde iz + parlama efekti.
- `main.ts`: silo seçiliyken "Atom/Hidrojen/MIRV fırlat" seçenekleri (yalnızca ilgili bina inşa edilmişse ve soğuma bitmişse aktif), sonra herhangi bir bölgeye tıklayarak hedef seçme modu (mevcut saldırı tıklama akışına benzer ama bitişiklik kontrolsüz).

## Denge sabitleri (başlangıç önerisi)

Mevcut ölçek (`CITY_COST=300`, bölge `garrison` tipik 50-150 aralığında) referans alınarak, OpenFront'un harita-çapında yıkım yaratan sayıları **tek bölge/birkaç komşu bölge** ölçeğine indirgendi.

| Sabit | Önerilen değer | Anlamı |
|---|---|---|
| `MISSILE_SILO_COST` | 600 | silo maliyeti |
| `SAM_LAUNCHER_COST` | 500 | SAM maliyeti |
| `SILO_COOLDOWN_TICKS` | 100 (10 sn) | aynı silodan art arda fırlatma arası bekleme |
| `ATOM_BOMB_COST` | 400 | fırlatma maliyeti (altın) |
| `ATOM_BOMB_GARRISON_DAMAGE_FRACTION` | 0.8 | hedef bölge garrison'unun kaybettiği oran |
| `HYDROGEN_BOMB_COST` | 900 | fırlatma maliyeti |
| `HYDROGEN_BOMB_GARRISON_DAMAGE_FRACTION` | 1.0 (tamamı) | + doğrudan komşu bölgelere `%30` yayılım hasarı |
| `MIRV_COST` | 1600 | fırlatma maliyeti |
| `MIRV_TARGET_SPREAD` | hedef + rastgele 2 komşu bölge | her biri hidrojen bombasının ~%60'ı kadar hasar |
| `SAM_INTERCEPT_CHANCE_ATOM` | 0.75 | atom bombasını engelleme olasılığı |
| `SAM_INTERCEPT_CHANCE_HYDROGEN` | 0.5 | hidrojen bombasını engelleme olasılığı |
| `SAM_INTERCEPT_CHANCE_MIRV_PER_WARHEAD` | 0.35 | MIRV'in her bir savaş başlığı için ayrı ayrı engelleme şansı (OpenFront'taki "MIRV hiç engellenemez" kuralından bilinçli sapma — bkz. Açık sorular) |
| `SAM_COOLDOWN_TICKS` | 30 | ardışık iki engelleme denemesi arası |

## Yapılacaklar (checklist)

- [ ] `types.ts`: `BuildingType.MissileSilo/SamLauncher`, `Missile`/`NukeWeapon`
- [ ] `protocol.ts`: `LaunchNukeMessage`, `MissileDTO`, `BuildMessage` union güncelle
- [ ] `constants.ts`: yukarıdaki sabitler
- [ ] `regions.ts`: komşuluk grafiğinin yayılım hasarı için yeniden kullanılabilir bir `neighborsWithinSteps(regionId, steps)` yardımcı fonksiyonu (yoksa ekle)
- [ ] `GameState.ts`: silo/SAM inşası, fırlatma, soğuma, çarpışma çözümü (`applyBlastDamage`), SAM engelleme zar atma
- [ ] `server/index.ts`: mesaj yönlendirme + broadcast
- [ ] `renderer.ts`: silo/SAM ikonları, füze animasyonu, patlama/engelleme efektleri
- [ ] `main.ts`: silahseçimi + hedef bölge tıklama akışı

## Kabul kriterleri

- Silo inşa edilmeden fırlatma yapılamıyor; soğuma süresi dolmadan ikinci fırlatma engelleniyor.
- Atom bombası hedef bölgenin garrison'unu ağır biçimde düşürüyor/sıfırlıyor ve üzerindeki binaları yıkıyor.
- Hedef oyuncunun SAM'ı varsa bombalar bazen (yapılandırılan olasılıkla) engelleniyor, engelleme görsel olarak ayrıştırılabiliyor.
- MIRV, hedef bölge + en az bir komşu bölgeyi etkiliyor.

## Açık sorular / riskler

- **MIRV'in engellenebilirliği**: OpenFront'ta MIRV SAM'a karşı bağışık; burada bilinçli olarak "her savaş başlığı ayrı ayrı, düşük ihtimalle engellenebilir" öneriliyor çünkü bizim küçük oyuncu sayımızda "kesinlikle engellenemez, harita-çapında yıkım" mekaniği oyunu tek hamlede bitirebilir. Bu bir denge tercihi — playtest sonrası OpenFront'un "bağışık" kuralına dönülebilir.
- Alan hasarının **denizdeki** limanlara/gemilere etkisi bu fazın kapsamında mı? Öneri: hayır — bu faz sadece kara bölgeleri + üzerindeki binaları hedeflesin, deniz birimlerine nükleer hasar ayrı, isteğe bağlı bir küçük ek olarak Faz 7'den sonra düşünülebilir.
- Nötr (sahipsiz) bölgelere nükleer atma anlamlı mı (garrison'u zaten düşükse fayda az)? Öneri: sadece oyuncuya ait bölgelere fırlatma izni ver, nötr hedefleme engellensin — gereksiz karmaşıklığı önler.
