import { BASE_MAX_TROOPS, CITY_TROOP_BONUS, STARTING_TROOPS, TROOPS_PER_TILE } from "./constants";

export interface PlayerInfo {
  id: number;
  name: string;
  color: string;
}

export class Player {
  readonly id: number;
  readonly name: string;
  readonly color: string;
  troops = STARTING_TROOPS;
  gold = 0;
  tileCount = 0;
  cityCount = 0;

  constructor(info: PlayerInfo) {
    this.id = info.id;
    this.name = info.name;
    this.color = info.color;
  }

  get maxTroops(): number {
    return BASE_MAX_TROOPS + this.tileCount * TROOPS_PER_TILE + this.cityCount * CITY_TROOP_BONUS;
  }
}
