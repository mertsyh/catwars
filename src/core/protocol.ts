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

export interface InitMessage {
  type: "init";
  selfId: number;
  owner: number[];
  regionOwners: RegionOwnerDTO[];
  players: PlayerStateDTO[];
  buildings: BuildingDTO[];
  sieges: SiegeDTO[];
}

export interface TileChangeDTO {
  i: number;
  o: number;
}

export interface TickMessage {
  type: "tick";
  changes: TileChangeDTO[];
  players: PlayerStateDTO[];
  buildings: BuildingDTO[];
  sieges: SiegeDTO[];
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
  buildingType: "city" | "defensePost";
  tileIndex: number;
}

export interface CancelAttacksMessage {
  type: "cancelAttacks";
}

export type ClientMessage = JoinMessage | AttackMessage | BuildMessage | CancelAttacksMessage;
