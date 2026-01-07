/**
 * Main entry point for BrushScatter
 * Orchestrates all modules and initializes the application
 */

import { Scatterplot } from './src/deepscatter.ts';
import { csvParse } from 'd3-dsv';
import * as arrow from 'apache-arrow';
import type { FilterInfo, SelectionBounds, TilesConfig, ColumnInfo } from './types';
import { appState } from './app_state';
import { elements, querySelectors } from './src/dom';
import { 
  clearSelectionRectangle, 
  updateSelectionRectanglePosition, 
  setupSelectionRegion, 
  setupZoomHandlers 
} from './selection_ui';
import { renderChart, formatNumber } from './visuals';
import { 
  updateFilterChips, 
  removeFilter, 
  applyFilter, 
  updateFilterValueInput 
} from './filters';
import { updateColorEncoding } from './color_manager';
import { 
  setupScatterplotHandlers, 
  setupKeyboardHandlers, 
  setupClickOutsideHandler 
} from './handlers';

// --- State Variables ---
let tooltipLocked: boolean = false;
let selectedIx: number | null = null;
let numericColumns: Set<string> = new Set();
let activeFilters: Map<string, FilterInfo> = new Map();
let selectionModeActive: boolean = false;
let currentScatterplot: Scatterplot;
let hasActiveSelection: boolean = false;
let selectionDataBounds: SelectionBounds | null = null;
let justResized: boolean = false;
let lastAction: string | null = null;
let lastColumn: string | null = null;
let currentSelectionData: any[] | null = null;
let justClicked: boolean = false;
let tilesConfig: TilesConfig | null = null;
let mousePosition: [number, number] = [0, 0];

// Initialize Scatterplot
const scatterplot = new Scatterplot('#deepscatter');
currentScatterplot = scatterplot;

const defaultPrefs = {
  source_url: '/tiles',
  max_points: 2000000,
  alpha: 15,
  zoom_balance: 0.3,
  point_size: 2,
  background_color: '#FFFFFF',
  encoding: {
    x: { field: 'x', transform: 'literal' as const },
    y: { field: 'y', transform: 'literal' as const },
  },
} as any;

console.log('[Main] Initializing scatterplot with default prefs');
scatterplot.plotAPI(defaultPrefs).catch(() => {
  console.log('[Main] No default tiles data found - waiting for CSV upload');
});

fetch('/tiles/config.json')
  .then(res => res.json())
  .then((config: TilesConfig) => {
    tilesConfig = config;
    console.log('Loaded tiles config:', config);
  })
  .catch(() => {
    console.log('No tiles config found - columns will be populated from CSV upload');
  });

// --- Helper Functions ---

function showToast(msg: string): void {
  elements.notificationToast.textContent = msg;
  elements.notificationToast.className = 'toast show';
  setTimeout(() => elements.notificationToast.className = elements.notificationToast.className.replace('show', ''), 3000);
}

// --- Setup UI ---

