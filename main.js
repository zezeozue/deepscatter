import { Scatterplot, Deeptable } from './src/deepscatter.ts';
import { config } from './config.js';
import { scaleOrdinal } from 'd3-scale';
import { schemeTableau10 } from 'd3-scale-chromatic';
import { csvParse, tsvParse } from 'd3-dsv';
import * as arrow from 'apache-arrow';
import vegaEmbed from 'vega-embed';

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
let currentScatterplot = scatterplot; // Keep reference to current scatterplot
let hasActiveSelection = false; // Track if there's an active selection
let selectionDataBounds = null; // Store selection in data coordinates: {xMin, xMax, yMin, yMax}
let justResized = false;
let lastAction = null; // Track last action (chart/copy/open_first/open_all)
let lastColumn = null; // Track last column used
let currentSelectionData = null; // Track current selection data

function clearSelectionRectangle() {
  const selectionRectangle = document.getElementById('selection-rectangle');
  if (selectionRectangle) {
    selectionRectangle.style.display = 'none';
  }
  hasActiveSelection = false;
  selectionDataBounds = null;
  const panel = document.getElementById('action-panel');
  if (panel.classList.contains('open')) {
    panel.classList.remove('open');
  }
}

// Function to update selection rectangle position based on current zoom/pan
function updateSelectionRectanglePosition() {
  if (!hasActiveSelection || !selectionDataBounds) {
    return;
  }
  
  const selectionRectangle = document.getElementById('selection-rectangle');
  if (!selectionRectangle) {
    console.warn('[Rectangle] Selection rectangle element not found');
    return;
  }
  
  const currentSvg = document.querySelector('#deepscatter svg#deepscatter-svg');
  if (!currentSvg) {
    console.warn('[Rectangle] SVG element not found');
    return;
  }
  
  try {
    const { x_, y_ } = currentScatterplot.zoom.scales();
    const svgRect = currentSvg.getBoundingClientRect();
    const parentRect = currentSvg.parentElement.getBoundingClientRect();
    
    // Get side panel width to avoid occlusion
    const leftPanel = document.getElementById('left-panel');
    const sidePanelWidth = leftPanel ? leftPanel.offsetWidth : 300;
    
    // Get bottom panel height if open
    const bottomPanel = document.getElementById('action-panel');
    const bottomPanelHeight = (bottomPanel && bottomPanel.classList.contains('open') && !bottomPanel.classList.contains('collapsed'))
      ? bottomPanel.offsetHeight : 0;
    
    // Convert data coordinates back to screen coordinates
    const screenX1 = x_(selectionDataBounds.xMin);
    const screenX2 = x_(selectionDataBounds.xMax);
    const screenY1 = y_(selectionDataBounds.yMin);
    const screenY2 = y_(selectionDataBounds.yMax);
    
    let left = Math.min(screenX1, screenX2);
    let top = Math.min(screenY1, screenY2);
    let right = Math.max(screenX1, screenX2);
    let bottom = Math.max(screenY1, screenY2);
    
    // Calculate maximum allowed dimensions (viewport minus panels)
    const maxWidth = window.innerWidth - sidePanelWidth;
    const maxHeight = window.innerHeight - bottomPanelHeight;
    
    // Clip to visible viewport bounds (accounting for panels)
    left = Math.max(0, left);
    top = Math.max(0, top);
    right = Math.min(svgRect.width, right);
    bottom = Math.min(svgRect.height, bottom);
    
    // Also clip to viewport dimensions
    const viewportRight = maxWidth - (svgRect.left - parentRect.left);
    const viewportBottom = maxHeight - (svgRect.top - parentRect.top);
    
    right = Math.min(right, viewportRight);
    bottom = Math.min(bottom, viewportBottom);
    
    const width = right - left;
    const height = bottom - top;
    
    // Convert to parent-relative coordinates
    const finalLeft = left + (svgRect.left - parentRect.left);
    const finalTop = top + (svgRect.top - parentRect.top);
    
    // Only show if there's visible area
    if (width > 0 && height > 0) {
      selectionRectangle.style.left = `${finalLeft}px`;
      selectionRectangle.style.top = `${finalTop}px`;
      selectionRectangle.style.width = `${width}px`;
      selectionRectangle.style.height = `${height}px`;
      selectionRectangle.style.display = 'block';
    } else {
      selectionRectangle.style.display = 'none';
    }
  } catch (error) {
    console.error('[Rectangle] Error updating rectangle position:', error);
  }
}

