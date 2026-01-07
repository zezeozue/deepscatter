/**
 * Color encoding management
 * Handles color scale updates and legend rendering
 */

import { scaleOrdinal } from 'd3-scale';
import { schemeTableau10 } from 'd3-scale-chromatic';
import type { Scatterplot } from './src/deepscatter';
import type { FilterInfo, DataRange } from './types';
import { elements } from './src/dom';
import { updateLegend } from './visuals';
import { appState } from './app_state';

/**
 * Update the color encoding based on the selected column
 */
export async function updateColorEncoding(
  scatterplot: Scatterplot,
  numericColumns: Set<string>,
  activeFilters: Map<string, FilterInfo>
): Promise<void> {
  console.log('[ColorManager] Starting updateColorEncoding');
  const col = elements.colorColumnSelector.value;
  console.log('[ColorManager] Selected column:', col);
  const isNum = numericColumns.has(col);
  console.log('[ColorManager] Is numeric:', isNum);
  let encoding: any;
  let globalMapping: any = null;
  let range: DataRange | null = null;

  if (isNum) {
    console.log('[ColorManager] Processing numeric column');
    // Numeric color encoding
    let min = Infinity;
    let max = -Infinity;
    const tiles = scatterplot.renderer.visible_tiles();
    console.log('[ColorManager] Visible tiles count:', tiles.length);
    
    for (const t of tiles) {
      // Skip parent tiles with no data
      if (t.record_batch.numRows === 0) {
        console.log(`[ColorManager] Skipping empty tile ${t.key}`);
        continue;
      }
      const c = await t.get_column(col);
      for (const v of c) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    console.log('[ColorManager] Numeric range:', min, max);
    
    min = Number(min);
    max = Number(max);
    range = { min, max };
    
    const canUseLog = min > 0 && max > 0;
    const transform = canUseLog ? 'log' : 'linear';
    
    encoding = {
      field: col,
      transform: transform,
      domain: [min, max],
      range: ['#fde725', '#a0da39', '#4ac16d', '#1fa187', '#277f8e', '#365c8d', '#46327e', '#440154'], // viridis
    };
  } else {
    console.log('[ColorManager] Processing categorical column');
    // Categorical color encoding
    const vals = new Set<any>();
    
    // Use the original table if available (for in-memory CSV data)
    if (appState.originalTable) {
      console.log('[ColorManager] Using original table for categorical column');
      const column = appState.originalTable.getChild(col);
      if (!column) {
        console.error(`[ColorManager] Column '${col}' not found in original table`);
        return;
      }
      
      if (activeFilters.size > 0) {
        console.log('[ColorManager] Applying filters to original table');
        // Get all filter columns
        const filterColumns = new Map();
        for (const [filterColumn] of activeFilters) {
          filterColumns.set(filterColumn, appState.originalTable.getChild(filterColumn));
        }
        
        // Check each row against all active filters
        for (let i = 0; i < column.length; i++) {
          let passesAllFilters = true;
          
          for (const [filterColumn, filterInfo] of activeFilters) {
            const filterColumnData = filterColumns.get(filterColumn);
            const isFilterNumeric = numericColumns.has(filterColumn);
            
            if (isFilterNumeric) {
              const value = filterColumnData.get(i);
              const { minValue, maxValue } = filterInfo.value as { minValue: number | null; maxValue: number | null };
              
              if (minValue !== null && !isNaN(minValue) && value <= minValue) {
                passesAllFilters = false;
                break;
              }
              if (maxValue !== null && !isNaN(maxValue) && value >= maxValue) {
                passesAllFilters = false;
                break;
              }
            } else {
              if (filterColumnData.get(i) !== filterInfo.value) {
                passesAllFilters = false;
                break;
              }
            }
          }
          
          if (passesAllFilters) {
            vals.add(column.get(i));
          }
        }
      } else {
        // No active filters, include all values
        for (let i = 0; i < column.length; i++) {
          vals.add(column.get(i));
        }
      }
    } else {
      // Fallback to tiles (for server-side tile data)
      console.log('[ColorManager] Using tiles for categorical column');
      const tiles = scatterplot.renderer.visible_tiles();
      console.log('[ColorManager] Visible tiles count:', tiles.length);
      
      await Promise.all(tiles.map(async (tile: any) => {
        if (tile.record_batch.numRows === 0) {
          return;
        }
        
        const column = await tile.get_column(col);
        
        if (activeFilters.size > 0) {
          const filterColumns = new Map();
          for (const [filterColumn] of activeFilters) {
            filterColumns.set(filterColumn, await tile.get_column(filterColumn));
          }
          
          for (let i = 0; i < tile.record_batch.numRows; i++) {
            let passesAllFilters = true;
            
            for (const [filterColumn, filterInfo] of activeFilters) {
              const filterColumnData = filterColumns.get(filterColumn);
              const isFilterNumeric = numericColumns.has(filterColumn);
              
              if (isFilterNumeric) {
                const value = filterColumnData.get(i);
                const { minValue, maxValue } = filterInfo.value as { minValue: number | null; maxValue: number | null };
                
                if (minValue !== null && !isNaN(minValue) && value <= minValue) {
                  passesAllFilters = false;
                  break;
                }
                if (maxValue !== null && !isNaN(maxValue) && value >= maxValue) {
                  passesAllFilters = false;
                  break;
                }
              } else {
                if (filterColumnData.get(i) !== filterInfo.value) {
                  passesAllFilters = false;
                  break;
                }
              }
            }
            
            if (passesAllFilters) {
              vals.add(column.get(i));
            }
          }
        } else {
          console.log(`[color_manager] No filters, collecting all values, column length: ${column.length}, column type:`, column.type);
          // Use column.get(i) to properly decode dictionary-encoded strings
          for (let i = 0; i < column.length; i++) {
            const val = column.get(i);
            if (i < 3) {
              console.log(`[color_manager] Row ${i}: value=`, val, `type=${typeof val}`);
            }
            vals.add(val);
          }
        }
      }));
    }
    console.log('[ColorManager] Collected unique values:', vals.size);
    
    const sorted = Array.from(vals).sort((a, b) => {
      if (col === 'cluster_id') {
        const numA = parseInt((a as string).split('#')[1], 10);
        const numB = parseInt((b as string).split('#')[1], 10);
        return numA - numB;
      }
      return String(a).localeCompare(String(b));
    });
    
    globalMapping = Object.fromEntries(sorted.map((v, i) => [v, i]));
    console.log('[ColorManager] Created global mapping with', sorted.length, 'categories');
    
    const factName = `${col}__factorized`;
    console.log('[ColorManager] Creating transformation for', factName);
    
    // Create transformation that uses original table if available
    if (appState.originalTable) {
      // For in-memory data, use the original table
      const originalColumn = appState.originalTable.getChild(col);
      if (!originalColumn) {
        console.error(`[ColorManager] Column '${col}' not found in original table for transformation`);
        return;
      }
      scatterplot.deeptable.transformations[factName] = async (t: any) => {
        if (t.record_batch.numRows === 0) {
          return new Float32Array(0);
        }
        // Get the ix column to map back to original table rows
        const ixColumn = await t.get_column('ix');
        const result = new Float32Array(ixColumn.length);
        for (let i = 0; i < ixColumn.length; i++) {
          const originalIdx = ixColumn.get(i);
          const value = originalColumn.get(originalIdx);
          result[i] = globalMapping[value] ?? 0;
        }
        return result;
      };
    } else {
      // For server-side tiles, use the tile's column directly
      scatterplot.deeptable.transformations[factName] = async (t: any) => {
        if (t.record_batch.numRows === 0) {
          return new Float32Array(0);
        }
        const base = await t.get_column(col);
        return new Float32Array(Array.from(base).map((v: any) => globalMapping[v] ?? 0));
      };
    }
    
    // Load the factorized column for visible tiles
    const tiles = scatterplot.renderer.visible_tiles();
    console.log('[ColorManager] Loading factorized column for', tiles.length, 'tiles...');
    const loadPromises = tiles.map((tile: any) => tile.get_column(factName));
    await Promise.all(loadPromises);
    console.log('[ColorManager] Finished loading factorized columns');
    
    const scale = scaleOrdinal(schemeTableau10);
    const colorRange = sorted.length ? sorted.map(v => scale(v as any)) : ['#888888', '#888888'];
    
    encoding = {
      field: factName,
      transform: 'literal',
      range: colorRange,
    };
  }
  
  console.log('[ColorManager] Applying color encoding to plot...');
  await scatterplot.plotAPI({
    encoding: {
      color: encoding,
    },
  });
  console.log('[ColorManager] Color encoding applied');
  
  console.log('[ColorManager] Updating legend...');
  updateLegend(elements.legend, encoding, globalMapping, range);
  console.log('[ColorManager] updateColorEncoding complete');
}
