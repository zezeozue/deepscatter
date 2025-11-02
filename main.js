console.log('=== MAIN.JS SCRIPT START ===');

try {
  console.log('Importing modules...');
} catch (error) {
  console.error('Error at script start:', error);
}

import { Scatterplot } from './src/deepscatter.ts';
import { scaleOrdinal } from 'd3-scale';
import { schemeTableau10 } from 'd3-scale-chromatic';

console.log('=== MAIN.JS LOADED ===');
console.log('All imports successful');

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
      field: 'startup_dur',
      transform: 'log',
      range: ['#fde725', '#21918c']
    },
  },
};

console.log('Creating scatterplot...');
const scatterplot = new Scatterplot('#deepscatter');
console.log('Scatterplot created, calling plotAPI...');
scatterplot.plotAPI(prefs);
console.log('plotAPI called, waiting for ready...');

const detailPanel = document.getElementById('detail-panel');
const detailContent = document.getElementById('detail-content');
const colorColumnSelector = document.getElementById('color-column-selector');
const legend = document.getElementById('legend');
const filterContainer = document.getElementById('filter-container');
const filterColumnSelector = document.getElementById('filter-column-selector');
const filterValueContainer = document.getElementById('filter-value-container');

let tooltipLocked = false;
let selectedIx = null;
let numericColumns; // Declare in a higher scope

