import { Tile, BBox } from './tile';
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
  
  public update(viewport: BBox) {
      console.log('TileStore update viewport:', viewport);
      this.traverse(this.rootKey, viewport);
  }

  private traverse(key: string, viewport: BBox) {
      if (!this.tiles.has(key)) {
          console.log(`Traverse: Requesting ${key}`);
          this.loadTile(key);
          return;
      }

      const tile = this.tiles.get(key)!;
      if (!tile.isLoaded) {
          console.log(`Traverse: ${key} waiting for load`);
          return;
      }

      // If tile is not visible, don't process children?
      // But we are traversing from root. If root intersects, we check children.
      if (!this.intersects(tile.bbox, viewport)) {
          console.log(`Traverse: ${key} not visible`);
          return;
      }

      console.log(`Traverse: ${key} visible. Children: ${tile.children ? tile.children.length : 0}`);

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
}