// Function to setup selection region handlers
function setupSelectionRegion(plot) {
  // Use event delegation on the parent container instead of the SVG directly
  // This way it works even when the SVG is replaced
  const deepscatterDiv = document.getElementById('deepscatter');
  if (!deepscatterDiv) {
    console.error('[Selection] Deepscatter div not found');
    return;
  }
  
  // Update cursor style
  const svg = document.querySelector('#deepscatter svg#deepscatter-svg');
  if (svg && selectionModeActive) {
    svg.style.cursor = 'crosshair';
  }
}

// Function to setup zoom event handlers for selection rectangle
function setupZoomHandlers(plot) {
  if (plot.zoom && plot.zoom.zoomer) {
    plot.zoom.zoomer.on('zoom.selectionUpdate', () => {
      updateSelectionRectanglePosition();
    });
    
    plot.zoom.zoomer.on('end.selectionUpdate', () => {
      updateSelectionRectanglePosition();
    });
  }
}

// Function to setup all scatterplot event handlers
function setupScatterplotHandlers(plot) {
  plot.click_function = async (datum, plotInstance, ev) => {
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
    detailPanel.classList.add('open');
    
    // Display all available fields dynamically
    let output = '<div style="font-family: monospace; font-size: 12px;">';
    
    // Get all keys from the datum object
    const keys = Object.keys(datum).filter(k => k !== 'ix' && k !== 'x' && k !== 'y');
    
    for (const key of keys) {
      const value = datum[key];
      if (value !== null && value !== undefined) {
        // Format the value based on type
        let displayValue = value;
        if (typeof value === 'number') {
          // Format large numbers
          if (key === 'dur' || key.includes('duration')) {
            displayValue = `${(Number(value) / 1_000_000).toFixed(2)}ms`;
          } else if (value > 1000000) {
            displayValue = value.toLocaleString();
          }
        }
        
        // Check if it's a URL-like field
        if (key.includes('uuid') || key.includes('trace')) {
          output += `<div style="margin-bottom: 4px;"><strong>${key}:</strong> <a href="https://apconsole.corp.google.com/link/perfetto/field_traces?uuid=${value}&query=" target="_blank">${displayValue}</a></div>`;
        } else {
          output += `<div style="margin-bottom: 4px;"><strong>${key}:</strong> ${displayValue}</div>`;
        }
      }
    }
    
    output += '</div>';
    detailContent.innerHTML = output;

    // Check if SVG data exists and is valid
    const hasSvg = datum.svg && datum.svg.trim() && datum.svg.includes('<svg');
    
    if (hasSvg) {
      bottomPanel.classList.add('open');
      bottomPanelContent.innerHTML = `<div class="svg-container">${datum.svg}</div>`;
    } else {
      bottomPanel.classList.remove('open');
    }
    
    const selection = await plot.select_data({
      id: [selectedIx],
      key: 'ix',
      name: 'clicked_point'
    });
    plot.plotAPI({
      encoding: {
        size: {
          field: selection.name,
          range: [2, 10],
        }
      }
    })
  };
}

