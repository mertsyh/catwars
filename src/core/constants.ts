export const TICK_RATE = 10;

/** Oyuncu (insan) doğuş asker sayısı — bot'lardan daha büyük başlar. */
export const PLAYER_STARTING_TROOPS = 2500;
/** Bot doğuş asker sayısı. */
export const BOT_STARTING_TROOPS = 1000;

/**
 * Asker kapasitesinin taban değeri — oyuncunun toprağı bağımsız her zaman
 * geçerli bir taban. PLAYER_STARTING_TROOPS'a en az eşit tutuluyor; aksi
 * halde küçük bir doğuş toprağıyla (bkz. SPAWN_TILE_COUNT) maxTroops çok
 * düşük kalır ve doğuş askerinin çoğu ilk tick'te rejenerasyon sınırına
 * (tickOnce'daki Math.min(maxTroops, troops+regen)) takılıp anında silinir.
 */
export const BASE_MAX_TROOPS = 2500;
export const TROOPS_PER_TILE = 0.5;
export const TROOP_REGEN_PER_TICK = 0.5;
export const GOLD_PER_TILE_PER_TICK = 0.02;

/** Doğuşta sahip olunacak küçük yuvarlak toprağın hedef tile sayısı (bkz. GameState.spawnHome). */
export const SPAWN_TILE_COUNT = 20;

/** Bir tile'ı ele geçirmenin taban asker maliyeti (bkz. GameState.tileCaptureCost) — üzerine savunma karakolu varsa DEFENSE_POST_GARRISON_BONUS eklenir. */
export const CAPTURE_TILE_COST = 4;

export const SIEGE_DAMAGE_PER_TICK = 4;
export const NEUTRAL_SIEGE_COST_MULTIPLIER = 1;
export const ENEMY_SIEGE_COST_MULTIPLIER = 1.5;
export const BOOST_STEP = 1;
export const MAX_BOOST = 4;

/** Bot sayısı sınırları — sunucu ilk oyuncunun `join` mesajındaki `botCount`'unu bu aralığa kırpar. */
export const MAX_BOT_COUNT = 400;
export const DEFAULT_BOT_COUNT = 20;

/** Asker bu oranın altına düşerse bot TÜM cephelerini iptal edip dinlenmeye geçer (rejenerasyonu bekler) — sürekli sıfıra kilitlenmesin diye. */
export const BOT_REST_TROOP_FRACTION = 0.15;
/** Yeni bir cephe açmak için asker bu oranın üstünde olmalı (dinlenme eşiğinden yüksek tutuluyor ki durum sürekli gidip gelmesin). */
export const BOT_ATTACK_TROOP_FRACTION = 0.4;
/** Bir bot'un aynı anda açık tutabileceği en fazla farklı hedefe (cepheye) karşı saldırı sayısı — sınırsız cephe açıp asker tüketmesin diye. */
export const BOT_MAX_CONCURRENT_ORDERS = 3;

export const CAPTURE_DEFENDER_TROOP_LOSS_RATIO = 0.3;

export const WIN_LAND_FRACTION = 0.72;

export const CITY_COST = 300;
/** Asker kapasitesine tek seferlik ek. */
export const CITY_TROOP_BONUS = 300;
/** Şehir başına, TROOP_REGEN_PER_TICK'e eklenen sürekli asker üretimi — "ev ekleyince daha çok asker üretebilmeliyiz". */
export const CITY_TROOP_REGEN_BONUS = 0.3;

export const DEFENSE_POST_COST = 200;
/** Karakolun etki yarıçapı (tile) — bu mesafedeki HER düşman fetih tile'ı için ek maliyet uygulanır (bkz. GameState.tileCaptureCost), sadece üzerinde durduğu tek tile değil. */
export const DEFENSE_POST_RADIUS = 4;
/** Etki alanındaki bir tile'ı ele geçirmenin ek asker maliyeti (yavaşlatma). */
export const DEFENSE_POST_GARRISON_BONUS = 20;
/** Etki alanında bir tile ele geçirildiğinde saldırganın ANLIK kaybettiği ek asker (karakolun "vurması"). */
export const DEFENSE_POST_TROOP_DRAIN = 15;

export const PORT_COST_BASE = 450;
export const PORT_COST_MULTIPLIER = 2;
export const PORT_COST_CAP = 3600;

export const MAX_TRADE_SHIPS = 12;
export const TRADE_SHIP_SPAWN_INTERVAL_TICKS = 40;
export const TRADE_SHIP_SPEED_TILES_PER_TICK = 1.5;
export const TRADE_SHIP_BASE_GOLD = 15;
export const TRADE_SHIP_GOLD_PER_TILE = 0.4;
export const TRADE_SHIP_CAPTURE_BONUS_GOLD = 100;

export const WARSHIP_COST_BASE = 800;
export const WARSHIP_COST_INCREMENT = 400;
export const WARSHIP_COST_CAP = 3000;
export const WARSHIP_BUILD_TICKS = 30;
export const WARSHIP_MAX_HP = 200;
export const WARSHIP_DAMAGE_PER_TICK = 20;
export const WARSHIP_RANGE = 6;
export const WARSHIP_CAPTURE_RANGE = 3;
export const WARSHIP_SPEED_TILES_PER_TICK = 1.2;
export const WARSHIP_RETREAT_HP_FRACTION = 0.3;

/**
 * Bilinçli olarak açık/pastel tonlar — koyu nötr toprakla (LAND_COLOR)
 * güçlü kontrast oluştursun diye. Doygun kırmızıdan kaçınılıyor: o renk
 * savaş/cephe hattı vurgusuna ayrılmış durumda (bkz. renderer.ts
 * drawContestedTiles) — buradaki #E99A92 gibi açık/soluk tonlar onunla
 * karışmıyor (kaplama %60 opaklıkta belirgin şekilde koyulaşıp doygunlaşıyor).
 */
export const PLAYER_COLORS = [
  "#E99A92",
  "#9AC1E9",
  "#E9D592",
  "#C79AE9",
  "#92E9C7",
  "#E9B892",
  "#D6E9E9",
  "#A0A9B8",
];
