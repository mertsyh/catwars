export interface MapMessage {
  type: "map";
  width: number;
  height: number;
  terrain: number[];
}

export interface PlayerStateDTO {
  id: number;
  name: string;
  color: string;
  troops: number;
  gold: number;
  tileCount: number;
  /** Sahip olunan toprağın centroid'i — haritada askersayısı etiketinin çizileceği nokta (bkz. renderer setPlayerLabels). */
  centerX: number;
  centerY: number;
}

export interface BuildingDTO {
  id: number;
  type: string;
  ownerId: number;
  tileIndex: number;
}

export interface TradeShipDTO {
  id: number;
  ownerId: number;
  toOwnerId: number;
  path: number[];
  spawnTick: number;
  speedTilesPerTick: number;
  goldValue: number;
}

export interface WarshipDTO {
  id: number;
  ownerId: number;
  hp: number;
  maxHp: number;
  state: string;
  path: number[];
  pathStartTick: number;
}

export interface InitMessage {
  type: "init";
  selfId: number;
  tick: number;
  owner: number[];
  players: PlayerStateDTO[];
  buildings: BuildingDTO[];
  /** Karşılıklı savaş halindeki oyuncuların o anki cephe hattı tile'ları — istemci bunları kırmızı vurgular (bkz. GameState.computeContestedTiles). */
  contestedTiles: number[];
  tradeShips: TradeShipDTO[];
  warships: WarshipDTO[];
}

export interface TileChangeDTO {
  i: number;
  o: number;
}

export interface TickMessage {
  type: "tick";
  tick: number;
  changes: TileChangeDTO[];
  players: PlayerStateDTO[];
  buildings: BuildingDTO[];
  contestedTiles: number[];
  spawnedTradeShips: TradeShipDTO[];
  arrivedTradeShipIds: number[];
  warships: WarshipDTO[];
}

export interface GameOverMessage {
  type: "gameOver";
  winnerId: number;
  winnerName: string;
}

export type ServerMessage = MapMessage | InitMessage | TickMessage | GameOverMessage;

export interface JoinMessage {
  type: "join";
  name: string;
  /** Sadece henüz kimse katılmamışken (oyun ilk kez kuruluyorken) anlamlı. */
  mapId?: string;
  /** Bot sayısı (0..MAX_BOT_COUNT) — mapId gibi sadece oyunun ilk kurulduğu join'de geçerli. */
  botCount?: number;
}

export interface AttackMessage {
  type: "attack";
  /** Tıklanan hedef tile — fetih, buradan etrafa doğru bir alana yayılır (bkz. GameState.queueAttack). */
  tileIndex: number;
}

export interface BuildMessage {
  type: "build";
  buildingType: "city" | "defensePost" | "port";
  tileIndex: number;
}

export interface CancelAttacksMessage {
  type: "cancelAttacks";
}

export interface BuildWarshipMessage {
  type: "buildWarship";
  portBuildingId: number;
}

export interface MoveShipMessage {
  type: "moveShip";
  shipId: number;
  targetTileIndex: number;
}

export type ClientMessage =
  | JoinMessage
  | AttackMessage
  | BuildMessage
  | CancelAttacksMessage
  | BuildWarshipMessage
  | MoveShipMessage;
