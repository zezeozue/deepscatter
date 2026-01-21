import { Table } from 'apache-arrow';

export interface BBox {
  x: [number, number];
  y: [number, number];
}

export class Tile {
  public key: string;
  public bbox: BBox;
  public data: Table | null = null;
  public children: string[] = [];
  public isLoaded: boolean = false;
  
  // Track visual state
  public visualsVersion: number = -1;

  constructor(key: string, bbox: BBox) {
    this.key = key;
    this.bbox = bbox;
  }
}