const setupUI = async (): Promise<void> => {
  console.log('[Main] setupUI called');
  document.title = 'BrushScatter';
  
  const closeModalButton = querySelectors.closeModalButton();
  if (closeModalButton) {
    closeModalButton.onclick = () => elements.importModal.style.display = 'none';
  }

  elements.importCsvButton.addEventListener('click', () => elements.csvUpload.click());

  let currentFile: File | null = null;

  elements.csvUpload.addEventListener('change', (event: Event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      currentFile = file;
      const reader = new FileReader();
      reader.onload = async (e: any) => {
        const text = e.target.result;
        const { columns } = csvParse(text.substring(0, 10000));
        elements.xColumnSelector.innerHTML = '';
        elements.yColumnSelector.innerHTML = '';
        
        // Smart column detection for x and y
        const findBestColumn = (axis: 'x' | 'y'): string => {
          const axisLower = axis.toLowerCase();
          
          // Priority 1: Exact match (case insensitive)
          const exactMatch = columns.find(col => col.toLowerCase() === axisLower);
          if (exactMatch) return exactMatch;
          
          // Priority 2: Columns containing axis with underscore or dash
          const withSeparator = columns.find(col => {
            const lower = col.toLowerCase();
            return lower.includes(`_${axisLower}`) || lower.includes(`${axisLower}_`) ||
                   lower.includes(`-${axisLower}`) || lower.includes(`${axisLower}-`);
          });
          if (withSeparator) return withSeparator;
          
          // Priority 3: Columns starting or ending with axis
          const startsOrEnds = columns.find(col => {
            const lower = col.toLowerCase();
            return lower.startsWith(axisLower) || lower.endsWith(axisLower);
          });
          if (startsOrEnds) return startsOrEnds;
          
          // Fallback: First column for x, second for y (or first if only one column)
          return axis === 'x' ? columns[0] : (columns[1] || columns[0]);
        };
        
        const bestX = findBestColumn('x');
        const bestY = findBestColumn('y');
        
        columns.forEach(col => {
          const optionX = document.createElement('option');
          optionX.value = col; optionX.text = col;
          if (col === bestX) optionX.selected = true;
          elements.xColumnSelector.appendChild(optionX);
          
          const optionY = document.createElement('option');
          optionY.value = col; optionY.text = col;
          if (col === bestY) optionY.selected = true;
          elements.yColumnSelector.appendChild(optionY);
        });
        elements.importModal.style.display = 'block';
      };
      reader.readAsText(file);
    }
  });

  elements.importButton.onclick = () => {
    if (!currentFile) {
      alert("Please select a file first.");
      return;
    }
    elements.importModal.style.display = 'none';
    const xCol = elements.xColumnSelector.value;
    const yCol = elements.yColumnSelector.value;

    const reader = new FileReader();
    reader.onload = async (e: any) => {
      const text = e.target.result;
      const fileName = currentFile!.name.toLowerCase();
      elements.loadingOverlay.style.display = 'flex';

      const worker = new Worker(new URL('./parser_worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = async (workerEvent: MessageEvent) => {
        const { type, progress, text: statusText, data, message } = workerEvent.data;

        if (type === 'progress') {
          elements.progressBar.style.width = `${progress}%`;
          elements.progressText.textContent = statusText;
        } else if (type === 'complete') {
          elements.progressBar.style.width = '100%';
          elements.progressText.textContent = 'Creating visualization...';

          currentScatterplot.destroy();
          currentScatterplot = new Scatterplot('#deepscatter');

          const { tableToIPC, Table, vectorFromArray, Schema, Field, Int32, Float32, Utf8 } = arrow;
          const allColumns = data.columns.includes('ix') ? data.columns : ['ix', ...data.columns];
          const detectedNumericColumns = new Set<string>();
          const columnInfo: ColumnInfo[] = [];

          allColumns.forEach((col: string) => {
            if (col === 'ix') return;
            const isNumeric = typeof data[0][col] === 'number';
            if (isNumeric) detectedNumericColumns.add(col);
            columnInfo.push({ name: col, numeric: isNumeric, display: true });
          });

          data.forEach((d: any) => {
            d['x'] = d[xCol];
            d['y'] = d[yCol];
          });

          if (!allColumns.includes('x')) allColumns.push('x');
          if (!allColumns.includes('y')) allColumns.push('y');

          const fields = allColumns.map((col: string) => {
            if (col === 'ix') return new Field(col, new Int32(), false);
            if (typeof data[0][col] === 'number') return new Field(col, new Float32(), true);
            return new Field(col, new Utf8(), true);
          });

          const schema = new Schema(fields);
          const vecs = Object.fromEntries(
            allColumns.map((col: string) => {
              const field = fields.find((f: any) => f.name === col)!;
              return [col, vectorFromArray(data.map((d: any) => d[col]), field.type)];
            })
          );

          const arrowTable = new Table(schema, vecs);
          // Store the original table for accessing all columns (including strings)
          appState.originalTable = arrowTable;
          const arrowBuffer = tableToIPC(arrowTable, 'stream');

          await currentScatterplot.plotAPI({
            max_points: 2000000,
            alpha: 15,
            zoom_balance: 0.3,
            point_size: 2,
            background_color: '#FFFFFF',
            arrow_buffer: arrowBuffer,
            encoding: {
              x: { field: 'x', transform: 'literal' as const },
              y: { field: 'y', transform: 'literal' as const },
            },
          } as any);

          await currentScatterplot.ready;
          setupScatterplotHandlers(
            currentScatterplot,
            () => ({ justClicked, tooltipLocked, selectedIx }),
            (updates) => {
              if ('justClicked' in updates) justClicked = updates.justClicked!;
              if ('tooltipLocked' in updates) tooltipLocked = updates.tooltipLocked!;
              if ('selectedIx' in updates) selectedIx = updates.selectedIx!;
            }
          );
          setupSelectionRegion(currentScatterplot, selectionModeActive);
          setupZoomHandlers(currentScatterplot, () => hasActiveSelection, () => selectionDataBounds);

          // Recreate selection rectangle for the new scatterplot
          console.log('[Main] Recreating selection rectangle after CSV import');
          const newSvg = querySelectors.svg();
          console.log('[Main] New SVG found:', !!newSvg);
          let newSelectionRectangle = document.getElementById('selection-rectangle');
          console.log('[Main] Existing selection rectangle:', !!newSelectionRectangle);
          if (!newSelectionRectangle && newSvg?.parentElement) {
            console.log('[Main] Creating new selection rectangle');
            newSelectionRectangle = document.createElement('div');
            newSelectionRectangle.id = 'selection-rectangle';
            newSelectionRectangle.style.cssText = `position: absolute; border: 2px dashed #007bff; background-color: rgba(0, 123, 255, 0.1); display: none; z-index: 999; pointer-events: none; top: 0; left: 0;`;
            newSvg.parentElement.appendChild(newSelectionRectangle);
            console.log('[Main] Selection rectangle created and appended');
          }

          numericColumns = detectedNumericColumns;
          elements.colorColumnSelector.innerHTML = '';
          elements.filterColumnSelector.innerHTML = '';

          columnInfo.forEach(col => {
            const opt = document.createElement('option');
            opt.value = col.name; opt.text = col.name;
            elements.colorColumnSelector.appendChild(opt.cloneNode(true) as HTMLOptionElement);
            elements.filterColumnSelector.appendChild(opt);
          });

          await updateFilterValueInput(currentScatterplot, numericColumns, activeFilters);

          if (columnInfo.length > 0) {
            let selectedColumn = columnInfo.find(col => col.numeric) || columnInfo[0];
            const firstColValues = new Set(data.map((d: any) => d[selectedColumn.name]));
            elements.colorColumnSelector.value = selectedColumn.name;
            if (firstColValues.size <= 100 || selectedColumn.numeric) {
              console.log('[Main] Calling updateColorEncoding after CSV import');
              await updateColorEncoding(currentScatterplot, numericColumns, activeFilters);
            }
          }

          elements.loadingOverlay.style.display = 'none';
          worker.terminate();
        } else if (type === 'warning') {
          showToast(message);
        } else if (type === 'error') {
          alert('Error parsing file: ' + message);
          elements.loadingOverlay.style.display = 'none';
          worker.terminate();
        }
      };
      worker.postMessage({ text, fileName });
    };
    reader.readAsText(currentFile);
  };

  // Create selection rectangle
  const svg = querySelectors.svg();
  const selectionRectangle = document.createElement('div');
  selectionRectangle.id = 'selection-rectangle';
  selectionRectangle.style.cssText = `position: absolute; border: 2px dashed #007bff; background-color: rgba(0, 123, 255, 0.1); display: none; z-index: 999; pointer-events: none; top: 0; left: 0;`;
  if (svg?.parentElement) {
    svg.parentElement.appendChild(selectionRectangle);
  }

  let isDrawing = false;
  let startX: number, startY: number, endX: number, endY: number;
  let hasDragged = false;

  setupSelectionRegion(scatterplot, selectionModeActive);

  elements.actionToolButton.addEventListener('click', () => {
    selectionModeActive = !selectionModeActive;
    elements.actionToolButton.classList.toggle('active', selectionModeActive);
    const svg = querySelectors.svg();
    if (svg) svg.style.cursor = selectionModeActive ? 'crosshair' : 'default';
  });

  elements.deepscatterDiv.addEventListener('mousedown', (e) => {
    console.log('[Main] Mousedown event, selectionModeActive:', selectionModeActive);
    if (!selectionModeActive) return;
    const currentSvg = querySelectors.svg();
    console.log('[Main] Current SVG:', !!currentSvg);
    if (!currentSvg || !currentSvg.contains(e.target as Node)) return;

    console.log('[Main] Starting drawing');
    e.stopPropagation();
    e.preventDefault();
    isDrawing = true;
    hasDragged = false;
    const svgRect = currentSvg.getBoundingClientRect();
    startX = e.clientX - svgRect.left;
    startY = e.clientY - svgRect.top;
  }, true);

  elements.deepscatterDiv.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const currentSvg = querySelectors.svg();
    if (!currentSvg) return;

    const svgRect = currentSvg.getBoundingClientRect();
    endX = e.clientX - svgRect.left;
    endY = e.clientY - svgRect.top;

    const deltaX = Math.abs(endX - startX);
    const deltaY = Math.abs(endY - startY);
    if (!hasDragged && (deltaX > 5 || deltaY > 5)) {
      hasDragged = true;
      const rect = document.getElementById('selection-rectangle');
      console.log('[Main] Showing selection rectangle, element found:', !!rect);
      if (rect) {
        rect.style.display = 'block';
        console.log('[Main] Rectangle display set to block');
      }
    }

    if (hasDragged) {
      const rect = document.getElementById('selection-rectangle');
      if (rect) {
        const parentRect = currentSvg.parentElement!.getBoundingClientRect();
        const left = Math.min(startX, endX) + (svgRect.left - parentRect.left);
        const top = Math.min(startY, endY) + (svgRect.top - parentRect.top);
        rect.style.width = `${Math.abs(endX - startX)}px`;
        rect.style.height = `${Math.abs(endY - startY)}px`;
        rect.style.left = `${left}px`;
        rect.style.top = `${top}px`;
      }
    }
  }, true);

  elements.deepscatterDiv.addEventListener('mouseup', async (e) => {
    if (!isDrawing) return;
    e.stopPropagation();
    isDrawing = false;
    if (!hasDragged) {
      clearSelectionRectangle(
        { value: hasActiveSelection },
        { value: selectionDataBounds }
      );
      return;
    }
    hasActiveSelection = true;
    setTimeout(() => { hasDragged = false; }, 100);

    const currentSvg = querySelectors.svg();
    const { x_, y_ } = (currentScatterplot as any).zoom.scales();
    const xDomainMin = Math.min(x_.invert(startX), x_.invert(endX));
    const xDomainMax = Math.max(x_.invert(startX), x_.invert(endX));
    const yDomainMin = Math.min(y_.invert(startY), y_.invert(endY));
    const yDomainMax = Math.max(y_.invert(startY), y_.invert(endY));

    selectionDataBounds = { xMin: xDomainMin, xMax: xDomainMax, yMin: yDomainMin, yMax: yDomainMax };

    const selection = await currentScatterplot.deeptable.select_data({
      name: `selection_${Date.now()}`,
      tileFunction: async (tile: any) => {
        const xCol = await tile.get_column('x');
        const yCol = await tile.get_column('y');
        const { Vector, makeData, Bool } = await import('apache-arrow');
        const numRows = tile.record_batch.numRows;
        const boolArray = new Uint8Array(Math.ceil(numRows / 8));
        const filterColumns = new Map();
        for (const [colName] of activeFilters) {
          filterColumns.set(colName, await tile.get_column(colName));
        }

        for (let i = 0; i < numRows; i++) {
          const xVal = xCol.get(i);
          const yVal = yCol.get(i);
          if (xVal >= xDomainMin && xVal <= xDomainMax && yVal >= yDomainMin && yVal <= yDomainMax) {
            let passes = true;
            for (const [colName, filterInfo] of activeFilters) {
              const val = filterColumns.get(colName).get(i);
              if (filterInfo.type === 'numeric') {
                const { minValue, maxValue } = filterInfo.value as { minValue: number | null; maxValue: number | null };
                if ((minValue !== null && val < minValue) || (maxValue !== null && val > maxValue)) {
                  passes = false; break;
                }
              } else if (val !== filterInfo.value) {
                passes = false; break;
              }
            }
            if (passes) {
              boolArray[Math.floor(i / 8)] |= (1 << (i % 8));
            }
          }
        }
        return new Vector([makeData({ type: new Bool(), data: boolArray, length: numRows })]);
      }
    });

    await selection.applyToAllLoadedTiles();
    const qids = await selection.get_qids();
    let allColumnsForCharts: string[] = Array.from(elements.colorColumnSelector.options).map(o => o.value);
    const data = currentScatterplot.deeptable.getQids(qids);
    currentSelectionData = data;

    const closeButton = querySelectors.panelCloseButton();
    const collapseButton = querySelectors.panelCollapseButton();

    elements.selectionCount.textContent = formatNumber(data.length);
    elements.columnSelector.innerHTML = '';
    allColumnsForCharts.forEach(col => {
      const opt = document.createElement('option');
      opt.value = col; opt.text = col;
      // Use lastColumn if available, otherwise default to trace_uuid
      if (lastColumn && col === lastColumn) {
        opt.selected = true;
      } else if (!lastColumn && col === 'trace_uuid') {
        opt.selected = true;
      }
      elements.columnSelector.appendChild(opt);
    });

    elements.actionPanel.classList.add('open');
    elements.actionPanel.classList.remove('collapsed');

    if (closeButton) {
      closeButton.onclick = () => {
        elements.actionPanel.classList.remove('open');
        selectionRectangle.style.display = 'none';
        hasActiveSelection = false;
        selectionDataBounds = null;
      };
    }

    if (collapseButton) {
      collapseButton.onclick = () => {
        elements.actionPanel.classList.toggle('collapsed');
        collapseButton.textContent = elements.actionPanel.classList.contains('collapsed') ? '+' : '−';
      };
    }

    const executeAction = () => {
      const column = elements.columnSelector.value;
      const action = elements.actionSelector.value;
      lastAction = action; lastColumn = column;
      if (!currentSelectionData) return;

      if (action === 'chart') {
        const isNumeric = numericColumns.has(column);
        elements.chartContainer.innerHTML = '';
        const containerWidth = elements.chartContainer.clientWidth || 600;
        const containerHeight = elements.chartContainer.clientHeight || 400;
        renderChart('#chart-container', currentSelectionData, column, isNumeric, containerWidth, containerHeight);
      } else {
        const links = currentSelectionData.filter(d => d[column]).map(d => d[column]);
        if (links.length === 0) return alert(`No values found in column '${column}'`);
        const getUrl = (id: string) => `https://apconsole.corp.google.com/link/perfetto/field_traces?uuid=${id}&query=`;
        
        if (action === 'copy') {
          navigator.clipboard.writeText(links.map(getUrl).join('\n')).then(() => alert(`Copied ${links.length} links.`));
        } else if (action === 'open_first') {
          window.open(getUrl(links[0]), '_blank');
        } else if (action === 'open_all') {
          links.forEach((l, i) => setTimeout(() => window.open(getUrl(l), '_blank'), i * 200));
        }
      }
    };
    elements.executeButton.onclick = executeAction;
    if (lastAction && lastColumn) executeAction();
  }, true);

  // Initialize from config if present
  if (tilesConfig?.columns) {
    numericColumns = new Set(tilesConfig.columns.filter(c => c.numeric).map(c => c.name));
    tilesConfig.columns.forEach(col => {
      const opt = document.createElement('option');
      opt.value = col.name; opt.text = col.name;
      elements.colorColumnSelector.appendChild(opt.cloneNode(true) as HTMLOptionElement);
      elements.filterColumnSelector.appendChild(opt);
    });
    await updateFilterValueInput(currentScatterplot, numericColumns, activeFilters);
    scatterplot.ready.then(() => {
      console.log('[Main] Scatterplot ready, calling updateColorEncoding from tiles config');
      setupScatterplotHandlers(
        currentScatterplot,
        () => ({ justClicked, tooltipLocked, selectedIx }),
        (updates) => {
          if ('justClicked' in updates) justClicked = updates.justClicked!;
          if ('tooltipLocked' in updates) tooltipLocked = updates.tooltipLocked!;
          if ('selectedIx' in updates) selectedIx = updates.selectedIx!;
        }
      );
      updateColorEncoding(currentScatterplot, numericColumns, activeFilters);
      setupZoomHandlers(currentScatterplot, () => hasActiveSelection, () => selectionDataBounds);
    });
  } else {
    numericColumns = new Set();
  }

  // Setup event listeners
  elements.filterColumnSelector.addEventListener('change', () => {
    updateFilterValueInput(currentScatterplot, numericColumns, activeFilters);
  });

  elements.colorColumnSelector.addEventListener('change', async () => {
    console.log('[Main] Color column selector changed, calling updateColorEncoding');
    await updateColorEncoding(currentScatterplot, numericColumns, activeFilters);
  });

  // Setup keyboard handlers
  setupKeyboardHandlers(
    currentScatterplot,
    {
      selectionModeActive: { value: selectionModeActive },
      hasActiveSelection,
      selectionDataBounds
    },
    () => updateSelectionRectanglePosition(currentScatterplot, hasActiveSelection, selectionDataBounds)
  );

  // Setup click outside handler
  setupClickOutsideHandler(
    () => ({ justClicked, tooltipLocked, selectedIx }),
    (updates) => {
      if ('justClicked' in updates) justClicked = updates.justClicked!;
      if ('tooltipLocked' in updates) tooltipLocked = updates.tooltipLocked!;
      if ('selectedIx' in updates) selectedIx = updates.selectedIx!;
    },
    currentScatterplot,
    numericColumns
  );

  // Setup bottom panel resize functionality
  const resizeHandle = document.querySelector('.panel-resize-handle') as HTMLElement;
  const actionPanel = elements.actionPanel;
  
  if (resizeHandle && actionPanel) {
    let isResizing = false;
    let startY = 0;
    let startHeight = 0;
    const minHeight = 100;
    const maxHeight = window.innerHeight - 100;
    
    resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
      isResizing = true;
      startY = e.clientY;
      startHeight = actionPanel.offsetHeight;
      e.preventDefault();
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
    });
    
    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!isResizing) return;
      
      const deltaY = startY - e.clientY;
      const newHeight = Math.min(Math.max(startHeight + deltaY, minHeight), maxHeight);
      actionPanel.style.height = `${newHeight}px`;
      
      // Update selection rectangle position if active
      if (hasActiveSelection && selectionDataBounds) {
        updateSelectionRectanglePosition(currentScatterplot, hasActiveSelection, selectionDataBounds);
      }
    });
    
    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  // Track mouse position for zoom
  document.addEventListener('mousemove', (event) => {
    mousePosition = [event.clientX, event.clientY];
  });
};

// Initialize
scatterplot.ready.then(setupUI).catch(setupUI);