scatterplot.ready.then(async () => {
  document.title = 'BrushScatter';
  const actionToolButton = document.getElementById('action-tool-button');
  const deepscatterDiv = document.getElementById('deepscatter');
  const importCsvButton = document.getElementById('import-csv-button');
  const csvUpload = document.getElementById('csv-upload');

  importCsvButton.addEventListener('click', () => {
    csvUpload.click();
  });

  const importModal = document.getElementById('import-modal');
  const importButton = document.getElementById('import-button');
  const closeModalButton = importModal.querySelector('.close-button');

  closeModalButton.onclick = () => {
    importModal.style.display = 'none';
  };

  let currentFile = null;

  csvUpload.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
      currentFile = file;
      const reader = new FileReader();
      reader.onload = async (e) => {
        const text = e.target.result;
        const { columns } = csvParse(text.substring(0, 10000));
        const xColSelector = document.getElementById('x-column-selector');
        const yColSelector = document.getElementById('y-column-selector');
        xColSelector.innerHTML = '';
        yColSelector.innerHTML = '';
        for (const col of columns) {
          const optionX = document.createElement('option');
          optionX.value = col;
          optionX.text = col;
          xColSelector.appendChild(optionX);
          const optionY = document.createElement('option');
          optionY.value = col;
          optionY.text = col;
          yColSelector.appendChild(optionY);
        }
        importModal.style.display = 'block';
      };
      reader.readAsText(file);
    }
  });

  importButton.onclick = () => {
    if (!currentFile) {
      alert("Please select a file first.");
      return;
    }

    importModal.style.display = 'none';

    const xColSelector = document.getElementById('x-column-selector');
    const yColSelector = document.getElementById('y-column-selector');
    const xCol = xColSelector.value;
    const yCol = yColSelector.value;

    const reader = new FileReader();
    reader.onload = async (e) => {
        const text = e.target.result;
        const fileName = currentFile.name.toLowerCase();
        
        // Show loading overlay
        const loadingOverlay = document.getElementById('loading-overlay');
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');
        loadingOverlay.style.display = 'flex';
        
        // Create worker for parsing
        const worker = new Worker('data-parser.worker.js');
        
        worker.onmessage = async (workerEvent) => {
          const { type, progress, text: statusText, data, message } = workerEvent.data;
          
          if (type === 'progress') {
            progressBar.style.width = `${progress}%`;
            progressText.textContent = statusText;
          } else if (type === 'complete') {
            progressBar.style.width = '100%';
            progressText.textContent = 'Creating visualization...';
            
            // Destroy the existing plot to clear old data
            currentScatterplot.destroy();
            
            // Create new scatterplot instance
            currentScatterplot = new Scatterplot('#deepscatter');

            const { tableToIPC, Table, vectorFromArray, Schema, Field, Int32, Float32, Utf8 } = arrow;
            
            // Ensure 'ix' is in the columns list
            const allColumns = data.columns.includes('ix') ? data.columns : ['ix', ...data.columns];
            
            // Detect numeric vs categorical columns
            const detectedNumericColumns = new Set();
            const columnInfo = [];
            
            for (const col of allColumns) {
              if (col === 'ix') {
                continue;
              }
              
              const isNumeric = typeof data[0][col] === 'number';
              if (isNumeric) {
                detectedNumericColumns.add(col);
              }
              
              columnInfo.push({
                name: col,
                numeric: isNumeric,
                display: true
              });
            }
            
            // Set x and y values BEFORE creating schema and fields
            data.forEach(d => {
              d['x'] = d[xCol];
              d['y'] = d[yCol];
            });

            // Add x and y to columns if not already present
            if (!allColumns.includes('x')) {
              allColumns.push('x');
            }
            if (!allColumns.includes('y')) {
              allColumns.push('y');
            }

            // Now create fields including x and y
            const fields = allColumns.map((col) => {
              if (col === 'ix') {
                return new Field(col, new Int32(), false);
              }
              if (typeof data[0][col] === 'number') {
                return new Field(col, new Float32(), true);
              }
              return new Field(col, new Utf8(), true);
            });

            const schema = new Schema(fields);

            const vecs = Object.fromEntries(
              allColumns.map((col) => {
                const field = fields.find(f => f.name === col);
                return [col, vectorFromArray(data.map((d) => d[col]), field.type)];
              })
            )
            const arrowTable = new Table(schema, vecs);
            const arrowBuffer = tableToIPC(arrowTable, 'stream');

            const newPrefs = {
              max_points: 2000000,
              alpha: 15,
              zoom_balance: 0.3,
              point_size: 2,
              background_color: '#FFFFFF',
              arrow_buffer: arrowBuffer,
              encoding: {
                x: { field: 'x', transform: 'literal' },
                y: { field: 'y', transform: 'literal' },
              },
            };
            
            await currentScatterplot.plotAPI(newPrefs);
          
            // After plot is ready, populate the dropdowns with CSV columns
            await currentScatterplot.ready;
            
            // Re-setup all event listeners for the new scatterplot instance
            setupScatterplotHandlers(currentScatterplot);
            
            // Re-setup selection region handlers for the new scatterplot
            setupSelectionRegion(currentScatterplot);
            
            // Re-setup zoom handlers for selection rectangle tracking
            setupZoomHandlers(currentScatterplot);
            
            // Update global variables for the UI
            numericColumns = detectedNumericColumns;
            
            // Clear and repopulate color column selector
            colorColumnSelector.innerHTML = '';
            for (const col of columnInfo) {
              const option = document.createElement('option');
              option.value = col.name;
              option.text = col.name;
              colorColumnSelector.appendChild(option);
            }
            
            // Clear and repopulate filter column selector
            filterColumnSelector.innerHTML = '';
            for (const col of columnInfo) {
              const option = document.createElement('option');
              option.value = col.name;
              option.text = col.name;
              filterColumnSelector.appendChild(option);
            }
            
            // Trigger initial filter UI update and color encoding
            void updateFilterValueInput();
            
            // Trigger color encoding update to use first numeric column, or skip if too many categories
            if (columnInfo.length > 0) {
              // Try to find a numeric column first
              let selectedColumn = columnInfo.find(col => col.numeric);
              
              // If no numeric column, use first column but check if it has too many unique values
              if (!selectedColumn) {
                selectedColumn = columnInfo[0];
                
                // Check if this categorical column has too many unique values
                const firstColValues = new Set(data.map(d => d[selectedColumn.name]));
                if (firstColValues.size > 100) {
                  colorColumnSelector.value = selectedColumn.name;
                  // Don't call updateColorEncoding - let user choose manually
                  loadingOverlay.style.display = 'none';
                  worker.terminate();
                  return;
                }
              }
              
              colorColumnSelector.value = selectedColumn.name;
              await updateColorEncoding();
            }
            
            // Hide loading overlay
            loadingOverlay.style.display = 'none';
            worker.terminate();
          } else if (type === 'warning') {
          } else if (type === 'warning') {
            showToast(message);
          } else if (type === 'error') {
            alert('Error parsing file: ' + message);
            loadingOverlay.style.display = 'none';
            worker.terminate();
          }
        };
        
        worker.onerror = (error) => {
          alert('Error processing file: ' + error.message);
          loadingOverlay.style.display = 'none';
          worker.terminate();
        };
        
        // Send data to worker
        worker.postMessage({ text, fileName });
    };
    reader.readAsText(currentFile);
  };
  
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

  // Setup selection region for initial scatterplot
  setupSelectionRegion(scatterplot);
  
  actionToolButton.addEventListener('click', () => {
    selectionModeActive = !selectionModeActive;
    actionToolButton.classList.toggle('active', selectionModeActive);
    const svg = document.querySelector('#deepscatter svg#deepscatter-svg');
    if (svg) {
      svg.style.cursor = selectionModeActive ? 'crosshair' : 'default';
    }
  });

  // Use event delegation on deepscatter div which doesn't change