scatterplot.ready.then(async () => {
  console.log('=== SCATTERPLOT READY ===');
  const allColumns = ['_device_name', '_build_id', 'startup_type', 'startup_dur', 'package'];
  numericColumns = new Set(['startup_dur']); // Assign in the ready callback
  console.log('Columns defined:', allColumns);
  console.log('Numeric columns:', Array.from(numericColumns));

  for (const colName of allColumns) {
    const colorOption = document.createElement('option');
    colorOption.value = colName;
    colorOption.text = colName;
    if (colName === 'startup_dur') {
      colorOption.selected = true;
    }
    colorColumnSelector.appendChild(colorOption);

    const filterOption = document.createElement('option');
    filterOption.value = colName;
    filterOption.text = colName;
    filterColumnSelector.appendChild(filterOption);
  }

  async function applyFilter() {
    console.log('=== APPLY FILTER DEBUG ===');
    const filterColumn = filterColumnSelector.value;
    const isNumeric = numericColumns.has(filterColumn);
    console.log('Filter column:', filterColumn);
    console.log('Is numeric column:', isNumeric);
    
    let filterValue = null;
    let filterValueElement = null;
    
    if (isNumeric) {
      // For numeric columns, we don't use filterValue, we use min/max inputs directly
      console.log('Numeric column - checking min/max inputs...');
    } else {
      // For categorical columns, get the dropdown value
      filterValueElement = document.getElementById('filter-value-input') || document.getElementById('filter-value-selector');
      filterValue = filterValueElement ? filterValueElement.value : null;
      console.log('Filter value element:', filterValueElement);
      console.log('Filter value:', filterValue);
      console.log('Filter value type:', typeof filterValue);
    }
  
    // Only reset filter if it's categorical and no value, or if it's numeric and no min/max values
    if (!isNumeric && !filterValue) {
      console.log('No categorical filter value, resetting filter...');
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
      
      console.log('Applying numeric range filter: field =', filterColumn, ', min =', minValue, ', max =', maxValue);
      
      if (minValue !== null && maxValue !== null && !isNaN(minValue) && !isNaN(maxValue)) {
        // Both min and max specified - use between operation
        await scatterplot.plotAPI({
          encoding: {
            filter: {
              field: filterColumn,
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
        // Only min specified - use gt operation
        await scatterplot.plotAPI({
          encoding: {
            filter: {
              field: filterColumn,
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
        // Only max specified - use lt operation
        await scatterplot.plotAPI({
          encoding: {
            filter: {
              field: filterColumn,
              op: 'lt',
              a: maxValue,
            },
          },
          background_options: {
            opacity: 0.01,
            size: 0.6,
          },
        });
      } else {
        // No valid values - reset filter
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
      }
    } else {
      // Check if "All" is selected (which means no filter)
      if (filterValue === 'All') {
        console.log('All selected, resetting filter...');
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
        return;
      }

      // For categorical data, let's use the selection system with proper API
      console.log('Applying categorical filter using selection system: field =', filterColumn, ', value =', filterValue);
      
      // Let's also check what data we actually have in the first few rows
      try {
        const sampleData = await scatterplot.deeptable.root_tile.get_column(filterColumn);
        console.log('Sample data from column:', Array.from(sampleData.slice(0, 10)));
        console.log('Looking for value:', filterValue);
        console.log('Value exists in sample:', Array.from(sampleData.slice(0, 100)).includes(filterValue));
      } catch (error) {
        console.error('Error getting sample data:', error);
      }
      
      // Create a selection for the filtered data
      const selectionName = `filter_${filterColumn}_${Date.now()}`;
      console.log('Creating selection:', selectionName);
      
      try {
        const selection = await scatterplot.deeptable.select_data({
          name: selectionName,
          tileFunction: async (tile) => {
            console.log('Processing tile for selection...');
            const column = await tile.get_column(filterColumn);
            
            // Create a boolean array manually
            const boolArray = new Uint8Array(Math.ceil(tile.record_batch.numRows / 8));
            let matchCount = 0;
            
            for (let i = 0; i < column.length; i++) {
              if (column.get(i) === filterValue) {
                const byte = Math.floor(i / 8);
                const bit = i % 8;
                boolArray[byte] |= 1 << bit;
                matchCount++;
              }
            }
            
            console.log('Boolean array created, matches found:', matchCount);
            
            // Create Arrow Bool Vector manually
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
        console.log('Selection ready, applying as foreground filter...');
        
        // Use the selection as a foreground filter with reduced background opacity
        await scatterplot.plotAPI({
          encoding: {
            foreground: {
              field: selectionName,
              op: 'eq',
              a: 1,
            },
          },
          background_options: {
            opacity: 0.01, // Extremely low opacity for background points to prevent clustering darkness
            size: 0.6, // Much smaller background points
          },
        });
        
      } catch (error) {
        console.error('Error creating selection:', error);
        // Fallback to trying the lambda approach again
        console.log('Falling back to lambda approach...');
        await scatterplot.plotAPI({
          encoding: {
            filter: {
              field: filterColumn,
              lambda: (d) => {
                console.log('Lambda filter checking:', d, 'against', filterValue, 'result:', d === filterValue);
                return d === filterValue;
              },
            },
          },
        });
      }
    }
    console.log('Filter applied successfully');
  }
  
  async function updateFilterValueInput() {
    console.log('=== UPDATE FILTER VALUE INPUT DEBUG ===');
    const filterColumn = filterColumnSelector.value;
    console.log('Filter column:', filterColumn);
    console.log('numericColumns set:', Array.from(numericColumns));
    const isNumeric = numericColumns.has(filterColumn);
    console.log('Is numeric:', isNumeric);

    filterValueContainer.innerHTML = '';

    if (isNumeric) {
      console.log('Creating min/max inputs for numeric filter.');
      
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
      console.log('Created min input:', minInput);
      minInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          console.log('Enter pressed on min input, applying filter...');
          void applyFilter();
        }
      });
      minInput.addEventListener('change', () => {
        console.log('Min input changed, applying filter...');
        void applyFilter();
      });
      minInput.addEventListener('input', () => {
        console.log('Min input value changed:', minInput.value);
      });
      
      // Max input
      const maxInput = document.createElement('input');
      maxInput.id = 'filter-max-input';
      maxInput.type = 'number';
      maxInput.placeholder = 'Max';
      maxInput.style.width = '48%';
      console.log('Created max input:', maxInput);
      maxInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          console.log('Enter pressed on max input, applying filter...');
          void applyFilter();
        }
      });
      maxInput.addEventListener('change', () => {
        console.log('Max input changed, applying filter...');
        void applyFilter();
      });
      maxInput.addEventListener('input', () => {
        console.log('Max input value changed:', maxInput.value);
      });
      
      rangeContainer.appendChild(minInput);
      rangeContainer.appendChild(maxInput);
      filterValueContainer.appendChild(rangeContainer);
      console.log('Min/max inputs appended to container');
      console.log('Min input in DOM:', document.getElementById('filter-min-input'));
      console.log('Max input in DOM:', document.getElementById('filter-max-input'));
    } else {
      console.log('Creating dropdown for categorical filter.');
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
      console.log('Unique values for dropdown:', uniqueValues);
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
      console.log('Dropdown created and appended.');
    }
  }
  
  filterColumnSelector.addEventListener('change', () => {
    console.log('=== FILTER COLUMN CHANGED ===');
    console.log('Filter column selector changed to:', filterColumnSelector.value);
    void updateFilterValueInput();
  });

  function updateLegend(colorEncoding, globalMapping) {
    legend.innerHTML = '';
    if (colorEncoding.transform === 'log') {
      // Simple gradient for numeric data
      legend.innerHTML = `
        <div style="display: flex; align-items: center;">
          <div style="width: 20px; height: 20px; background: linear-gradient(to right, ${colorEncoding.range[0]}, ${colorEncoding.range[1]});"></div>
          <span style="margin-left: 5px;">${colorEncoding.field} (log scale)</span>
        </div>
      `;
    } else if (globalMapping) {
      // Categorical legend
      for (const [value, index] of Object.entries(globalMapping)) {
        const color = colorEncoding.range[index % colorEncoding.range.length];
        legend.innerHTML += `
          <div style="display: flex; align-items: center; margin-bottom: 5px;">
            <div style="width: 20px; height: 20px; background-color: ${color};"></div>
            <span style="margin-left: 5px;">${value}</span>
          </div>
        `;
      }
    }
  }

  colorColumnSelector.addEventListener('change', async (event) => {
    const newColorColumn = event.target.value;
    const isNumeric = numericColumns.has(newColorColumn);

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
      const promises = scatterplot.deeptable.map(async (tile) => {
        const column = await tile.get_column(newColorColumn);
        for (const value of column) {
          allValues.add(value);
        }
      });
      await Promise.all(promises);

      const uniqueValues = Array.from(allValues);
      globalMapping = Object.fromEntries(uniqueValues.map((val, i) => [val, i]));

      const factorizedColumnName = `${newColorColumn}__factorized`;
      scatterplot.deeptable.transformations[factorizedColumnName] = async (tile) => {
        const baseColumn = await tile.get_column(newColorColumn);
        const transformedArray = Array.from(baseColumn).map(val => globalMapping[val]);
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
    
    scatterplot.plotAPI({
      encoding: {
        color: colorEncoding,
      },
    });
    updateLegend(colorEncoding, globalMapping);
  });

  // Trigger initial legend render
  colorColumnSelector.dispatchEvent(new Event('change'));

  // Trigger initial filter render
  console.log('Triggering initial filter render...');
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
    const startupDur = datum['startup_dur'] ? `${(Number(datum['startup_dur']) / 1_000_000).toFixed(2)}ms` : '';
    
    // Put startup duration on its own line at the top
    output += `<div style="font-weight: bold; margin-bottom: 4px;">${startupDur}</div>`;
    output += `<div style="font-weight: bold; margin-bottom: 8px;">${packageName}</div>`;

    const deviceName = datum['_device_name'] || '';
    const buildId = datum['_build_id'] || '';
    const traceUuid = datum['trace_uuid'] || '';
    const startupType = datum['startup_type'] || '';

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