export type GarmentCategory = 'top' | 'bottom' | 'outer' | 'accessory';

export interface Garment {
  id: string;
  name: string;
  category: GarmentCategory;
  color: string;
  accent: string;
  description: string;
}

export interface Placement {
  id: string;
  garment: Garment;
  x: number;
  y: number;
}
