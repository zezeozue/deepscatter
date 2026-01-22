import { Tile, BBox } from './tile';
import { Table, vectorFromArray } from 'apache-arrow';
import { TileLoader } from './tile_loader';

export class TileStore {
  private tiles: Map<string, Tile> = new Map();
  private loader: TileLoader | null = null;
  private rootKey = '0/0/0';
  private loading = new Set<string>();
  public onTileLoad: (() => void) | null = null;

  constructor() {}

  public clear() {
    this.tiles.clear();
  }

  public setRoot(key: string) {
      this.rootKey = key;
  }

  public getRoot(): Tile | undefined {
      return this.tiles.get(this.rootKey);
  }

  public addTile(tile: Tile) {
    this.tiles.set(tile.key, tile);
  }

  public async init(url: string) {
    this.loader = new TileLoader(url);
    await this.loadTile(this.rootKey);
  }

  public async loadTile(key: string) {
    if (!this.loader) return;
    if (this.tiles.has(key)) return;
    if (this.loading.has(key)) return;

    this.loading.add(key);

    // Create placeholder
    const tile = new Tile(key, this.getBBoxFromKey(key));
    this.tiles.set(key, tile);

    try {
      const table = await this.loader.fetchTile(key);
      tile.data = table;
      tile.isLoaded = true;
      
      const json = table.schema.metadata.get('json');
      if (json) {
          try {
              const meta = JSON.parse(json);
              if (meta.children) {
                  tile.children = meta.children;
              }
          } catch (e) {
              console.warn('Failed to parse tile metadata', e);
          }
      }

      console.log(`Loaded tile ${key} with ${table.numRows} rows`);
    } catch (e) {
      console.warn(`Tile ${key} failed to load or does not exist`);
      this.tiles.delete(key);
    } finally {
        this.loading.delete(key);
    }
  }

  private getBBoxFromKey(key: string): BBox {
    // key: depth/x/y
    const parts = key.split('/').map(Number);
    if (parts.length !== 3) return { x: [0, 1], y: [0, 1] };

    const [d, x, y] = parts;
    const max = Math.pow(2, d);
    
    // Normalized 0-1
    const w = 1 / max;
    return {
        x: [x * w, (x + 1) * w],
        y: [y * w, (y + 1) * w]
    };
  }

  public getTiles(): Tile[] {
      return Array.from(this.tiles.values()).filter(t => t.isLoaded);
  }
  
  public getAllTiles(): Tile[] {
      return Array.from(this.tiles.values()).filter(t => t.isLoaded);
  }
  
  public update(viewport: BBox) {
      // console.log('TileStore update viewport:', viewport);
      this.traverse(this.rootKey, viewport);
  }

  private traverse(key: string, viewport: BBox) {
      if (!this.tiles.has(key)) {
          // console.log(`Traverse: Requesting ${key}`);
          this.loadTile(key);
          return;
      }

      const tile = this.tiles.get(key)!;
      if (!tile.isLoaded) {
          // console.log(`Traverse: ${key} waiting for load`);
          return;
      }

      // If tile is not visible, don't process children?
      // But we are traversing from root. If root intersects, we check children.
      if (!this.intersects(tile.bbox, viewport)) {
          // console.log(`Traverse: ${key} not visible`);
          return;
      }

      // console.log(`Traverse: ${key} visible. Children: ${tile.children ? tile.children.length : 0}`);

      // Check children
      if (tile.children) {
        for (const childKey of tile.children) {
            const childBBox = this.getBBoxFromKey(childKey);
            if (this.intersects(childBBox, viewport)) {
                this.traverse(childKey, viewport);
            } else {
                // console.log(`Traverse: Child ${childKey} not visible`);
            }
        }
      }
  }

  private intersects(a: BBox, b: BBox): boolean {
    return (
      a.x[0] <= b.x[1] && a.x[1] >= b.x[0] &&
      a.y[0] <= b.y[1] && a.y[1] >= b.y[0]
    );
    }
  
    public fromTable(table: Table, bbox: BBox) {
      this.clear();
      this.rootKey = '0/0/0';
  
      const x = table.getChild('x')!;
      const y = table.getChild('y')!;
  
      const partition = (indices: Uint32Array, currentBbox: BBox, key: string) => {
          const tile = new Tile(key, currentBbox);
          
          if (indices.length < 10000 || key.split('/').length > 5) {
              const newColumns = table.schema.fields.map((field) => {
                  const vector = table.getChild(field.name)!;
                  const selectedValues = Array.from(indices).map(i => vector.get(i));
                  return vectorFromArray(selectedValues, field.type);
              });
              const newTable = new Table(Object.fromEntries(newColumns.map((c, i) => [table.schema.fields[i].name, c])));
              tile.data = newTable;
              tile.isLoaded = true;
              this.addTile(tile);
              return;
          }
  
          const [z, tx, ty] = key.split('/').map(Number);
          const childZ = z + 1;
          const childTX = tx * 2;
          const childTY = ty * 2;
          tile.children = [
              `${childZ}/${childTX}/${childTY}`,
              `${childZ}/${childTX + 1}/${childTY}`,
              `${childZ}/${childTX}/${childTY + 1}`,
              `${childZ}/${childTX + 1}/${childTY + 1}`,
          ];
          this.addTile(tile);
          
          const midX = (currentBbox.x[0] + currentBbox.x[1]) / 2;
          const midY = (currentBbox.y[0] + currentBbox.y[1]) / 2;
  
          const childIndices: number[][] = [[], [], [], []];
          
          for (const i of indices) {
              const xi = x.get(i)!;
              const yi = y.get(i)!;
              const quad = (xi > midX ? 1 : 0) + (yi > midY ? 2 : 0);
              childIndices[quad].push(i);
          }
          
          const childBBoxes: BBox[] = [
              { x: [currentBbox.x[0], midX], y: [currentBbox.y[0], midY] },
              { x: [midX, currentBbox.x[1]], y: [currentBbox.y[0], midY] },
              { x: [currentBbox.x[0], midX], y: [midY, currentBbox.y[1]] },
              { x: [midX, currentBbox.x[1]], y: [midY, currentBbox.y[1]] },
          ];
  
          for (let i=0; i<4; i++) {
              if (childIndices[i].length > 0) {
                  partition(new Uint32Array(childIndices[i]), childBBoxes[i], tile.children[i]);
              }
          }
      }
      
      const initialIndices = new Uint32Array(table.numRows);
      for (let i=0; i<table.numRows; i++) initialIndices[i] = i;
  
      partition(initialIndices, bbox, this.rootKey);
    }
  }
