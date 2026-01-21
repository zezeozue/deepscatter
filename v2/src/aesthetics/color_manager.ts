import { ScatterGL } from '../core/scatter_gl';
import { Tile } from '../data/tile';

export interface ColorScale {
  type: 'numeric' | 'categorical';
  field: string;
  domain?: [number, number];
  mapping?: Map<any, number>;
  colors: [number, number, number][];
}

// Tableau-inspired color palette with good interpolation
const TABLEAU_GRADIENT_COLORS: [number, number, number][] = [
  [0.122, 0.467, 0.706], // Tableau blue (low)
  [0.090, 0.745, 0.812], // Tableau cyan
  [0.173, 0.627, 0.173], // Tableau green
  [0.498, 0.788, 0.498], // Light green
  [0.737, 0.741, 0.133], // Tableau yellow-green
  [1.000, 0.843, 0.000], // Gold
  [1.000, 0.498, 0.055], // Tableau orange
  [0.839, 0.153, 0.157], // Tableau red (high)
];

// Tableau10 color palette for categorical data
const TABLEAU10_COLORS: [number, number, number][] = [
  [0.122, 0.467, 0.706],
  [1.000, 0.498, 0.055],
  [0.173, 0.627, 0.173],
  [0.839, 0.153, 0.157],
  [0.580, 0.404, 0.741],
  [0.549, 0.337, 0.294],
  [0.890, 0.467, 0.761],
  [0.498, 0.498, 0.498],
  [0.737, 0.741, 0.133],
  [0.090, 0.745, 0.812],
];

export class ColorManager {
  private currentScale: ColorScale | null = null;

  /**
   * Create a numeric color scale with automatic log/linear detection
   * Can optionally use metadata for min/max instead of scanning tiles
   */
  createNumericScale(field: string, tiles: Tile[], metadata?: {min: number, max: number}): ColorScale {
    let min: number;
    let max: number;

    if (metadata) {
      // Use provided metadata (from config.json or calculated upfront)
      min = metadata.min;
      max = metadata.max;
    } else {
      // Fallback: scan tiles
      min = Infinity;
      max = -Infinity;

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
        min = 0;
        max = 1;
      }
    }

    // Use log scale if range spans more than 2 orders of magnitude and min > 0
    const useLogScale = min > 0 && (max / min) > 100;

    this.currentScale = {
      type: 'numeric',
      field,
      domain: useLogScale ? [Math.log10(min), Math.log10(max)] : [min, max],
      colors: TABLEAU_GRADIENT_COLORS,
      useLogScale,
      originalDomain: [min, max], // Store original values for legend
    } as any;

    return this.currentScale;
  }

  /**
   * Create a categorical color scale
   */
  createCategoricalScale(field: string, tiles: Tile[]): ColorScale {
    const uniqueValues = new Set<any>();

    for (const tile of tiles) {
      if (!tile.data || tile.data.numRows === 0) continue;
      const col = tile.data.getChild(field);
      if (!col) continue;

      for (let i = 0; i < col.length; i++) {
        uniqueValues.add(col.get(i));
      }
    }

    const sorted = Array.from(uniqueValues).sort((a, b) => {
      return String(a).localeCompare(String(b));
    });

    const mapping = new Map<any, number>();
    sorted.forEach((val, idx) => {
      mapping.set(val, idx);
    });

    this.currentScale = {
      type: 'categorical',
      field,
      mapping,
      colors: TABLEAU10_COLORS,
    };

    return this.currentScale;
  }

  /**
   * Create a categorical color scale from a pre-computed list of categories
   * This avoids scanning tiles when categories are already known
   */
  createCategoricalScaleFromList(field: string, categories: string[]): ColorScale {
    const mapping = new Map<any, number>();
    categories.forEach((val, idx) => {
      mapping.set(val, idx);
    });

    this.currentScale = {
      type: 'categorical',
      field,
      mapping,
      colors: TABLEAU10_COLORS,
    };

    return this.currentScale;
  }

  /**
   * Apply color scale to a tile
   */
  applyToTile(tile: Tile, scale: ColorScale): Float32Array {
    if (!tile.data) return new Float32Array(0);

    const count = tile.data.numRows;
    const colors = new Float32Array(count * 3);
    const col = tile.data.getChild(scale.field);

    if (!col) {
      // Missing column - use gray
      for (let i = 0; i < count; i++) {
        colors[i * 3] = 0.5;
        colors[i * 3 + 1] = 0.5;
        colors[i * 3 + 2] = 0.5;
      }
      return colors;
    }

    if (scale.type === 'numeric' && scale.domain) {
      const [min, max] = scale.domain;
      const span = max - min;
      const useLogScale = (scale as any).useLogScale;
      
      // Handle edge case where all values are the same
      if (span === 0 || !isFinite(span)) {
        const midColor = scale.colors[Math.floor(scale.colors.length / 2)];
        for (let i = 0; i < count; i++) {
          colors[i * 3] = midColor[0];
          colors[i * 3 + 1] = midColor[1];
          colors[i * 3 + 2] = midColor[2];
        }
        return colors;
      }

      for (let i = 0; i < count; i++) {
        let val = Number(col.get(i));
        
        if (!isFinite(val)) {
          // Handle NaN/Infinity with gray
          colors[i * 3] = 0.5;
          colors[i * 3 + 1] = 0.5;
          colors[i * 3 + 2] = 0.5;
          continue;
        }
        
        // Apply log transform if needed
        if (useLogScale && val > 0) {
          val = Math.log10(val);
        }
        
        let t = (val - min) / span;
        t = Math.max(0, Math.min(1, t));

        const colorIdx = t * (scale.colors.length - 1);
        const idx0 = Math.floor(colorIdx);
        const idx1 = Math.min(idx0 + 1, scale.colors.length - 1);
        const frac = colorIdx - idx0;

        const c0 = scale.colors[idx0];
        const c1 = scale.colors[idx1];

        colors[i * 3] = c0[0] + (c1[0] - c0[0]) * frac;
        colors[i * 3 + 1] = c0[1] + (c1[1] - c0[1]) * frac;
        colors[i * 3 + 2] = c0[2] + (c1[2] - c0[2]) * frac;
      }
    } else if (scale.type === 'categorical' && scale.mapping) {
      for (let i = 0; i < count; i++) {
        const val = col.get(i);
        const idx = scale.mapping.get(val) ?? 0;
        const color = scale.colors[idx % scale.colors.length];

        colors[i * 3] = color[0];
        colors[i * 3 + 1] = color[1];
        colors[i * 3 + 2] = color[2];
      }
    }

    return colors;
  }

  /**
   * Get current scale
   */
  getCurrentScale(): ColorScale | null {
    return this.currentScale;
  }

  /**
   * Clear current scale
   */
  clearScale(): void {
    this.currentScale = null;
  }
}
