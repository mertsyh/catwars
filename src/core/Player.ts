import { BASE_MAX_TROOPS, CITY_TROOP_BONUS, TROOPS_PER_TILE } from "./constants";

export interface PlayerInfo {
  id: number;
  name: string;
  color: string;
  startingTroops: number;
}

export class Player {
  readonly id: number;
  readonly name: string;
  readonly color: string;
  troops: number;
  gold = 0;
  tileCount = 0;
  cityCount = 0;

  /** Sahip olunan tile koordinatlarının koşan toplamı — centerX/centerY'yi O(1) hesaplayabilmek için (bkz. GameState'in sahiplik değişikliklerinde güncellemesi). */
  private sumX = 0;
  private sumY = 0;

  constructor(info: PlayerInfo) {
    this.id = info.id;
    this.name = info.name;
    this.color = info.color;
    this.troops = info.startingTroops;
  }

  get maxTroops(): number {
    return BASE_MAX_TROOPS + this.tileCount * TROOPS_PER_TILE + this.cityCount * CITY_TROOP_BONUS;
  }

  get centerX(): number {
    return this.tileCount > 0 ? this.sumX / this.tileCount : 0;
  }

  get centerY(): number {
    return this.tileCount > 0 ? this.sumY / this.tileCount : 0;
  }

  /** Bir tile kazanınca/kaybedince centroid'i O(1) günceller (sign: +1 kazanç, -1 kayıp). */
  addTileCoords(x: number, y: number, sign: 1 | -1): void {
    this.sumX += x * sign;
    this.sumY += y * sign;
  }
}
