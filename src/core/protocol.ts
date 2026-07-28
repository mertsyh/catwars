export interface RegionMeta {
  id: number;
  name: string;
  centerX: number;
  centerY: number;
  neighbors: number[];
}

export interface MapMessage {
  type: "map";
  width: number;
  height: number;
  terrain: number[];
  regionOf: number[];
  regions: RegionMeta[];
}

export interface PlayerStateDTO {
  id: number;
  name: string;
  color: string;
  troops: number;
  gold: number;
  tileCount: number;
}

export interface BuildingDTO {
  id: number;
  type: string;
  ownerId: number;
  tileIndex: number;
}

export interface SiegeDTO {
  regionId: number;
  attackerId: number;
  garrison: number;
  maxGarrison: number;
}

export interface RegionOwnerDTO {
  id: number;
  ownerId: number;
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
  regionOwners: RegionOwnerDTO[];
  players: PlayerStateDTO[];
  buildings: BuildingDTO[];
  sieges: SiegeDTO[];
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
  sieges: SiegeDTO[];
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
}

export interface AttackMessage {
  type: "attack";
  regionId: number;
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
