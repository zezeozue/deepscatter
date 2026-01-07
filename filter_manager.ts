// Filter management - extracted from main.js
import type { Scatterplot } from './src/deepscatter';
import type { FilterInfo } from './types';
import { BACKGROUND } from './constants';

export class FilterManager {
  private activeFilters: Map<string, FilterInfo> = new Map();

  constructor(
    private scatterplot: Scatterplot,
    private numericColumns: Set<string>,
    private filterColumnSelector: HTMLSelectElement,
    private filterValueContainer: HTMLElement,
    private filterChipsContainer: HTMLElement
  ) {}

  /**
   * Update filter chips display
   */
  updateFilterChips(): void {
    this.filterChipsContainer.innerHTML = '';
    
    for (const [column, filterInfo] of this.activeFilters) {
      const chip = document.createElement('div');
      chip.className = 'filter-chip';
      
      const chipText = document.createElement('span');
      chipText.className = 'filter-chip-text';
      chipText.textContent = filterInfo.displayText;
      
      const removeButton = document.createElement('button');
      removeButton.className = 'filter-chip-remove';
      removeButton.innerHTML = '×';
      removeButton.title = 'Remove filter';
      removeButton.addEventListener('click', () => {
        this.removeFilter(column);
      });
      
      chip.appendChild(chipText);
      chip.appendChild(removeButton);
      this.filterChipsContainer.appendChild(chip);
    }
  }

  /**
   * Remove a filter
   */
  async removeFilter(column: string): Promise<void> {
    this.activeFilters.delete(column);
    this.updateFilterChips();

    if (this.filterColumnSelector.value === column) {
      await this.updateFilterValueInput();
    }
    
    // If no filters remain, reset all filters
    if (this.activeFilters.size === 0) {
      await this.scatterplot.plotAPI({
        encoding: {
          filter: null,
          foreground: null,
        },
        background_options: {
          opacity: 1.0,
          size: 1.0,
        },
      });
    } else {
      // Reapply remaining filters
      await this.applyAllFilters();
    }
  }

  /**
   * Apply all active filters
   */
  async applyAllFilters(): Promise<void> {
    if (this.activeFilters.size === 0) {
      await this.scatterplot.plotAPI({
        encoding: {
          filter: null,
        },
        background_options: {
          opacity: 1.0,
          size: 1.0,
        },
      });
      return;
    }
    
    // Create a combined selection that includes all active filters
    const combinedSelectionName = `combined_filter_${Date.now()}_${Math.random()}`;
    
    try {
      const selection = await this.scatterplot.deeptable.select_data({
        name: combinedSelectionName,
        tileFunction: async (tile: any) => {
          const boolArray = new Uint8Array(Math.ceil(tile.record_batch.numRows / 8));
          
          // Start with all points selected (true)
          for (let i = 0; i < tile.record_batch.numRows; i++) {
            const byte = Math.floor(i / 8);
            const bit = i % 8;
            boolArray[byte] |= 1 << bit;
          }
          
          // Apply each filter as an AND operation
          for (const [column, filterInfo] of this.activeFilters) {
            const isNumeric = this.numericColumns.has(column);
            
            if (isNumeric) {
              const columnData = await tile.get_column(column);
              const { minValue, maxValue } = filterInfo.value as { minValue: number | null; maxValue: number | null };
              
              // Apply numeric filter
              for (let i = 0; i < tile.record_batch.numRows; i++) {
                const value = columnData.get(i);
                let passes = true;
                
                if (minValue !== null && !isNaN(minValue) && value <= minValue) {
                  passes = false;
                }
                if (maxValue !== null && !isNaN(maxValue) && value >= maxValue) {
                  passes = false;
                }
                
                if (!passes) {
                  const byte = Math.floor(i / 8);
                  const bit = i % 8;
                  boolArray[byte] &= ~(1 << bit); // Set bit to false
                }
              }
            } else {
              // Categorical filter
              const columnData = await tile.get_column(column);
              
              for (let i = 0; i < tile.record_batch.numRows; i++) {
                if (columnData.get(i) !== filterInfo.value) {
                  const byte = Math.floor(i / 8);
                  const bit = i % 8;
                  boolArray[byte] &= ~(1 << bit); // Set bit to false
                }
              }
            }
          }
          
          const { Vector, makeData, Bool } = await import('apache-arrow');
          const boolVector = new Vector([
            makeData({
              type: new Bool(),
              data: boolArray,
              length: tile.record_batch.numRows,
            }),
          ]);
          
          return boolVector;
        }
      });
      
      await selection.ready;
      
      await this.scatterplot.plotAPI({
        encoding: {
          foreground: {
            field: combinedSelectionName,
            op: 'eq',
            a: 1,
          },
        },
        background_options: {
          opacity: BACKGROUND.OPACITY[0],
          size: BACKGROUND.SIZE[0],
        },
      });
    } catch (error) {
      console.error('Error applying combined filters:', error);
    }
  }

