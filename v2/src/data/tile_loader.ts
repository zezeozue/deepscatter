import { tableFromIPC, Table, makeVector } from 'apache-arrow';

export class TileLoader {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  }

  public async fetchTile(key: string): Promise<Table> {
    const url = `${this.baseUrl}${key}.feather`;
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            if (key === '0/0/0') {
                 console.warn(`Tile 0/0/0 not found at ${url}, generating synthetic data.`);
                 return this.createSyntheticTile();
            }
            throw new Error(`Failed to fetch tile ${key}: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        return tableFromIPC(buffer);
    } catch (e) {
        if (key === '0/0/0') {
             console.warn(`Could not load tile 0/0/0, generating synthetic data.`);
             return this.createSyntheticTile();
        }
        console.warn(`Could not load tile ${key}`, e);
        throw e;
    }
  }

  private createSyntheticTile(): Table {
      const N = 10000;
      const x = new Float32Array(N);
      const y = new Float32Array(N);
      
      for(let i=0; i<N; i++) {
          x[i] = Math.random();
          y[i] = Math.random();
      }
      
      return new Table({
          x: makeVector(x),
          y: makeVector(y)
      });
  }
}
