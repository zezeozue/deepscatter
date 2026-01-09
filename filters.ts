/**
 * Filter management
 * Handles filter application and UI updates
 */

import type { Scatterplot } from './src/deepscatter';
import type { FilterInfo } from './types';
import { elements } from './src/dom';
import { updateColorEncoding } from './color_manager';

/**
 * Update filter chips display
 */
export function updateFilterChips(
  activeFilters: Map<string, FilterInfo>,
  onRemove: (column: string) => void
): void {
  elements.filterChipsContainer.innerHTML = '';
  
  activeFilters.forEach((info, column) => {
    const chip = document.createElement('div');
    chip.className = 'filter-chip';
    chip.innerHTML = `<span class="filter-chip-text">${info.displayText}</span>`;
    
    const btn = document.createElement('button');
    btn.className = 'filter-chip-remove';
    btn.innerHTML = '×';
    btn.title = 'Remove filter';
    btn.onclick = () => onRemove(column);
    
    chip.appendChild(btn);
    elements.filterChipsContainer.appendChild(chip);
  });
}

/**
 * Remove a filter
 */
export async function removeFilter(
  column: string,
  activeFilters: Map<string, FilterInfo>,
  scatterplot: Scatterplot,
  numericColumns: Set<string>
): Promise<void> {
  activeFilters.delete(column);
  updateFilterChips(activeFilters, (col) => removeFilter(col, activeFilters, scatterplot, numericColumns));
  
  if (elements.filterColumnSelector.value === column) {
    await updateFilterValueInput(scatterplot, numericColumns, activeFilters);
  }
  
  // Simply reapply all filters (or clear if none remain)
  await applyAllFilters(activeFilters, scatterplot, numericColumns);
}

/**
 * Apply all active filters
 */
export async function applyAllFilters(
  activeFilters: Map<string, FilterInfo>,
  scatterplot: Scatterplot,
  numericColumns: Set<string>
): Promise<void> {
  // Clean up old filter transformations first (always, even when clearing)
  const oldFilterKeys = Object.keys(scatterplot.deeptable.transformations).filter(
    key => key.startsWith('combined_filter_')
  );
  for (const key of oldFilterKeys) {
    delete scatterplot.deeptable.transformations[key];
  }
  
  if (activeFilters.size === 0) {
    
    // IMPORTANT: Deepscatter caches which columns tiles need to load
    // We must clear the prefs BEFORE calling plotAPI to prevent it from
    // trying to load the old filter column for new tiles
    
    // First, force clear the prefs to remove any cached column requirements
    if (scatterplot.prefs && scatterplot.prefs.encoding) {
      scatterplot.prefs.encoding.foreground = null;
      scatterplot.prefs.encoding.filter = null;
    }
    
    // Now clear the encoding and reset opacity
    // When filters are applied, background opacity is set to 0.01
    // When we clear filters, ALL points become "background" with that low opacity
    await scatterplot.plotAPI({
      encoding: {
        filter: null,
        foreground: null,
      },
      alpha: 1.0,  // Reset overall point opacity
      point_size: 1.0,  // Reset point size
      background_options: { opacity: 1.0, size: 1.0 },
      duration: 0,
    });
    
    // Wait a tick for the plot to settle before updating colors
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Update color encoding with no filters
    await updateColorEncoding(scatterplot, numericColumns, activeFilters);
    return;
  }
  
  // Use a unique name for each filter application to avoid caching issues
  const combinedName = `combined_filter_${Date.now()}`;
  
  try {
    
    const selection = await scatterplot.deeptable.select_data({
      name: combinedName,
      useNameCache: false, // Don't cache, always recreate
      tileFunction: async (tile: any) => {
        const numRows = tile.record_batch.numRows;
        const boolArray = new Uint8Array(Math.ceil(numRows / 8));
        boolArray.fill(255); // Start with all selected
        
        for (const [col, info] of activeFilters) {
          const colData = await tile.get_column(col);
          for (let i = 0; i < numRows; i++) {
            const val = colData.get(i);
            let pass = true;
            
            if (info.type === 'numeric') {
              const { minValue, maxValue } = info.value as { minValue: number | null; maxValue: number | null };
              if ((minValue !== null && val <= minValue) || (maxValue !== null && val >= maxValue)) {
                pass = false;
              }
            } else {
              if (val !== info.value) {
                pass = false;
              }
            }
            
            if (!pass) {
              boolArray[Math.floor(i / 8)] &= ~(1 << (i % 8));
            }
          }
        }
        
        const { Vector, makeData, Bool } = await import('apache-arrow');
        return new Vector([makeData({ type: new Bool(), data: boolArray, length: numRows })]);
      }
    });
    
    await selection.ready;
    
    await scatterplot.plotAPI({
      encoding: {
        foreground: {
          field: combinedName,
          op: 'eq',
          a: 1,
        },
      },
      background_options: {
        opacity: 0.01,
        size: 0.6,
      },
    });
    
    await updateColorEncoding(scatterplot, numericColumns, activeFilters);
  } catch (error) {
    console.error('Error applying combined filters:', error);
    // On error, clear the filter
    await scatterplot.plotAPI({
      encoding: {
        foreground: null,
      },
      background_options: { opacity: 1.0, size: 1.0 },
    });
  }
}

