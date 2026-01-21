import { Tile } from '../data/tile';

export interface NumericFilter {
  type: 'numeric';
  field: string;
  min: number | null;
  max: number | null;
}

export interface CategoricalFilter {
  type: 'categorical';
  field: string;
  values: Set<any>;
}

export interface StringFilter {
  type: 'string';
  field: string;
  substring: string;
}

export type Filter = NumericFilter | CategoricalFilter | StringFilter;

export class FilterManager {
  private filters: Map<string, Filter> = new Map();

  /**
   * Add or update a numeric filter
   */
  setNumericFilter(field: string, min: number | null, max: number | null): void {
    if (min === null && max === null) {
      this.filters.delete(field);
    } else {
      this.filters.set(field, {
        type: 'numeric',
        field,
        min,
        max,
      });
    }
  }

  /**
   * Add or update a categorical filter
   */
  setCategoricalFilter(field: string, values: Set<any>): void {
    if (values.size === 0) {
      this.filters.delete(field);
    } else {
      this.filters.set(field, {
        type: 'categorical',
        field,
        values,
      });
    }
  }

  /**
   * Add or update a string filter (substring search)
   */
  setStringFilter(field: string, substring: string): void {
    if (!substring || substring.trim() === '') {
      this.filters.delete(field);
    } else {
      this.filters.set(field, {
        type: 'string',
        field,
        substring: substring.toLowerCase(), // Case-insensitive search
      });
    }
  }

  /**
   * Remove a filter
   */
  removeFilter(field: string): void {
    this.filters.delete(field);
  }

  /**
   * Clear all filters
   */
  clearAll(): void {
    this.filters.clear();
  }

  /**
   * Get all active filters
   */
  getFilters(): Map<string, Filter> {
    return this.filters;
  }

  /**
   * Check if any filters are active
   */
  hasFilters(): boolean {
    return this.filters.size > 0;
  }

  /**
   * Apply filters to a tile and return a mask
   */
  applyToTile(tile: Tile): Uint8Array {
    if (!tile.data) return new Uint8Array(0);

    const count = tile.data.numRows;
    const mask = new Uint8Array(count);
    mask.fill(1); // Start with all points visible

    if (this.filters.size === 0) {
      return mask;
    }

    for (const [field, filter] of this.filters) {
      const col = tile.data.getChild(field);
      if (!col) continue;

      if (filter.type === 'numeric') {
        const { min, max } = filter;
        for (let i = 0; i < count; i++) {
          if (mask[i] === 0) continue; // Already filtered out

          const val = Number(col.get(i));
          if ((min !== null && val < min) || (max !== null && val > max)) {
            mask[i] = 0;
          }
        }
      } else if (filter.type === 'categorical') {
        const { values } = filter;
        for (let i = 0; i < count; i++) {
          if (mask[i] === 0) continue; // Already filtered out

          const val = col.get(i);
          if (!values.has(val)) {
            mask[i] = 0;
          }
        }
      } else if (filter.type === 'string') {
        const { substring } = filter;
        for (let i = 0; i < count; i++) {
          if (mask[i] === 0) continue; // Already filtered out

          const val = String(col.get(i) ?? '').toLowerCase();
          if (!val.includes(substring)) {
            mask[i] = 0;
          }
        }
      }
    }

    return mask;
  }

  /**
   * Get unique values for a categorical field
   */
  getUniqueValues(field: string, tiles: Tile[]): any[] {
    const uniqueValues = new Set<any>();

    for (const tile of tiles) {
      if (!tile.data || tile.data.numRows === 0) continue;
      const col = tile.data.getChild(field);
      if (!col) continue;

      for (let i = 0; i < col.length; i++) {
        uniqueValues.add(col.get(i));
      }
    }

    return Array.from(uniqueValues).sort((a, b) => {
      return String(a).localeCompare(String(b));
    });
  }

  /**
   * Get min/max for a numeric field
   */
  getNumericRange(field: string, tiles: Tile[]): [number, number] {
    let min = Infinity;
    let max = -Infinity;

    for (const tile of tiles) {
      if (!tile.data || tile.data.numRows === 0) continue;
      const col = tile.data.getChild(field);
      if (!col) continue;

      for (let i = 0; i < col.length; i++) {
        const val = Number(col.get(i));
        if (isFinite(val)) {
          if (val < min) min = val;
          if (val > max) max = val;
        }
      }
    }

    if (!isFinite(min) || !isFinite(max)) {
      return [0, 1];
    }

    return [min, max];
  }
}