  /**
   * Apply a single filter
   */
  async applyFilter(): Promise<void> {
    const filterColumn = this.filterColumnSelector.value;
    const isNumeric = this.numericColumns.has(filterColumn);
    
    if (isNumeric) {
      const minInput = document.getElementById('filter-min-input') as HTMLInputElement;
      const maxInput = document.getElementById('filter-max-input') as HTMLInputElement;
      const minValue = minInput ? parseFloat(minInput.value) : null;
      const maxValue = maxInput ? parseFloat(maxInput.value) : null;
      
      if ((minValue !== null && !isNaN(minValue)) || (maxValue !== null && !isNaN(maxValue))) {
        let displayText = `${filterColumn}: `;
        if (minValue !== null && !isNaN(minValue) && maxValue !== null && !isNaN(maxValue)) {
          displayText += `${minValue} - ${maxValue}`;
        } else if (minValue !== null && !isNaN(minValue)) {
          displayText += `≥ ${minValue}`;
        } else if (maxValue !== null && !isNaN(maxValue)) {
          displayText += `≤ ${maxValue}`;
        }
        
        this.activeFilters.set(filterColumn, {
          type: 'numeric',
          value: { minValue, maxValue },
          displayText
        });
        
        this.updateFilterChips();
        await this.applyAllFilters();
      } else {
        if (this.activeFilters.has(filterColumn)) {
          this.activeFilters.delete(filterColumn);
          this.updateFilterChips();
          await this.applyAllFilters();
        }
      }
    } else {
      const filterValueElement = document.getElementById('filter-value-selector') as HTMLSelectElement;
      const filterValue = filterValueElement ? filterValueElement.value : null;
      
      if (filterValue === 'All') {
        if (this.activeFilters.has(filterColumn)) {
          this.activeFilters.delete(filterColumn);
          this.updateFilterChips();
          await this.applyAllFilters();
        }
        return;
      }

      if (filterValue) {
        this.activeFilters.set(filterColumn, {
          type: 'categorical',
          value: filterValue,
          displayText: `${filterColumn}: ${filterValue}`
        });
        
        this.updateFilterChips();
        await this.applyAllFilters();
      }
    }
  }

  /**
   * Update filter value input based on selected column
   */
  async updateFilterValueInput(): Promise<void> {
    const filterColumn = this.filterColumnSelector.value;
    const isNumeric = this.numericColumns.has(filterColumn);

    this.filterValueContainer.innerHTML = '';

    if (isNumeric) {
      const rangeContainer = document.createElement('div');
      rangeContainer.style.display = 'flex';
      rangeContainer.style.gap = '5px';
      rangeContainer.style.alignItems = 'center';
      
      const minInput = document.createElement('input');
      minInput.id = 'filter-min-input';
      minInput.type = 'number';
      minInput.placeholder = 'Min';
      minInput.style.width = '48%';
      minInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          void this.applyFilter();
        }
      });
      minInput.addEventListener('change', () => {
        void this.applyFilter();
      });
      
      const maxInput = document.createElement('input');
      maxInput.id = 'filter-max-input';
      maxInput.type = 'number';
      maxInput.placeholder = 'Max';
      maxInput.style.width = '48%';
      maxInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          void this.applyFilter();
        }
      });
      maxInput.addEventListener('change', () => {
        void this.applyFilter();
      });
      
      rangeContainer.appendChild(minInput);
      rangeContainer.appendChild(maxInput);
      this.filterValueContainer.appendChild(rangeContainer);
    } else {
      const select = document.createElement('select');
      select.id = 'filter-value-selector';
      
      const allOption = document.createElement('option');
      allOption.value = 'All';
      allOption.text = 'All';
      allOption.selected = true;
      select.appendChild(allOption);
      
      const allValues = new Set<string>();
      try {
        const visibleTiles = this.scatterplot.renderer.visible_tiles();
        const promises = visibleTiles.map(async (tile: any) => {
          const column = await tile.get_column(filterColumn);
          console.log(`[filter_manager] Getting values for column: ${filterColumn}, tile: ${tile.key}, column length: ${column.length}, column type:`, column.type);
          // Use column.get(i) to properly decode dictionary-encoded strings
          for (let i = 0; i < column.length; i++) {
            const val = column.get(i);
            if (i < 3) {
              console.log(`[filter_manager] Row ${i}, column ${filterColumn}: value=`, val, `type=${typeof val}`);
            }
            allValues.add(val);
          }
        });
        await Promise.all(promises);
      } catch (error) {
        console.error('Error fetching unique values for filter:', error);
      }
  
      const uniqueValues = Array.from(allValues).sort((a, b) => {
        if (filterColumn === 'cluster_id') {
          const numA = parseInt(a.split('#')[1], 10);
          const numB = parseInt(b.split('#')[1], 10);
          return numA - numB;
        }
        return a.localeCompare(b);
      });
      
      for (const val of uniqueValues) {
        const option = document.createElement('option');
        option.value = val;
        option.text = val;
        select.appendChild(option);
      }
      
      select.addEventListener('change', () => {
        void this.applyFilter();
      });
      
      this.filterValueContainer.appendChild(select);
    }
  }

  /**
   * Get active filters
   */
  getActiveFilters(): Map<string, FilterInfo> {
    return this.activeFilters;
  }
}
