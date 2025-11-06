import { Scatterplot } from './src/deepscatter.ts';
import { config } from './config.js';
import { scaleOrdinal } from 'd3-scale';
import { schemeTableau10 } from 'd3-scale-chromatic';

const prefs = {
  source_url: '/tiles',
  max_points: 2000000, // Reduced for better performance with 10k tiles
  alpha: 15, // Adjusted for smaller points
  zoom_balance: 0.3, // Reduced for better performance
  point_size: 2, // Smaller points
  background_color: '#FFFFFF', // White background
  encoding: {
    x: { field: 'x', transform: 'literal' },
    y: { field: 'y', transform: 'literal' },
    color: {
      field: 'dur',
      transform: 'log',
      range: ['#fde725', '#a0da39', '#4ac16d', '#1fa187', '#277f8e', '#365c8d', '#46327e', '#440154']
    },
  },
};

const scatterplot = new Scatterplot('#deepscatter');
scatterplot.plotAPI(prefs);

const detailPanel = document.getElementById('detail-panel');
const detailContent = document.getElementById('detail-content');
const bottomPanel = document.getElementById('bottom-panel');
const bottomPanelContent = document.getElementById('bottom-panel-content');
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
let selectionModeActive = false;

scatterplot.ready.then(async () => {
  const actionToolButton = document.getElementById('action-tool-button');
  const clusterReportButton = document.getElementById('cluster-report-button');
  const deepscatterDiv = document.getElementById('deepscatter');
  
  // CRITICAL: Get the actual SVG element that deepscatter uses for interaction
  const svg = document.querySelector('#deepscatter svg#deepscatter-svg');
  
  // Create selection rectangle as a sibling to the SVG
  const selectionRectangle = document.createElement('div');
  selectionRectangle.id = 'selection-rectangle';
  selectionRectangle.style.cssText = `
    position: absolute;
    border: 2px dashed #007bff;
    background-color: rgba(0, 123, 255, 0.1);
    display: none;
    z-index: 999;
    pointer-events: none;
    top: 0;
    left: 0;
  `;
  svg.parentElement.appendChild(selectionRectangle);
  
  let isDrawing = false;
  let startX, startY, endX, endY;
  let hasDragged = false;

  actionToolButton.addEventListener('click', () => {
    selectionModeActive = !selectionModeActive;
    actionToolButton.classList.toggle('active', selectionModeActive);
    svg.style.cursor = selectionModeActive ? 'crosshair' : 'default';
  });

  clusterReportButton.addEventListener('click', () => {
    window.open('cluster_report.html', '_blank');
  });

svg.addEventListener('mousedown', (e) => {
  if (!selectionModeActive) return;
  e.stopPropagation();
  isDrawing = true;
  hasDragged = false;
  
  // Use SVG coordinates, not canvas coordinates
  const svgRect = svg.getBoundingClientRect();
  
  startX = e.clientX - svgRect.left;
  startY = e.clientY - svgRect.top;
  
  // Don't show selection rectangle immediately - wait for drag
}, true);

// Add mousemove event for drawing selection rectangle
svg.addEventListener('mousemove', (e) => {
  if (!isDrawing) return;
  
  const svgRect = svg.getBoundingClientRect();
  
  endX = e.clientX - svgRect.left;
  endY = e.clientY - svgRect.top;
  
  // Check if we've moved enough to consider this a drag (minimum 5 pixels)
  const deltaX = Math.abs(endX - startX);
  const deltaY = Math.abs(endY - startY);
  const minDragDistance = 5;
  
  if (!hasDragged && (deltaX > minDragDistance || deltaY > minDragDistance)) {
    hasDragged = true;
    selectionRectangle.style.display = 'block';
  }
  
  if (hasDragged) {
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);
    
    const parentRect = svg.parentElement.getBoundingClientRect();
    const left = Math.min(startX, endX) + (svgRect.left - parentRect.left);
    const top = Math.min(startY, endY) + (svgRect.top - parentRect.top);
    
    selectionRectangle.style.width = `${width}px`;
    selectionRectangle.style.height = `${height}px`;
    selectionRectangle.style.left = `${left}px`;
    selectionRectangle.style.top = `${top}px`;
  }
}, true);

svg.addEventListener('mouseup', async (e) => {
  if (!isDrawing) return;
  e.stopPropagation();
  isDrawing = false;
  selectionRectangle.style.display = 'none';
  
  // Only proceed with selection if we actually dragged
  if (!hasDragged) {
    return;
  }
  
  const svgRect = svg.getBoundingClientRect();
  
  endX = e.clientX - svgRect.left;
  endY = e.clientY - svgRect.top;
  
  // Calculate selection bounds in data coordinates
  const { x_, y_ } = scatterplot.zoom.scales();
        
  const xDomainMin = Math.min(x_.invert(startX), x_.invert(endX));
  const xDomainMax = Math.max(x_.invert(startX), x_.invert(endX));
  const startYData = y_.invert(startY);
  const endYData = y_.invert(endY);
  const yDomainMin = Math.min(startYData, endYData);
  const yDomainMax = Math.max(startYData, endYData);

  // Get only visible tiles for better performance with large datasets
  const allTiles = scatterplot.renderer.visible_tiles();
  console.log(`Processing ${allTiles.length} visible tiles for selection`);
  
  // First, ensure all tiles have x and y columns loaded
  const loadPromises = allTiles.map(async (tile) => {
    try {
      await tile.get_column('x');
      await tile.get_column('y');
    } catch (error) {
      console.warn(`Failed to load columns for tile ${tile.key}:`, error);
    }
  });
  
  await Promise.all(loadPromises);
    
  const selection = await scatterplot.deeptable.select_data({
    name: `selection_${Date.now()}`,
    tileFunction: async (tile) => {
      const xCol = await tile.get_column('x');
      const yCol = await tile.get_column('y');
      const { Vector, makeData, Bool } = await import('apache-arrow');
      
      // Initialize boolean array with all bits set to 0
      const numRows = tile.record_batch.numRows;
      const boolArray = new Uint8Array(Math.ceil(numRows / 8));
      
      // Pre-load all filter columns
      const filterColumns = new Map();
      for (const [colName] of activeFilters) {
        filterColumns.set(colName, await tile.get_column(colName));
      }

      for (let i = 0; i < numRows; i++) {
        const xVal = xCol.get(i);
        const yVal = yCol.get(i);
        const inX = xVal >= xDomainMin && xVal <= xDomainMax;
        const inY = yVal >= yDomainMin && yVal <= yDomainMax;
        
        if (inX && inY) {
          let passesAllFilters = true;
          for (const [colName, filterInfo] of activeFilters) {
            const colData = filterColumns.get(colName);
            const val = colData.get(i);
            if (filterInfo.type === 'numeric') {
              const { minValue, maxValue } = filterInfo.value;
              if ((minValue !== null && val < minValue) || (maxValue !== null && val > maxValue)) {
                passesAllFilters = false;
                break;
              }
            } else { // Categorical
              if (val !== filterInfo.value) {
                passesAllFilters = false;
                break;
              }
            }
          }
          
          if (passesAllFilters) {
            const byteIndex = Math.floor(i / 8);
            const bitIndex = i % 8;
            boolArray[byteIndex] |= (1 << bitIndex);
          }
        }
      }
      return new Vector([makeData({ type: new Bool(), data: boolArray, length: numRows })]);
    }
  });
    // Apply the selection to all loaded tiles, not just the root tile
    await selection.applyToAllLoadedTiles();

    const qids = await selection.get_qids();
    
    // Ensure all required columns are loaded for the selected tiles
    const requiredColumns = config.columns.filter(c => c.required).map(c => c.name);
    const tilesToLoad = new Set();
    
    // Identify which tiles contain selected points
    for (const [tix, rix] of qids) {
      const tile = scatterplot.deeptable.flatTree[tix];
      if (tile) {
        tilesToLoad.add(tile);
      }
    }
    
    // Load all required columns for tiles that have selected points
    const columnLoadPromises = [];
    for (const tile of tilesToLoad) {
      for (const column of requiredColumns) {
        columnLoadPromises.push(
          tile.get_column(column).catch(() => {
            // Some columns might not exist, that's okay
          })
        );
      }
    }
    
    await Promise.all(columnLoadPromises);
    
    const data = scatterplot.deeptable.getQids(qids);
    
    const modal = document.getElementById('action-modal');
    const closeButton = document.querySelector('.close-button');
    const selectionCount = document.getElementById('selection-count');
    const openTracesButton = document.getElementById('open-traces-button');
    const chartColumnSelector = document.getElementById('chart-column-selector');

    // Format number with D3-style suffixes (k, M, etc.)
    const formatNumber = (num) => {
      if (num >= 1000000) {
        return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
      } else if (num >= 1000) {
        return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
      } else {
        return num.toString();
      }
    };
    
    selectionCount.textContent = formatNumber(data.length);

    // Populate chart column selector
    chartColumnSelector.innerHTML = '';
    for (const colName of allColumns) {
      const option = document.createElement('option');
      option.value = colName;
      option.text = colName;
      chartColumnSelector.appendChild(option);
    }

    modal.style.display = 'block';

    const resetModal = () => {
      modal.style.display = 'none';
      // Reset chart container
      chartContainer.innerHTML = '';
      // Reset column selector to default
      chartColumnSelector.selectedIndex = 0;
    };

    closeButton.onclick = resetModal;

    window.onclick = (event) => {
      if (event.target == modal) {
        resetModal();
      }
    }

    openTracesButton.onclick = () => {
      const traces = data.filter(d => d['trace_uuid']).map(d => d['trace_uuid']);
      
      if (traces.length === 0) {
        alert('No traces found in selection');
        return;
      }
      
      if (traces.length === 1) {
        // Single trace - open directly
        window.open(
          `https://apconsole.corp.google.com/link/perfetto/field_traces?uuid=${traces[0]}&query=`,
          '_blank'
        );
        return;
      }
      
      // Multiple traces - create a confirmation dialog with options
      const message = `Found ${traces.length} traces. How would you like to open them?`;
      const options = [
        'Open first trace only',
        'Open all traces (may be blocked by browser)',
        'Copy all trace URLs to clipboard',
        'Cancel'
      ];
      
      const choice = prompt(
        message + '\n\n' +
        options.map((opt, i) => `${i + 1}. ${opt}`).join('\n') +
        '\n\nEnter your choice (1-4):'
      );
      
      const choiceNum = parseInt(choice);
      
      switch (choiceNum) {
        case 1:
          // Open first trace only
          window.open(
            `https://apconsole.corp.google.com/link/perfetto/field_traces?uuid=${traces[0]}&query=`,
            '_blank'
          );
          break;
          
        case 2:
          // Try to open all traces (will likely be blocked)
          traces.forEach((trace, index) => {
            setTimeout(() => {
              window.open(
                `https://apconsole.corp.google.com/link/perfetto/field_traces?uuid=${trace}&query=`,
                '_blank'
              );
            }, index * 200); // 200ms delay between each
          });
          break;
          
        case 3:
          // Copy URLs to clipboard in spreadsheet-friendly format
          const urls = traces.map(trace =>
            `https://apconsole.corp.google.com/link/perfetto/field_traces?uuid=${trace}&query=`
          ).join('\n');
          
          navigator.clipboard.writeText(urls).then(() => {
            alert(`Copied ${traces.length} trace URLs to clipboard (one per line). Ready to paste into spreadsheets.`);
          }).catch(() => {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = urls;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            alert(`Copied ${traces.length} trace URLs to clipboard (one per line). Ready to paste into spreadsheets.`);
          });
          break;
          
        case 4:
        default:
          // Cancel - do nothing
          break;
      }
    };

    const generateChartButton = document.getElementById('generate-chart-button');
    const chartContainer = document.getElementById('chart-container');

    generateChartButton.onclick = () => {
      const column = chartColumnSelector.value;
      const isNumeric = numericColumns.has(column);
      const values = data.map(d => d[column]);

      chartContainer.innerHTML = '';

      if (isNumeric) {
        // Histogram for numeric data
        // Filter out undefined, null, and non-numeric values, handle BigInt
        const numericValues = values.filter(v => {
          if (v === undefined || v === null) return false;
          if (typeof v === 'bigint') return true;
          if (typeof v === 'number') return !isNaN(v) && isFinite(v);
          // Try to convert string to number
          const num = Number(v);
          return !isNaN(num) && isFinite(num);
        }).map(v => {
          // Convert BigInt to number for calculations
          if (typeof v === 'bigint') return Number(v);
          if (typeof v === 'number') return v;
          return Number(v);
        });
        
        if (numericValues.length === 0) {
          chartContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No valid numeric data found</div>';
          return;
        }
        
        const numBins = 20;
        const min = Math.min(...numericValues);
        const max = Math.max(...numericValues);
        
        if (min === max) {
          chartContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">All values are the same</div>';
          return;
        }
        
        const binSize = (max - min) / numBins;
        const bins = new Array(numBins).fill(0);

        for (const value of numericValues) {
          const binIndex = Math.min(Math.floor((value - min) / binSize), numBins - 1);
          bins[binIndex]++;
        }

        const maxBinCount = Math.max(...bins);
        
        if (maxBinCount === 0) {
          chartContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No data to display</div>';
          return;
        }
        
        const chart = document.createElement('div');
        chart.style.display = 'flex';
        chart.style.alignItems = 'flex-end';
        chart.style.gap = '2px';
        chart.style.height = '150px';
        chart.style.borderBottom = '1px solid #ccc';

        for (let i = 0; i < bins.length; i++) {
          const count = bins[i];
          const barContainer = document.createElement('div');
          barContainer.style.width = `${100 / numBins}%`;
          barContainer.style.height = '100%';
          barContainer.style.display = 'flex';
          barContainer.style.flexDirection = 'column';
          barContainer.style.justifyContent = 'flex-end';
          barContainer.style.alignItems = 'center';
          barContainer.style.position = 'relative';
          
          const bar = document.createElement('div');
          bar.style.width = '100%';
          bar.style.height = `${maxBinCount > 0 ? (count / maxBinCount) * 100 : 0}%`;
          bar.style.backgroundColor = '#2196f3';
          bar.style.minHeight = count > 0 ? '2px' : '0px';
          bar.title = `${count} items`;
          
          // Add count label on top of bar (only if count > 0)
          if (count > 0) {
            const countLabel = document.createElement('div');
            countLabel.textContent = formatNumber(count);
            countLabel.style.fontSize = '10px';
            countLabel.style.color = '#333';
            countLabel.style.marginBottom = '2px';
            countLabel.style.whiteSpace = 'nowrap';
            barContainer.appendChild(countLabel);
          }
          
          barContainer.appendChild(bar);
          chart.appendChild(barContainer);
        }
        chartContainer.appendChild(chart);
        
        // Add x-axis grid labels for duration
        if (column === 'dur') {
          const gridContainer = document.createElement('div');
          gridContainer.style.display = 'flex';
          gridContainer.style.justifyContent = 'space-between';
          gridContainer.style.fontSize = '10px';
          gridContainer.style.color = '#666';
          gridContainer.style.marginTop = '5px';
          gridContainer.style.paddingLeft = '2px';
          gridContainer.style.paddingRight = '2px';
          
          // Create grid labels at key points
          const gridPoints = [0, 0.25, 0.5, 0.75, 1];
          gridPoints.forEach(point => {
            const value = min + (max - min) * point;
            const label = document.createElement('span');
            label.style.fontSize = '9px';
            label.style.color = '#999';
            // Convert nanoseconds to milliseconds and format
            const ms = (value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0);
            label.textContent = `${ms}ms`;
            gridContainer.appendChild(label);
          });
          
          chartContainer.appendChild(gridContainer);
        }
      } else {
        // Bar chart for categorical data
        const counts = values.reduce((acc, value) => {
          acc[value] = (acc[value] || 0) + 1;
          return acc;
        }, {});

        const sortedCounts = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const maxCount = sortedCounts[0][1];

        // Create scrollable container for the bar chart
        const scrollContainer = document.createElement('div');
        scrollContainer.style.maxHeight = '300px'; // Limit height for vertical scrolling
        scrollContainer.style.overflowY = 'auto'; // Vertical scrolling for many bars
        scrollContainer.style.overflowX = 'auto'; // Horizontal scrolling for long bars
        scrollContainer.style.border = '1px solid #ddd';
        scrollContainer.style.borderRadius = '4px';
        scrollContainer.style.padding = '10px';

        // Calculate a reasonable bar width (minimum 200px, can be longer)
        const baseBarWidth = 200;
        const maxBarWidth = Math.max(baseBarWidth, (count) => (count / maxCount) * 400);

        for (const [value, count] of sortedCounts) {
          const barContainer = document.createElement('div');
          barContainer.style.display = 'flex';
          barContainer.style.alignItems = 'center';
          barContainer.style.marginBottom = '5px';
          barContainer.style.minWidth = '350px'; // Ensure minimum width for horizontal scrolling

          const label = document.createElement('div');
          label.textContent = value;
          label.style.width = '120px';
          label.style.minWidth = '120px'; // Wider label for better readability
          label.style.overflow = 'hidden';
          label.style.textOverflow = 'ellipsis';
          label.style.whiteSpace = 'nowrap';
          label.style.marginRight = '10px';
          label.style.flexShrink = '0';
          label.title = value; // Add tooltip for full text

          const bar = document.createElement('div');
          const barWidth = Math.max(20, (count / maxCount) * baseBarWidth); // Minimum 20px, scale up to baseBarWidth
          bar.style.width = `${barWidth}px`;
          bar.style.height = '20px';
          bar.style.backgroundColor = '#2196f3';
          bar.style.flexShrink = '0';
          bar.title = `${count} items`; // Add tooltip
          
          const countLabel = document.createElement('div');
          countLabel.textContent = count;
          countLabel.style.marginLeft = '10px';
          countLabel.style.minWidth = '40px';
          countLabel.style.textAlign = 'right';
          countLabel.style.flexShrink = '0';

          barContainer.appendChild(label);
          barContainer.appendChild(bar);
          barContainer.appendChild(countLabel);
          scrollContainer.appendChild(barContainer);
        }

        chartContainer.appendChild(scrollContainer);

        // Add a note about scrolling if there are many items
        if (sortedCounts.length > 10) {
          const scrollNote = document.createElement('div');
          scrollNote.style.fontSize = '12px';
          scrollNote.style.color = '#666';
          scrollNote.style.marginTop = '5px';
          scrollNote.style.textAlign = 'center';
          scrollNote.textContent = `Showing ${sortedCounts.length} categories`;
          chartContainer.appendChild(scrollNote);
        }
      }
    };
  });

  const allColumns = config.columns.filter(c => c.display !== false).map(c => c.name);
  numericColumns = new Set(config.columns.filter(c => c.numeric).map(c => c.name)); // Assign in the ready callback

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

    if (filterColumnSelector.value === column) {
      updateFilterValueInput();
    }
    
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
    await updateColorEncoding();
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
        // Use only visible tiles for better performance
        const visibleTiles = scatterplot.renderer.visible_tiles();
        const promises = visibleTiles.map(async (tile) => {
          const column = await tile.get_column(filterColumn);
          for (const value of column) {
            allValues.add(value);
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
        void applyFilter();
      });
      filterValueContainer.appendChild(select);
    }
  }
  
  filterColumnSelector.addEventListener('change', () => {
    void updateFilterValueInput();
  });

  function updateLegend(colorEncoding, globalMapping) {
    legend.innerHTML = '';
    if (colorEncoding.transform === 'log') {
      // Create gradient for numeric data
      let gradientColors;
      if (colorEncoding.range.length > 2) {
        // Multi-color gradient
        gradientColors = colorEncoding.range.join(', ');
      } else {
        // Two-color gradient
        gradientColors = `${colorEncoding.range[0]}, ${colorEncoding.range[1]}`;
      }
      
      // Add labels for duration to show the range
      let rangeLabels = '';
      if (colorEncoding.field === 'dur') {
        rangeLabels = `
          <div style="display: flex; justify-content: space-between; font-size: 10px; margin-top: 2px; color: #666;">
            <span>~100ms</span>
            <span>~1s</span>
            <span>~10s+</span>
          </div>
        `;
      }
      
      legend.innerHTML = `
        <div style="display: flex; flex-direction: column;">
          <div style="width: 100%; height: 20px; background: linear-gradient(to right, ${gradientColors});"></div>
          ${rangeLabels}
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

  async function updateColorEncoding() {
    const newColorColumn = colorColumnSelector.value;
    const isNumeric = numericColumns.has(newColorColumn);

    let colorEncoding;
    let globalMapping = null;

    if (isNumeric) {
      // For duration, use a multi-color scale that better captures the dynamic range
      if (newColorColumn === 'dur') {
        colorEncoding = {
          field: newColorColumn,
          transform: 'log',
          range: ['#fde725', '#a0da39', '#4ac16d', '#1fa187', '#277f8e', '#365c8d', '#46327e', '#440154'], // Extended viridis: light yellow to dark purple
        };
      } else {
        // For other numeric columns, use the original two-color scale
        colorEncoding = {
          field: newColorColumn,
          transform: 'log',
          range: ['#fde725', '#21918c'],
        };
      }
    } else {
      const allValues = new Set();
      const visible_tiles = scatterplot.renderer.visible_tiles();
      console.log(`Processing ${visible_tiles.length} visible tiles for color encoding`);
      
      // Apply active filters to determine which values should be in the legend
      const promises = visible_tiles.map(async (tile) => {
        const column = await tile.get_column(newColorColumn);
        
        // If there are active filters, only include values from rows that pass all filters
        if (activeFilters.size > 0) {
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

      const uniqueValues = Array.from(allValues).sort((a, b) => {
        if (newColorColumn === 'cluster_id') {
          const numA = parseInt(a.split('#')[1], 10);
          const numB = parseInt(b.split('#')[1], 10);
          return numA - numB;
        }
        return a.localeCompare(b);
      });
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
      } else if (uniqueValues.length === 0) {
        // If there are no values, use a default color to avoid crashing.
        colorRange = ['#888888', '#888888'];
      }

      colorEncoding = {
        field: factorizedColumnName,
        transform: 'literal',
        range: colorRange,
      };
    }
    
    await scatterplot.plotAPI({
      encoding: {
        color: colorEncoding,
      },
    });
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
    const clusterId = datum['cluster_id'] || '';

    output += `${deviceName}\n`;
    if (traceUuid) {
      output += `<a href="https://apconsole.corp.google.com/link/perfetto/field_traces?uuid=${traceUuid}&query=" target="_blank">${traceUuid}</a>\n`;
    }
    output += `${buildId}\n`;
    output += `${startupType}\n`;
    if (clusterId) {
      output += `Cluster ID: ${clusterId}\n`;
    }

    detailContent.innerHTML = output;

    // Check if SVG data exists and is valid
    const hasSvg = datum.svg && datum.svg.trim() && datum.svg.includes('<svg');
    console.log('SVG check:', {
      exists: !!datum.svg,
      hasContent: datum.svg ? datum.svg.trim().length > 0 : false,
      isSvg: datum.svg ? datum.svg.includes('<svg') : false,
      preview: datum.svg ? datum.svg.substring(0, 100) + '...' : 'No data'
    });
    
    if (hasSvg) {
      bottomPanel.classList.add('open');
      bottomPanelContent.innerHTML = `<div class="svg-container">${datum.svg}</div>`;
      console.log('Bottom panel opened with SVG');
    } else {
      bottomPanel.classList.remove('open');
      console.log('No valid SVG data for this point - this is normal for points without trace visualizations');
    }
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
      bottomPanel.classList.remove('open');
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
  // Don't trigger shortcuts if user is typing in an input field
  if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT' || event.target.tagName === 'TEXTAREA') {
    return;
  }
  
  const { zoom } = scatterplot;
  const { transform } = zoom;
  const panAmount = 10; // Reduced from 25 to 10 for smoother movement
  
  switch (event.key.toLowerCase()) {
    case 'l':
      // Toggle selection mode
      const actionToolButton = document.getElementById('action-tool-button');
      const svg = document.querySelector('#deepscatter svg#deepscatter-svg');
      if (actionToolButton && svg) {
        selectionModeActive = !selectionModeActive;
        actionToolButton.classList.toggle('active', selectionModeActive);
        svg.style.cursor = selectionModeActive ? 'crosshair' : 'default';
      }
      break;
    case 'w':
      zoom.zoomer.scaleBy(zoom.svg_element_selection.transition().duration(100), 1.2, mousePosition);
      break;
    case 's':
      zoom.zoomer.scaleBy(zoom.svg_element_selection.transition().duration(100), 0.8, mousePosition);
      break;
    case 'a':
    case 'arrowleft':
      zoom.zoomer.translateBy(zoom.svg_element_selection.transition().duration(50), panAmount, 0);
      break;
    case 'd':
    case 'arrowright':
      zoom.zoomer.translateBy(zoom.svg_element_selection.transition().duration(50), -panAmount, 0);
      break;
    case 'arrowup':
      zoom.zoomer.translateBy(zoom.svg_element_selection.transition().duration(50), 0, panAmount);
      break;
    case 'arrowdown':
      zoom.zoomer.translateBy(zoom.svg_element_selection.transition().duration(50), 0, -panAmount);
      break;
  }
});