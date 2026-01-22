import { Table, Vector, makeVector, Float32, Utf8, vectorFromArray } from 'apache-arrow';
import { TileStore } from '../data/tile_store';
// import { Tile } from '../data/tile';

export interface Column {
  name: string;
  numeric: boolean;
  categorical?: boolean;
}

export interface ColumnMetadata {
  min?: number;
  max?: number;
  categories?: string[];
  num_categories?: number;
}

export interface DataExtent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Handles data loading and metadata extraction
 */
export class DataLoader {
  private columnMetadata = new Map<string, ColumnMetadata>();
  private defaultColumn?: string;

  /**
   * Load and process config metadata from URL
   */
  async loadConfigMetadata(url: string): Promise<void> {
    try {
      const response = await fetch(`${url}/config.json`);
      if (!response.ok) {
        console.warn('config.json not found');
        return;
      }
      
      const config = await response.json();
      this.processConfig(config);
    } catch (e) {
      console.warn('Could not load config.json', e);
    }
  }

  private processConfig(config: any): void {
    if (!config.columns) return;
    
    // Store default column if specified
    if (config.default_column) {
      this.defaultColumn = config.default_column;
    }
    
    for (const col of config.columns) {
      const metadata: ColumnMetadata = {};
      
      if (col.numeric && col.min !== undefined && col.max !== undefined) {
        metadata.min = col.min;
        metadata.max = col.max;
      }
      
      if (col.categorical) {
        if (col.categories) metadata.categories = col.categories;
        if (col.num_categories !== undefined) metadata.num_categories = col.num_categories;
      }
      
      if (Object.keys(metadata).length > 0) {
        this.columnMetadata.set(col.name, metadata);
      }
    }
  }

  /**
   * Get the default column from config
   */
  getDefaultColumn(): string | undefined {
    return this.defaultColumn;
  }

  /**
   * Create Arrow table from array data
   */
  createTableFromData(data: any[], xField: string, yField: string): { table: Table; extent: DataExtent } {
    const xData = new Float32Array(data.map(d => parseFloat(d[xField])));
    const yData = new Float32Array(data.map(d => parseFloat(d[yField])));
    
    const extent = this.calculateExtentFromArrays(xData, yData);
    
    const x = makeVector(xData);
    const y = makeVector(yData);
    
    const otherCols = this.processOtherColumns(data, xField, yField);
    
    this.columnMetadata.set('x', { min: extent.minX, max: extent.maxX });
    this.columnMetadata.set('y', { min: extent.minY, max: extent.maxY });
    
    return { 
      table: new Table({ x, y, ...otherCols }), 
      extent 
    };
  }

  private calculateExtentFromArrays(xData: Float32Array, yData: Float32Array): DataExtent {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    for (let i = 0; i < xData.length; i++) {
      const x = xData[i];
      const y = yData[i];
      
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    
    return { minX, maxX, minY, maxY };
  }

  private processOtherColumns(data: any[], xField: string, yField: string): Record<string, Vector> {
    const otherCols: Record<string, Vector> = {};
    const firstRow = data[0];
    
    for (const key of Object.keys(firstRow)) {
      if (key === xField || key === yField) continue;
      
      if (typeof firstRow[key] === 'number') {
        this.processNumericColumn(data, key, otherCols);
      } else {
        this.processCategoricalColumn(data, key, otherCols);
      }
    }
    
    return otherCols;
  }

  private processNumericColumn(data: any[], key: string, otherCols: Record<string, Vector>): void {
    const colData = data.map(d => d[key]);
    otherCols[key] = vectorFromArray(colData, new Float32());
    
    const min = Math.min(...colData);
    const max = Math.max(...colData);
    this.columnMetadata.set(key, { min, max });
  }

  private processCategoricalColumn(data: any[], key: string, otherCols: Record<string, Vector>): void {
    const colData = data.map(d => String(d[key] ?? ''));
    otherCols[key] = vectorFromArray(colData, new Utf8());
    
    const uniqueValues = Array.from(new Set(colData));
    this.columnMetadata.set(key, {
      categories: uniqueValues,
      num_categories: uniqueValues.length
    });
  }

  /**
   * Calculate extent from Arrow vectors
   */
  calculateExtent(xCol: Vector, yCol: Vector, count: number): DataExtent {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    for (let i = 0; i < count; i++) {
      const x = Number(xCol.get(i));
      const y = Number(yCol.get(i));
      
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    
    return { minX, maxX, minY, maxY };
  }

  /**
   * Extract column information from schema
   */
  extractColumns(schema: any): Column[] {
    return schema.fields.map((d: any) => {
      const name = d.name;
      const numeric = d.type.toString().includes('Float');
      const metadata = this.columnMetadata.get(name);
      const categorical = metadata?.categories !== undefined || metadata?.num_categories !== undefined;
      
      return { name, numeric, categorical };
    });
  }

  /**
   * Get metadata for a column
   */
  getColumnMetadata(name: string): ColumnMetadata | undefined {
    return this.columnMetadata.get(name);
  }

  /**
   * Get all column metadata
   */
  getAllMetadata(): Map<string, ColumnMetadata> {
    return this.columnMetadata;
  }

  /**
   * Load data from URL into tile store
   */
  async loadFromUrl(url: string, tileStore: TileStore): Promise<{ columns: Column[]; extent: DataExtent | null }> {
    await tileStore.init(url);
    await this.loadConfigMetadata(url);
    
    const root = tileStore.getRoot();
    if (root?.data) {
      const columns = this.extractColumns(root.data.schema);
      const xCol = root.data.getChild('x');
      const yCol = root.data.getChild('y');
      
      if (xCol && yCol) {
        const extent = this.calculateExtent(xCol, yCol, root.data.numRows);
        return { columns, extent };
      }
      
      return { columns, extent: null };
    }
    
    return { columns: [], extent: null };
  }

  /**
   * Load data from array into tile store
   */
  loadFromArray(
    data: any[],
    xField: string,
    yField: string,
    tileStore: TileStore
  ): { columns: Column[]; extent: DataExtent } {
    const { table, extent } = this.createTableFromData(data, xField, yField);
    const columns = this.extractColumns(table.schema);
    
    tileStore.fromTable(table, {
      x: [extent.minX, extent.maxX],
      y: [extent.minY, extent.maxY]
    });
    
    return { columns, extent };
  }

  /**
   * Select default column based on heuristics:
   * 1. Use config default if provided and valid
   * 2. Look for column with 'cluster' in name (numeric or categorical)
   * 3. Prefer categorical columns
   * 4. Fall back to numeric columns
   * 5. Use any column if nothing else matches
   *
   * This is the single source of truth for default column selection.
   */
  selectDefaultColumn(columns: Column[]): string | null {
    if (columns.length === 0) return null;

    // 1. Use config default if it exists and is valid
    if (this.defaultColumn) {
      const specified = columns.find(c => c.name === this.defaultColumn);
      if (specified && (specified.numeric || specified.categorical)) {
        return specified.name;
      }
    }

    // 2. Look for 'cluster' in column name (numeric or categorical)
    const clusterCol = columns.find(c =>
      c.name.toLowerCase().includes('cluster') &&
      (c.numeric || c.categorical)
    );
    if (clusterCol) return clusterCol.name;

    // 3. Prefer categorical columns
    const categoricalCol = columns.find(c => c.categorical);
    if (categoricalCol) return categoricalCol.name;

    // 4. Fall back to numeric columns
    const numericCol = columns.find(c => c.numeric);
    if (numericCol) return numericCol.name;

    // 5. Use any column as last resort
    return columns[0].name;
  }
}