/**
 * Apply a filter for a specific column
 */
export async function applyFilter(
  activeFilters: Map<string, FilterInfo>,
  scatterplot: Scatterplot,
  numericColumns: Set<string>
): Promise<void> {
  const col = elements.filterColumnSelector.value;
  const isNum = numericColumns.has(col);
  
  if (isNum) {
    const minInput = document.getElementById('filter-min-input') as HTMLInputElement;
    const maxInput = document.getElementById('filter-max-input') as HTMLInputElement;
    const min = minInput ? parseFloat(minInput.value) : NaN;
    const max = maxInput ? parseFloat(maxInput.value) : NaN;
    
    if (!isNaN(min) || !isNaN(max)) {
      let displayText = `${col}: `;
      if (!isNaN(min) && !isNaN(max)) {
        displayText += `${min} - ${max}`;
      } else if (!isNaN(min)) {
        displayText += `≥ ${min}`;
      } else if (!isNaN(max)) {
        displayText += `≤ ${max}`;
      }
      
      activeFilters.set(col, {
        type: 'numeric',
        value: { minValue: isNaN(min) ? null : min, maxValue: isNaN(max) ? null : max },
        displayText
      });
    } else {
      activeFilters.delete(col);
    }
  } else {
    const selector = document.getElementById('filter-value-selector') as HTMLSelectElement;
    const val = selector?.value;
    
    if (val === 'All') {
      activeFilters.delete(col);
    } else if (val) {
      activeFilters.set(col, {
        type: 'categorical',
        value: val,
        displayText: `${col}: ${val}`
      });
    }
  }
  
  updateFilterChips(activeFilters, (column) => removeFilter(column, activeFilters, scatterplot, numericColumns));
  await applyAllFilters(activeFilters, scatterplot, numericColumns);
}

/**
 * Update the filter value input UI based on selected column
 */
export async function updateFilterValueInput(
  scatterplot: Scatterplot,
  numericColumns: Set<string>,
  activeFilters: Map<string, FilterInfo>
): Promise<void> {
  const col = elements.filterColumnSelector.value;
  elements.filterValueContainer.innerHTML = '';
  
  if (numericColumns.has(col)) {
    // Numeric filter: min/max inputs
    const div = document.createElement('div');
    div.style.display = 'flex';
    div.style.gap = '5px';
    
    const min = document.createElement('input');
    min.type = 'number';
    min.placeholder = 'Min';
    min.id = 'filter-min-input';
    min.style.width = '48%';
    
    const max = document.createElement('input');
    max.type = 'number';
    max.placeholder = 'Max';
    max.id = 'filter-max-input';
    max.style.width = '48%';
    
    [min, max].forEach(input => {
      input.addEventListener('change', () => applyFilter(activeFilters, scatterplot, numericColumns));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          applyFilter(activeFilters, scatterplot, numericColumns);
        }
      });
    });
    
    div.append(min, max);
    elements.filterValueContainer.appendChild(div);
  } else {
    // Categorical filter: dropdown
    const sel = document.createElement('select');
    sel.id = 'filter-value-selector';
    sel.innerHTML = '<option value="All">All</option>';
    
    // Check if there's an active filter for this column to preserve selection
    const currentFilter = activeFilters.get(col);
    const currentValue = currentFilter?.type === 'categorical' ? String(currentFilter.value) : 'All';
    
    const vals = new Set<any>();
    const tiles = scatterplot.renderer.visible_tiles();
    
    await Promise.all(tiles.map(async (t: any) => {
      // Skip parent tiles with no data
      if (t.record_batch.numRows === 0) {
        return;
      }
      const c = await t.get_column(col);
      console.log(`[filters] Getting values for column: ${col}, tile: ${t.key}, column length: ${c.length}, column type:`, c.type);
      // Use column.get(i) to properly decode dictionary-encoded strings
      for (let i = 0; i < c.length; i++) {
        const val = c.get(i);
        if (i < 3) {
          console.log(`[filters] Row ${i}, column ${col}: value=`, val, `type=${typeof val}`);
        }
        vals.add(val);
      }
      console.log(`[filters] Collected ${vals.size} unique values for ${col}, sample:`, Array.from(vals).slice(0, 5));
    }));
    
    Array.from(vals).sort().forEach((v: any) => {
      const o = document.createElement('option');
      o.value = v;
      o.text = v;
      sel.appendChild(o);
    });
    
    // Restore the previously selected value (only if it exists in the dropdown)
    if (currentValue && Array.from(sel.options).some(opt => opt.value === currentValue)) {
      sel.value = currentValue;
    }
    
    sel.onchange = () => applyFilter(activeFilters, scatterplot, numericColumns);
    elements.filterValueContainer.appendChild(sel);
  }
}