deepscatterDiv.addEventListener('mousedown', (e) => {
  if (!selectionModeActive) return;
  
  // Check if the click is on the SVG
  const currentSvg = document.querySelector('#deepscatter svg#deepscatter-svg');
  if (!currentSvg || !currentSvg.contains(e.target)) return;
  
  e.stopPropagation();
  e.preventDefault();
  isDrawing = true;
  hasDragged = false;
  
  const svgRect = currentSvg.getBoundingClientRect();
  
  startX = e.clientX - svgRect.left;
  startY = e.clientY - svgRect.top;
  
}, true);

// Add mousemove event for drawing selection rectangle
deepscatterDiv.addEventListener('mousemove', (e) => {
  if (!isDrawing) return;
  
  // Dynamically get SVG element
  const currentSvg = document.querySelector('#deepscatter svg#deepscatter-svg');
  if (!currentSvg) return;
  
  const svgRect = currentSvg.getBoundingClientRect();
  
  endX = e.clientX - svgRect.left;
  endY = e.clientY - svgRect.top;
  
  // Check if we've moved enough to consider this a drag (minimum 5 pixels)
  const deltaX = Math.abs(endX - startX);
  const deltaY = Math.abs(endY - startY);
  const minDragDistance = 5;
  
  if (!hasDragged && (deltaX > minDragDistance || deltaY > minDragDistance)) {
    hasDragged = true;
    // Get or create selection rectangle
    let selectionRectangle = document.getElementById('selection-rectangle');
    if (!selectionRectangle) {
      selectionRectangle = document.createElement('div');
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
      currentSvg.parentElement.appendChild(selectionRectangle);
    }
    selectionRectangle.style.display = 'block';
  }
  
  if (hasDragged) {
    const selectionRectangle = document.getElementById('selection-rectangle');
    if (!selectionRectangle) return;
    
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);
    
    const parentRect = currentSvg.parentElement.getBoundingClientRect();
    const left = Math.min(startX, endX) + (svgRect.left - parentRect.left);
    const top = Math.min(startY, endY) + (svgRect.top - parentRect.top);
    
    selectionRectangle.style.width = `${width}px`;
    selectionRectangle.style.height = `${height}px`;
    selectionRectangle.style.left = `${left}px`;
    selectionRectangle.style.top = `${top}px`;
  }
}, true);

