import { Scatterplot } from './src/deepscatter.ts';
import { scaleOrdinal } from 'd3-scale';
import { schemeTableau10 } from 'd3-scale-chromatic';

const prefs = {
  source_url: '/tiles',
  max_points: 5000000, // Increased point count
  alpha: 15, // Adjusted for smaller points
  zoom_balance: 0.5, // Adjusted for smaller points
  point_size: 2, // Smaller points
  background_color: '#FFFFFF', // White background
  encoding: {
    x: { field: 'x', transform: 'literal' },
    y: { field: 'y', transform: 'literal' },
    color: {
      field: 'dur',
      transform: 'log',
      range: ['#fde725', '#21918c']
    },
  },
};

const scatterplot = new Scatterplot('#deepscatter');
scatterplot.plotAPI(prefs);

const detailPanel = document.getElementById('detail-panel');
const detailContent = document.getElementById('detail-content');
const colorColumnSelector = document.getElementById('color-column-selector');
const legend = document.getElementById('legend');
const filterContainer = document.getElementById('filter-container');
const filterColumnSelector = document.getElementById('filter-column-selector');
const filterValueContainer = document.getElementById('filter-value-container');
const filterChipsContainer = document.getElementById('filter-chips-container');

let tooltipLocked = false;
let selectedIx = null;
let numericColumns; // Declare in a higher scope
let activeFilters = new Map(); // Track active filters: column -> {type, value, displayText}

