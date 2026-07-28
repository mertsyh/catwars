export const Terrain = {
  Water: 0,
  Land: 1,
} as const;

export type TerrainValue = (typeof Terrain)[keyof typeof Terrain];

export const BuildingType = {
  City: "city",
  DefensePost: "defensePost",
} as const;

export type BuildingTypeValue = (typeof BuildingType)[keyof typeof BuildingType];

export interface Building {
  id: number;
  type: BuildingTypeValue;
  ownerId: number;
  tileIndex: number;
}