deepscatterDiv.addEventListener('mouseup', async (e) => {
  if (!isDrawing) return;
  e.stopPropagation();
  isDrawing = false;
  
  // Only proceed with selection if we actually dragged
  if (!hasDragged) {
    hasDragged = false; // Reset for next selection
    clearSelectionRectangle();
    return;
  }
  
  // Keep the selection rectangle visible (don't hide it)
  hasActiveSelection = true;
  
  // Reset hasDragged after a short delay to allow the selection to complete
  setTimeout(() => {
    hasDragged = false;
  }, 100);
  
  // Dynamically get SVG element
  const currentSvg = document.querySelector('#deepscatter svg#deepscatter-svg');
  if (!currentSvg) return;
  
  const svgRect = currentSvg.getBoundingClientRect();
  
  endX = e.clientX - svgRect.left;
  endY = e.clientY - svgRect.top;
  
  // Calculate selection bounds in data coordinates
  const { x_, y_ } = currentScatterplot.zoom.scales();
        
  const xDomainMin = Math.min(x_.invert(startX), x_.invert(endX));
  const xDomainMax = Math.max(x_.invert(startX), x_.invert(endX));
  const startYData = y_.invert(startY);
  const endYData = y_.invert(endY);
  const yDomainMin = Math.min(startYData, endYData);
  const yDomainMax = Math.max(startYData, endYData);
  
  // Store selection bounds in data coordinates for zoom/pan awareness
  selectionDataBounds = {
    xMin: xDomainMin,
    xMax: xDomainMax,
    yMin: yDomainMin,
    yMax: yDomainMax
  };

  // Get only visible tiles for better performance with large datasets
  const allTiles = currentScatterplot.renderer.visible_tiles();
  
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
    
  const selection = await currentScatterplot.deeptable.select_data({
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
    
    // Get actual columns from the color/filter dropdowns which have the correct CSV columns
    let allColumnsForCharts = [];
    const colorSelector = document.getElementById('color-column-selector');
    if (colorSelector && colorSelector.options.length > 0) {
      // Use columns from color selector dropdown (which has CSV columns after upload)
      allColumnsForCharts = Array.from(colorSelector.options).map(opt => opt.value);
    } else {
      // Fallback to config columns
      allColumnsForCharts = config.columns.map(c => c.name);
    }
    
    const tilesToLoad = new Set();
    
    // Identify which tiles contain selected points
    for (const [tix, rix] of qids) {
      const tile = currentScatterplot.deeptable.flatTree[tix];
      if (tile) {
        tilesToLoad.add(tile);
      }
    }
    
    // Load ALL columns for tiles that have selected points to ensure chart data is available
    const columnLoadPromises = [];
    for (const tile of tilesToLoad) {
      for (const column of allColumnsForCharts) {
        columnLoadPromises.push(
          tile.get_column(column).catch(() => {
            // Some columns might not exist on some tiles, that's okay
          })
        );
      }
    }
    
    await Promise.all(columnLoadPromises);
    
    const data = currentScatterplot.deeptable.getQids(qids);
    currentSelectionData = data; // Store for auto-reload
    
    const panel = document.getElementById('action-panel');
    const closeButton = document.querySelector('.panel-close-button');
    const collapseButton = document.querySelector('.panel-collapse-button');
    const selectionCount = document.getElementById('selection-count');
    const executeButton = document.getElementById('execute-button');
    const columnSelector = document.getElementById('column-selector');
    const chartContainer = document.getElementById('chart-container');

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

    // Populate link column selector with all columns
    columnSelector.innerHTML = '';
    for (const colName of allColumnsForCharts) {
      const option = document.createElement('option');
      option.value = colName;
      option.text = colName;
      // Select trace_uuid by default if it exists
      if (colName === 'trace_uuid') {
        option.selected = true;
      }
      columnSelector.appendChild(option);
    }

    panel.classList.add('open');
    panel.classList.remove('collapsed');

    const resetPanel = () => {
      panel.classList.remove('open');
      panel.classList.remove('collapsed');
      // Reset chart container
      chartContainer.innerHTML = '';
      // Reset column selector to default
      columnSelector.selectedIndex = 0;
      
      // Also hide the selection rectangle and clear selection state
      const selectionRectangle = document.getElementById('selection-rectangle');
      if (selectionRectangle) {
        selectionRectangle.style.display = 'none';
      }
      hasActiveSelection = false;
      selectionDataBounds = null;
    };

    closeButton.onclick = resetPanel;
    


    collapseButton.onclick = () => {
      panel.classList.toggle('collapsed');
      collapseButton.textContent = panel.classList.contains('collapsed') ? '+' : '−';
    };
    
    // Setup resize functionality for the bottom nav panel (only once)
    if (!panel.dataset.resizeSetup) {
      const resizeHandle = document.querySelector('.panel-resize-handle');
      let isResizing = false;
      let resizeStartY = 0;
      let resizeStartHeight = 0;

      resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        resizeStartY = e.clientY;
        resizeStartHeight = panel.offsetHeight;
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
      });

      document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const deltaY = resizeStartY - e.clientY;
        const newHeight = resizeStartHeight + deltaY;
        const minHeight = 150;
        const maxHeight = window.innerHeight * 0.8;
        
        if (newHeight >= minHeight && newHeight <= maxHeight) {
          panel.style.height = `${newHeight}px`;
        }
      });

      document.addEventListener('mouseup', () => {
        if (isResizing) {
          isResizing = false;
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          justResized = true;
          setTimeout(() => {
            justResized = false;
          }, 100);
        }
      });
      
      panel.dataset.resizeSetup = 'true';
    }

    const executeAction = () => {
      const column = columnSelector.value;
      const action = document.getElementById('action-selector').value;
      
      // Save the last action and column for auto-reload
      lastAction = action;
      lastColumn = column;
      
      // Use current selection data
      if (!currentSelectionData) {
        return;
      }
      
      const values = currentSelectionData.map(d => d[column]);

      if (action === 'chart') {
        const isNumeric = numericColumns.has(column);
        chartContainer.innerHTML = '';
        const chartData = currentSelectionData.map(d => ({ [column]: d[column] }));

        // Get actual container dimensions
        const containerWidth = chartContainer.clientWidth || 600;
        const containerHeight = chartContainer.clientHeight || 400;

        let spec;
        if (isNumeric) {
          // Histogram: width fills container, bars auto-size
          spec = {
            $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
            data: { values: chartData },
            mark: { type: 'bar', tooltip: true },
            encoding: {
              x: { field: column, type: 'quantitative', bin: true, title: column },
              y: { aggregate: 'count', type: 'quantitative', title: 'Count' }
            },
            width: containerWidth - 100,
            height: Math.max(300, containerHeight - 40),
            config: {
              view: { continuousWidth: containerWidth - 100 }
            }
          };
        } else {
          // Categorical bar chart: fixed bar height, scrollable vertically
          const uniqueValues = new Set(chartData.map(d => d[column]));
          const barHeight = 25; // Fixed bar height
          const calculatedHeight = uniqueValues.size * barHeight;
          
          spec = {
            $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
            data: { values: chartData },
            mark: { type: 'bar', tooltip: true },
            encoding: {
              y: { field: column, type: 'nominal', sort: '-x', title: column, axis: { labelLimit: 200 } },
              x: { aggregate: 'count', type: 'quantitative', title: 'Count' }
            },
            width: containerWidth - 80,
            height: calculatedHeight
          };
        }
        vegaEmbed('#chart-container', spec, { actions: false });

      } else {
        const links = currentSelectionData.filter(d => d[column]).map(d => d[column]);
        if (links.length === 0) {
          alert(`No values found in column '${column}'`);
          return;
        }

        switch (action) {
          case 'copy':
            const linksText = links.map(link => `https://apconsole.corp.google.com/link/perfetto/field_traces?uuid=${link}&query=`).join('\n');
            navigator.clipboard.writeText(linksText).then(() => {
              alert(`Copied ${links.length} links to clipboard.`);
            }).catch(err => {
              alert('Failed to copy links.');
            });
            break;
          case 'open_first':
            window.open( `https://apconsole.corp.google.com/link/perfetto/field_traces?uuid=${links[0]}&query=`, '_blank');
            break;
          case 'open_all':
            links.forEach((link, index) => {
              setTimeout(() => {
                window.open( `https://apconsole.corp.google.com/link/perfetto/field_traces?uuid=${link}&query=`, '_blank');
              }, index * 200);
            });
            break;
        }
      }
    };
    
    executeButton.onclick = executeAction;
    
    // Auto-execute if we have a previous action
    if (lastAction && lastColumn) {
      // Set the selectors to the last used values
      const actionSelector = document.getElementById('action-selector');
      actionSelector.value = lastAction;
      columnSelector.value = lastColumn;
      
      // Execute the action automatically
      executeAction();
    }
  });

  const allColumns = config.columns.filter(c => c.display !== false).map(c => c.name);
  numericColumns = new Set(config.columns.filter(c => c.numeric).map(c => c.name)); // Assign in the ready callback

  const firstNumericColumn = config.columns.find(c => c.numeric);

  for (const col of config.columns) {
    const colName = col.name;
    const colorOption = document.createElement('option');
    colorOption.value = colName;
    colorOption.text = colName;
    if (firstNumericColumn && colName === firstNumericColumn.name) {
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
      await currentScatterplot.plotAPI({
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
      await currentScatterplot.plotAPI({
        encoding: {
          filter: null,
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
      const selection = await currentScatterplot.deeptable.select_data({
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
      
      await currentScatterplot.plotAPI({
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
        await currentScatterplot.plotAPI({
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
        await currentScatterplot.plotAPI({
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
        await currentScatterplot.plotAPI({
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
        const selection = await currentScatterplot.deeptable.select_data({
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
        
        await currentScatterplot.plotAPI({
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
        console.error('[Filter] Error applying categorical filter:', error);
        await currentScatterplot.plotAPI({
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
      await currentScatterplot.plotAPI({
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
        const visibleTiles = currentScatterplot.renderer.visible_tiles();
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

  function updateLegend(colorEncoding, globalMapping, dataRange = null) {
    legend.innerHTML = '';
    
    // Check if this is a numeric encoding (log or linear)
    const isNumericEncoding = colorEncoding.transform === 'log' || colorEncoding.transform === 'linear';
    
    if (isNumericEncoding) {
      // Create gradient for numeric data
      let gradientColors;
      if (colorEncoding.range.length > 2) {
        // Multi-color gradient
        gradientColors = colorEncoding.range.join(', ');
      } else {
        // Two-color gradient
        gradientColors = `${colorEncoding.range[0]}, ${colorEncoding.range[1]}`;
      }
      
      // Add labels to show the range
      let rangeLabels = '';
      if (dataRange) {
        const formatLabel = (value) => {
          const numValue = Number(value);
          // Handle edge cases
          if (!isFinite(numValue)) return '0';
          if (numValue === 0) return '0';
          
          // Show raw value with appropriate precision
          const absValue = Math.abs(numValue);
          if (absValue < 0.01) return numValue.toExponential(2);
          if (absValue < 1) return numValue.toFixed(3);
          if (absValue < 100) return numValue.toFixed(2);
          if (absValue < 10000) return numValue.toFixed(1);
          return numValue.toFixed(0);
        }
        
        // Handle case where all values are the same
        const minLabel = formatLabel(dataRange.min);
        const maxLabel = formatLabel(dataRange.max);
        
        rangeLabels = `
          <div style="display: flex; justify-content: space-between; font-size: 10px; margin-top: 2px; color: #666;">
            <span>${minLabel}</span>
            <span>${maxLabel}</span>
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
    let dataRange = null;

    if (isNumeric) {
      const visible_tiles = currentScatterplot.renderer.visible_tiles();
      let min = Infinity;
      let max = -Infinity;
      
      // Process tiles sequentially to properly update min/max
      for (const tile of visible_tiles) {
        try {
          const column = await tile.get_column(newColorColumn);
          for (const value of column) {
            if (value < min) min = value;
            if (value > max) max = value;
          }
        } catch (error) {
          console.error(`Error getting column ${newColorColumn} from tile ${tile.key}:`, error);
        }
      }
      
      // Sample some actual values to verify they're numeric
      const sampleValues = [];
      for (const tile of visible_tiles) {
        try {
          const column = await tile.get_column(newColorColumn);
          for (let i = 0; i < Math.min(10, column.length); i++) {
            sampleValues.push(column.get(i));
          }
          break; // Just sample from first tile
        } catch (error) {
          console.error(`Error sampling values:`, error);
        }
      }
      
      // Convert BigInt to Number if needed
      min = Number(min);
      max = Number(max);
      dataRange = {min, max};

      // Determine if we can use log transform (only for positive values)
      const canUseLog = min > 0 && max > 0;
      const transform = canUseLog ? 'log' : 'linear';
      
      colorEncoding = {
        field: newColorColumn,
        transform: transform,
        domain: [min, max],
        range: ['#fde725', '#a0da39', '#4ac16d', '#1fa187', '#277f8e', '#365c8d', '#46327e', '#440154'], // Extended viridis: light yellow to dark purple
      };
      
    } else {
      const allValues = new Set();
      const visible_tiles = currentScatterplot.renderer.visible_tiles();
      
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
      currentScatterplot.deeptable.transformations[factorizedColumnName] = async (tile) => {
        const baseColumn = await tile.get_column(newColorColumn);
        const transformedArray = Array.from(baseColumn).map(val => globalMapping[val] ?? 0);
        return new Float32Array(transformedArray);
      };

      const loadPromises = currentScatterplot.deeptable.map(tile => tile.get_column(factorizedColumnName));
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
    
    await currentScatterplot.plotAPI({
      encoding: {
        color: colorEncoding,
      },
    });
    updateLegend(colorEncoding, globalMapping, dataRange);
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
    let output = '<div style="font-family: monospace; font-size: 12px;">';
    
    // Get all keys from the datum object
    const keys = Object.keys(datum).filter(k => k !== 'ix' && k !== 'x' && k !== 'y');
    
    for (const key of keys) {
      const value = datum[key];
      if (value !== null && value !== undefined) {
        // Format the value based on type
        let displayValue = value;
        if (typeof value === 'number') {
          // Format large numbers
          if (key === 'dur' || key.includes('duration')) {
            displayValue = `${(Number(value) / 1_000_000).toFixed(2)}ms`;
          } else if (value > 1000000) {
            displayValue = value.toLocaleString();
          }
        }
        
        // Check if it's a URL-like field
        if (key.includes('uuid') || key.includes('trace')) {
          output += `<div style="margin-bottom: 4px;"><strong>${key}:</strong> <a href="https://apconsole.corp.google.com/link/perfetto/field_traces?uuid=${value}&query=" target="_blank">${displayValue}</a></div>`;
        } else {
          output += `<div style="margin-bottom: 4px;"><strong>${key}:</strong> ${displayValue}</div>`;
        }
      }
    }
    
    output += '</div>';
    detailContent.innerHTML = output;

    // Check if SVG data exists and is valid
    const hasSvg = datum.svg && datum.svg.trim() && datum.svg.includes('<svg');
    
    if (hasSvg) {
      bottomPanel.classList.add('open');
      bottomPanelContent.innerHTML = `<div class="svg-container">${datum.svg}</div>`;
    } else {
      bottomPanel.classList.remove('open');
    }
    const selection = await currentScatterplot.select_data({
      id: [selectedIx],
      key: 'ix',
      name: 'clicked_point'
    });
    currentScatterplot.plotAPI({
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
      currentScatterplot.plotAPI({
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
  
  const { zoom } = currentScatterplot;
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
      // Update selection rectangle after zoom
      setTimeout(() => updateSelectionRectanglePosition(), 150);
      break;
    case 's':
      zoom.zoomer.scaleBy(zoom.svg_element_selection.transition().duration(100), 0.8, mousePosition);
      // Update selection rectangle after zoom
      setTimeout(() => updateSelectionRectanglePosition(), 150);
      break;
    case 'a':
    case 'arrowleft':
      zoom.zoomer.translateBy(zoom.svg_element_selection.transition().duration(50), panAmount, 0);
      // Update selection rectangle after pan
      setTimeout(() => updateSelectionRectanglePosition(), 100);
      break;
    case 'd':
    case 'arrowright':
      zoom.zoomer.translateBy(zoom.svg_element_selection.transition().duration(50), -panAmount, 0);
      // Update selection rectangle after pan
      setTimeout(() => updateSelectionRectanglePosition(), 100);
      break;
    case 'arrowup':
      zoom.zoomer.translateBy(zoom.svg_element_selection.transition().duration(50), 0, panAmount);
      // Update selection rectangle after pan
      setTimeout(() => updateSelectionRectanglePosition(), 100);
      break;
    case 'arrowdown':
      zoom.zoomer.translateBy(zoom.svg_element_selection.transition().duration(50), 0, -panAmount);
      // Update selection rectangle after pan
      setTimeout(() => updateSelectionRectanglePosition(), 100);
      break;
  }
});

// Add zoom/pan event listeners to update selection rectangle
scatterplot.ready.then(() => {
  setupZoomHandlers(currentScatterplot);
});

function showToast(message) {
  const toast = document.getElementById('notification-toast');
  toast.textContent = message;
  toast.className = 'toast show';
  setTimeout(function(){ toast.className = toast.className.replace('show', ''); }, 3000);
}