scatterplot.ready.then(async () => {
  const allColumns = ['_device_name', '_build_id', 'event_type', 'dur', 'package'];
  numericColumns = new Set(['dur']); // Assign in the ready callback

  for (const colName of allColumns) {
    const colorOption = document.createElement('option');
    colorOption.value = colName;
    colorOption.text = colName;
    if (colName === 'dur') {
      colorOption.selected = true;
    }
    colorColumnSelector.appendChild(colorOption);

    const filterOption = document.createElement('option');
    filterOption.value = colName;
    filterOption.text = colName;
    filterColumnSelector.appendChild(filterOption);
  }

  function updateFilterChips() {
    filterChipsContainer.innerHTML = '';
    
    for (const [column, filterInfo] of activeFilters) {
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
        removeFilter(column);
      });
      
      chip.appendChild(chipText);
      chip.appendChild(removeButton);
      filterChipsContainer.appendChild(chip);
    }
  }
  
  async function removeFilter(column) {
    activeFilters.delete(column);
    updateFilterChips();
    
    // If no filters remain, reset all filters
    if (activeFilters.size === 0) {
      await scatterplot.plotAPI({
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
      await applyAllFilters();
    }
  }
  
  async function applyAllFilters() {
    if (activeFilters.size === 0) {
      await scatterplot.plotAPI({
        encoding: {
          filter: null,
          foreground: null,
        },
        background_options: {
          opacity: 1.0,
          size: 1.0,
        },
      });
      // Update legend after clearing filters
      await updateColorEncoding();
      return;
    }
    
    // Create a combined selection that includes all active filters
    const combinedSelectionName = `combined_filter_${Date.now()}_${Math.random()}`;
    
    try {
      const selection = await scatterplot.deeptable.select_data({
        name: combinedSelectionName,
        tileFunction: async (tile) => {
          const boolArray = new Uint8Array(Math.ceil(tile.record_batch.numRows / 8));
          
          // Start with all points selected (true)
          for (let i = 0; i < tile.record_batch.numRows; i++) {
            const byte = Math.floor(i / 8);
            const bit = i % 8;
            boolArray[byte] |= 1 << bit;
          }
          
          // Apply each filter as an AND operation
          for (const [column, filterInfo] of activeFilters) {
            const isNumeric = numericColumns.has(column);
            
            if (isNumeric) {
              const columnData = await tile.get_column(column);
              const { minValue, maxValue } = filterInfo.value;
              
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
      
      await scatterplot.plotAPI({
        encoding: {
          foreground: {
            field: combinedSelectionName,
            op: 'eq',
            a: 1,
          },
        },
        background_options: {
          opacity: 0.01,
          size: 0.6,
        },
      });
      
      // Update legend after filter is applied
      console.log('Dispatching change event to update legend');
      await updateColorEncoding();
    } catch (error) {
      console.error('Error applying combined filters:', error);
      // Fallback: apply the most recent filter only
      const [lastColumn, lastFilter] = Array.from(activeFilters).pop();
      await applyFilterForColumn(lastColumn, lastFilter);
      await updateColorEncoding();
    }
  }
  
  async function applyFilterForColumn(column, filterInfo) {
    const isNumeric = numericColumns.has(column);
    
    if (isNumeric) {
      const { minValue, maxValue } = filterInfo.value;
      
      if (minValue !== null && maxValue !== null && !isNaN(minValue) && !isNaN(maxValue)) {
        await scatterplot.plotAPI({
          encoding: {
            filter: {
              field: column,
              op: 'between',
              a: minValue,
              b: maxValue,
            },
          },
          background_options: {
            opacity: 0.01,
            size: 0.6,
          },
        });
      } else if (minValue !== null && !isNaN(minValue)) {
        await scatterplot.plotAPI({
          encoding: {
            filter: {
              field: column,
              op: 'gt',
              a: minValue,
            },
          },
          background_options: {
            opacity: 0.01,
            size: 0.6,
          },
        });
      } else if (maxValue !== null && !isNaN(maxValue)) {
        await scatterplot.plotAPI({
          encoding: {
            filter: {
              field: column,
              op: 'lt',
              a: maxValue,
            },
          },
          background_options: {
            opacity: 0.01,
            size: 0.6,
          },
        });
      }
    } else {
      // Categorical filter
      const selectionName = `filter_${column}_${Date.now()}`;
      
      try {
        const selection = await scatterplot.deeptable.select_data({
          name: selectionName,
          tileFunction: async (tile) => {
            const columnData = await tile.get_column(column);
            const boolArray = new Uint8Array(Math.ceil(tile.record_batch.numRows / 8));
            
            for (let i = 0; i < columnData.length; i++) {
              if (columnData.get(i) === filterInfo.value) {
                const byte = Math.floor(i / 8);
                const bit = i % 8;
                boolArray[byte] |= 1 << bit;
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
        
        await scatterplot.plotAPI({
          encoding: {
            foreground: {
              field: selectionName,
              op: 'eq',
              a: 1,
            },
          },
          background_options: {
            opacity: 0.01,
            size: 0.6,
          },
        });
      } catch (error) {
        await scatterplot.plotAPI({
          encoding: {
            filter: {
              field: column,
              lambda: (d) => {
                return d === filterInfo.value;
              },
            },
          },
        });
      }
    }
  }

  async function applyFilter() {
    const filterColumn = filterColumnSelector.value;
    const isNumeric = numericColumns.has(filterColumn);
    
    let filterValue = null;
    let filterValueElement = null;
    
    if (!isNumeric) {
      // For categorical columns, get the dropdown value
      filterValueElement = document.getElementById('filter-value-input') || document.getElementById('filter-value-selector');
      filterValue = filterValueElement ? filterValueElement.value : null;
    }
  
    // Only reset filter if it's categorical and no value
    if (!isNumeric && !filterValue) {
      // Reset filter - remove the filter entirely and reset background opacity
      await scatterplot.plotAPI({
        encoding: {
          filter: null,
          foreground: null,
        },
        background_options: {
          opacity: 1.0, // Reset to full opacity
          size: 1.0, // Reset to normal size
        },
      });
      return;
    }
  
    if (isNumeric) {
      // For numeric columns, we need to handle min/max range filtering
      const minInput = document.getElementById('filter-min-input');
      const maxInput = document.getElementById('filter-max-input');
      const minValue = minInput ? parseFloat(minInput.value) : null;
      const maxValue = maxInput ? parseFloat(maxInput.value) : null;
      
      if ((minValue !== null && !isNaN(minValue)) || (maxValue !== null && !isNaN(maxValue))) {
        // Create display text for the chip
        let displayText = `${filterColumn}: `;
        if (minValue !== null && !isNaN(minValue) && maxValue !== null && !isNaN(maxValue)) {
          displayText += `${minValue} - ${maxValue}`;
        } else if (minValue !== null && !isNaN(minValue)) {
          displayText += `≥ ${minValue}`;
        } else if (maxValue !== null && !isNaN(maxValue)) {
          displayText += `≤ ${maxValue}`;
        }
        
        // Add to active filters
        activeFilters.set(filterColumn, {
          type: 'numeric',
          value: { minValue, maxValue },
          displayText
        });
        
        updateFilterChips();
        await applyAllFilters();
      } else {
        // No valid values - remove filter if it exists
        if (activeFilters.has(filterColumn)) {
          activeFilters.delete(filterColumn);
          updateFilterChips();
          await applyAllFilters();
        }
      }
    } else {
      // Check if "All" is selected (which means no filter)
      if (filterValue === 'All') {
        // Remove filter if it exists
        if (activeFilters.has(filterColumn)) {
          activeFilters.delete(filterColumn);
          updateFilterChips();
          await applyAllFilters();
        }
        return;
      }

      // Add to active filters
      activeFilters.set(filterColumn, {
        type: 'categorical',
        value: filterValue,
        displayText: `${filterColumn}: ${filterValue}`
      });
      
      updateFilterChips();
      await applyAllFilters();
    }
  }
  
  async function updateFilterValueInput() {
    const filterColumn = filterColumnSelector.value;
    const isNumeric = numericColumns.has(filterColumn);

    filterValueContainer.innerHTML = '';

    if (isNumeric) {
      
      // Create a container for the min/max inputs
      const rangeContainer = document.createElement('div');
      rangeContainer.style.display = 'flex';
      rangeContainer.style.gap = '5px';
      rangeContainer.style.alignItems = 'center';
      
      // Min input
      const minInput = document.createElement('input');
      minInput.id = 'filter-min-input';
      minInput.type = 'number';
      minInput.placeholder = 'Min';
      minInput.style.width = '48%';
      minInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          void applyFilter();
        }
      });
      minInput.addEventListener('change', () => {
        void applyFilter();
      });
      
      // Max input
      const maxInput = document.createElement('input');
      maxInput.id = 'filter-max-input';
      maxInput.type = 'number';
      maxInput.placeholder = 'Max';
      maxInput.style.width = '48%';
      maxInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          void applyFilter();
        }
      });
      maxInput.addEventListener('change', () => {
        void applyFilter();
      });
      
      rangeContainer.appendChild(minInput);
      rangeContainer.appendChild(maxInput);
      filterValueContainer.appendChild(rangeContainer);
    } else {
      const select = document.createElement('select');
      select.id = 'filter-value-selector';
      
      // Add "All" option first
      const allOption = document.createElement('option');
      allOption.value = 'All';
      allOption.text = 'All';
      allOption.selected = true; // Default to "All"
      select.appendChild(allOption);
      
      const allValues = new Set();
      try {
        const promises = scatterplot.deeptable.map(async (tile) => {
          const column = await tile.get_column(filterColumn);
          for (const value of column) {
            allValues.add(value);
          }
        });
        await Promise.all(promises);
      } catch (error) {
        console.error('Error fetching unique values for filter:', error);
      }
  
      const uniqueValues = Array.from(allValues).sort(); // Sort for better UX
      for (const val of uniqueValues) {
        const option = document.createElement('option');
        option.value = val;
        option.text = val;
        select.appendChild(option);
      }
      select.addEventListener('change', () => {
        void applyFilter();
      });
      filterValueContainer.appendChild(select);
    }
  }
  
  filterColumnSelector.addEventListener('change', () => {
    void updateFilterValueInput();
  });

  function updateLegend(colorEncoding, globalMapping) {
    console.log('updateLegend called with:', { colorEncoding, globalMapping });
    legend.innerHTML = '';
    if (colorEncoding.transform === 'log') {
      // Simple gradient for numeric data
      legend.innerHTML = `
        <div style="display: flex; align-items: center;">
          <div style="width: 20px; height: 20px; background: linear-gradient(to right, ${colorEncoding.range[0]}, ${colorEncoding.range[1]});"></div>
          <span style="margin-left: 5px;">${colorEncoding.field} (log scale)</span>
        </div>
      `;
      console.log('Updated legend for numeric data');
    } else if (globalMapping) {
      // Categorical legend
      console.log(`Creating legend for ${Object.keys(globalMapping).length} categories`);
      for (const [value, index] of Object.entries(globalMapping)) {
        const color = colorEncoding.range[index % colorEncoding.range.length];
        legend.innerHTML += `
          <div style="display: flex; align-items: center; margin-bottom: 5px;">
            <div style="width: 20px; height: 20px; background-color: ${color};"></div>
            <span style="margin-left: 5px;">${value}</span>
          </div>
        `;
      }
      console.log('Updated legend for categorical data');
    } else {
      console.log('No legend update - no globalMapping provided');
    }
  }

  async function updateColorEncoding() {
    console.log('Color column changed');
    const newColorColumn = colorColumnSelector.value;
    const isNumeric = numericColumns.has(newColorColumn);
    console.log(`New color column: ${newColorColumn}, isNumeric: ${isNumeric}`);

    let colorEncoding;
    let globalMapping = null;

    if (isNumeric) {
      colorEncoding = {
        field: newColorColumn,
        transform: 'log',
        range: ['#fde725', '#21918c'],
      };
    } else {
      const allValues = new Set();
      const visible_tiles = scatterplot.renderer.visible_tiles();
      console.log(`Found ${visible_tiles.length} visible tiles`);
      
      // Apply active filters to determine which values should be in the legend
      const promises = visible_tiles.map(async (tile) => {
        const column = await tile.get_column(newColorColumn);
        
        // If there are active filters, only include values from rows that pass all filters
        if (activeFilters.size > 0) {
          console.log(`Applying ${activeFilters.size} active filters to legend data`);
          
          // Get all filter columns for this tile
          const filterColumns = new Map();
          for (const [filterColumn] of activeFilters) {
            filterColumns.set(filterColumn, await tile.get_column(filterColumn));
          }
          
          // Check each row against all active filters
          for (let i = 0; i < tile.record_batch.numRows; i++) {
            let passesAllFilters = true;
            
            // Apply each active filter
            for (const [filterColumn, filterInfo] of activeFilters) {
              const filterColumnData = filterColumns.get(filterColumn);
              const isFilterNumeric = numericColumns.has(filterColumn);
              
              if (isFilterNumeric) {
                const value = filterColumnData.get(i);
                const { minValue, maxValue } = filterInfo.value;
                
                if (minValue !== null && !isNaN(minValue) && value <= minValue) {
                  passesAllFilters = false;
                  break;
                }
                if (maxValue !== null && !isNaN(maxValue) && value >= maxValue) {
                  passesAllFilters = false;
                  break;
                }
              } else {
                // Categorical filter
                if (filterColumnData.get(i) !== filterInfo.value) {
                  passesAllFilters = false;
                  break;
                }
              }
            }
            
            // Only add the value if it passes all filters
            if (passesAllFilters) {
              allValues.add(column.get(i));
            }
          }
        } else {
          // No active filters, include all values
          for (const value of column) {
            allValues.add(value);
          }
        }
      });
      await Promise.all(promises);

      const uniqueValues = Array.from(allValues);
      console.log('Unique values from filtered data:', uniqueValues);
      globalMapping = Object.fromEntries(uniqueValues.map((val, i) => [val, i]));

      const factorizedColumnName = `${newColorColumn}__factorized`;
      scatterplot.deeptable.transformations[factorizedColumnName] = async (tile) => {
        const baseColumn = await tile.get_column(newColorColumn);
        const transformedArray = Array.from(baseColumn).map(val => globalMapping[val] ?? 0);
        return new Float32Array(transformedArray);
      };

      const loadPromises = scatterplot.deeptable.map(tile => tile.get_column(factorizedColumnName));
      await Promise.all(loadPromises);

      // Create a dynamic color scale using d3 that is guaranteed to have enough colors.
      const colorScale = scaleOrdinal(schemeTableau10);
      let colorRange = uniqueValues.map(d => colorScale(d));

      if (uniqueValues.length === 1) {
        // Ensure the range is always an array of at least two elements.
        colorRange = [colorRange[0], colorRange[0]];
      }

      colorEncoding = {
        field: factorizedColumnName,
        transform: 'literal',
        range: colorRange,
      };
    }
    
    console.log('Updating plot with new color encoding:', colorEncoding);
    await scatterplot.plotAPI({
      encoding: {
        color: colorEncoding,
      },
    });
    console.log('Updating legend with mapping:', globalMapping);
    updateLegend(colorEncoding, globalMapping);
  }

  colorColumnSelector.addEventListener('change', async (event) => {
    await updateColorEncoding();
  });

  // Trigger initial legend render
  colorColumnSelector.dispatchEvent(new Event('change'));

  // Trigger initial filter render
  void updateFilterValueInput();

  scatterplot.click_function = async (datum, plot, ev) => {
    if (ev.ctrlKey || ev.metaKey) {
      const trace = datum['trace_uuid'];
      if (trace) {
        window.open(
          `https://apconsole.corp.google.com/link/perfetto/field_traces?uuid=${trace}&query=`,
          '_blank',
        );
      }
      return;
    }
    justClicked = true;
    tooltipLocked = true;
    selectedIx = datum.ix;
    const trace_uuid = datum.trace_uuid;
    detailPanel.classList.add('open');
    let output = '';
    const packageName = datum['package'] || '';
    const startupDur = datum['dur'] ? `${(Number(datum['dur']) / 1_000_000).toFixed(2)}ms` : '';
    
    // Put startup duration on its own line at the top
    output += `<div style="font-weight: bold; margin-bottom: 4px;">${startupDur}</div>`;
    output += `<div style="font-weight: bold; margin-bottom: 8px;">${packageName}</div>`;

    const deviceName = datum['_device_name'] || '';
    const buildId = datum['_build_id'] || '';
    const traceUuid = datum['trace_uuid'] || '';
    const startupType = datum['event_type'] || '';

    output += `${deviceName}\n`;
    if (traceUuid) {
      output += `<a href="https://apconsole.corp.google.com/link/perfetto/field_traces?uuid=${traceUuid}&query=" target="_blank">${traceUuid}</a>\n`;
    }
    output += `${buildId}\n`;
    output += `${startupType}\n`;

    detailContent.innerHTML = output;
    const selection = await scatterplot.select_data({
      id: [selectedIx],
      key: 'ix',
      name: 'clicked_point'
    });
    scatterplot.plotAPI({
      encoding: {
        size: {
          field: selection.name,
          range: [2, 10],
        }
      }
    })
  };
});

let mousePosition = [0, 0];
document.addEventListener('mousemove', (event) => {
  mousePosition = [event.clientX, event.clientY];
});

let justClicked = false;
document.addEventListener('click', (event) => {
  const clickedOnTooltip = false;
  const clickedOnDetails = detailPanel.contains(event.target);
  const clickedOnLeftPanel = document.getElementById('left-panel').contains(event.target);

  if (justClicked) {
    justClicked = false;
    return;
  }

  if (!clickedOnTooltip && !clickedOnDetails && !clickedOnLeftPanel && selectedIx !== null) {
    setTimeout(() => {
      if (justClicked) return;
      tooltipLocked = false;
      detailPanel.classList.remove('open');
      selectedIx = null;
      const currentColumn = colorColumnSelector.value;
      const isNumeric = numericColumns.has(currentColumn);
      let colorEncoding;
      if (isNumeric) {
        colorEncoding = {
          field: currentColumn,
          transform: 'log',
          range: ['#fde725', '#21918c']
        };
      } else {
        colorEncoding = {
          field: `${currentColumn}__factorized`,
          transform: 'literal',
          range: ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00']
        };
      }
      scatterplot.plotAPI({
        encoding: {
          // color: colorEncoding, // This was resetting the color.
          size: { constant: 2 },
        }
      });
      
      
    }, 100);
  }
});

document.addEventListener('keydown', (event) => {
  const { zoom } = scatterplot;
  const { transform } = zoom;
  const panAmount = 25;
  switch (event.key) {
    case 'w':
      zoom.zoomer.scaleBy(zoom.svg_element_selection.transition().duration(100), 1.2, mousePosition);
      break;
    case 's':
      zoom.zoomer.scaleBy(zoom.svg_element_selection.transition().duration(100), 0.8, mousePosition);
      break;
    case 'a':
    case 'ArrowLeft':
      zoom.zoomer.translateBy(zoom.svg_element_selection, panAmount, 0);
      break;
    case 'd':
    case 'ArrowRight':
      zoom.zoomer.translateBy(zoom.svg_element_selection, -panAmount, 0);
      break;
    case 'ArrowUp':
      zoom.zoomer.translateBy(zoom.svg_element_selection, 0, panAmount);
      break;
    case 'ArrowDown':
      zoom.zoomer.translateBy(zoom.svg_element_selection, 0, -panAmount);
      break;
  }
});