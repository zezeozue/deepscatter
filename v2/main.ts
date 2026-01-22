console.log('Main script loading... (v2)');

import embed from 'vega-embed';

// State variables for region selection
let selectionModeActive = false;
let isDrawing = false;
let hasDragged = false;
let startX = 0, startY = 0, endX = 0, endY = 0;
let hasActiveSelection = false;
let selectionDataBounds: { xMin: number; xMax: number; yMin: number; yMax: number } | null = null;
let currentSelectionData: any[] | null = null;
let lastColumn: string | null = null;
let lastMouseX = 0;
let lastMouseY = 0;

async function init() {
    try {
        console.log('Attempting to import ScatterGL...');
        const { ScatterGL } = await import('./src/core/scatter_gl');
        const { LegendRenderer } = await import('./src/aesthetics/legend');
        console.log('ScatterGL imported successfully');

        const container = document.getElementById('container') as HTMLElement;
        if (!container) {
            console.error('Container not found!');
            return;
        }
        
        console.log('Container found, initializing plot...');
        const plot = new ScatterGL(container);
        
        // Initialize legend renderer
        const legend = new LegendRenderer('legend-container');
        
        // Load data (stubbed)
        plot.load('tiles/')
            .then(() => {
                console.log('Initial load request complete');
                setupRegionSelection(plot);
            })
            .catch(e => console.error('Initial load request failed', e));

        // @ts-ignore
        window.plot = plot;
        // @ts-ignore
        window.legend = legend;
        
        // Wire up color selector to update legend
        const colorSelector = document.getElementById('color-by-selector') as HTMLSelectElement;
        if (colorSelector) {
            const originalApplyColor = plot.applyColorEncoding.bind(plot);
            plot.applyColorEncoding = (field: string) => {
                originalApplyColor(field);
                const scale = plot.colorManager.getCurrentScale();
                // Always update legend - clear if no scale, render if scale exists
                if (scale === null) {
                    // console.log('Clearing legend because scale is null');
                    legend.clear();
                } else {
                    // console.log('Rendering legend with scale:', scale);
                    legend.render(scale);
                }
            };
        }

        const appContainer = document.getElementById('app-container');
        if (appContainer) {
            const updateTheme = () => {
                const isDarkMode = appContainer.classList.contains('dark-mode');
                // The renderer is not directly accessible from the plot object.
                // This is a limitation of the current structure.
                // As a workaround, I will access the private renderer property.
                // A better solution would be to expose a method on ScatterGL to set the theme.
                // @ts-ignore
                const renderer = plot.renderer;
                if (renderer) {
                    if (isDarkMode) {
                        renderer.setClearColor(0.066, 0.066, 0.066, 1);
                        renderer.setGridColor(0.9, 0.9, 0.9, 0.2);
                    } else {
                        renderer.setClearColor(1, 1, 1, 1);
                        renderer.setGridColor(0.2, 0.2, 0.2, 0.5);
                    }
                    plot.render();
                }
            };

            const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                        updateTheme();
                    }
                }
            });

            observer.observe(appContainer, { attributes: true });
            updateTheme(); // Initial theme setup
            
            // Also reload chart when theme changes
            const chartObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                        // If there's a chart displayed, reload it
                        const chartContainer = document.getElementById('chart-container');
                        const columnSelector = document.getElementById('column-selector') as HTMLSelectElement;
                        if (chartContainer && chartContainer.children.length > 0 && columnSelector && columnSelector.value) {
                            setTimeout(() => renderChart(columnSelector.value), 100);
                        }
                    }
                }
            });
            chartObserver.observe(appContainer, { attributes: true });
        }
        
        // Setup keyboard bindings
        setupKeyboardBindings(plot);

    } catch (e) {
        console.error('Failed to initialize application:', e);
    }
}

function setupKeyboardBindings(plot: any) {
    // Track mouse position
    const canvas = document.getElementById('container')?.querySelector('canvas');
    if (canvas) {
        canvas.addEventListener('mousemove', (e: MouseEvent) => {
            const rect = canvas.getBoundingClientRect();
            lastMouseX = e.clientX - rect.left;
            lastMouseY = e.clientY - rect.top;
        });
    }
    
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        // Ignore if typing in an input field
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
            return;
        }
        
        const transform = plot.getTransform();
        const panAmount = 50; // pixels
        const zoomFactor = 1.2;
        
        switch(e.key.toLowerCase()) {
            case 'w': // Pan up
                e.preventDefault();
                plot.getController().setTransform(transform.k, transform.x, transform.y + panAmount);
                break;
            case 's': // Pan down
                e.preventDefault();
                plot.getController().setTransform(transform.k, transform.x, transform.y - panAmount);
                break;
            case 'a': // Pan left
                e.preventDefault();
                plot.getController().setTransform(transform.k, transform.x + panAmount, transform.y);
                break;
            case 'd': // Pan right
                e.preventDefault();
                plot.getController().setTransform(transform.k, transform.x - panAmount, transform.y);
                break;
            case 'q': // Zoom in centered at cursor
                e.preventDefault();
                zoomAtPoint(plot, lastMouseX, lastMouseY, zoomFactor);
                break;
            case 'e': // Zoom out centered at cursor
                e.preventDefault();
                zoomAtPoint(plot, lastMouseX, lastMouseY, 1 / zoomFactor);
                break;
            case 'c': // Recenter to full extent
                e.preventDefault();
                recenterToFullExtent(plot);
                break;
            case 'l': // Toggle selection mode
                e.preventDefault();
                selectionModeActive = !selectionModeActive;
                const selectModeToggle = document.getElementById('select-mode-toggle');
                const canvas = document.getElementById('container')?.querySelector('canvas');
                
                if (selectModeToggle && canvas) {
                    if (selectionModeActive) {
                        selectModeToggle.classList.add('active');
                        canvas.style.cursor = 'crosshair';
                    } else {
                        selectModeToggle.classList.remove('active');
                        canvas.style.cursor = 'default';
                        // Clear any active selections when disabling
                        clearSelection();
                    }
                }
                break;
        }
    });
}

function recenterToFullExtent(plot: any) {
    // Get all tiles to calculate the full extent
    const tileStore = plot.getTileStore();
    const allTiles = tileStore.getAllTiles();
    
    if (allTiles.length === 0) return;
    
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    // Calculate extent from all loaded tiles
    for (const tile of allTiles) {
        if (!tile.data) continue;
        
        const xCol = tile.data.getChild('x');
        const yCol = tile.data.getChild('y');
        
        if (!xCol || !yCol) continue;
        
        const numRows = tile.data.numRows;
        for (let i = 0; i < numRows; i++) {
            const x = xCol.get(i);
            const y = yCol.get(i);
            
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    
    // If we found valid bounds, fit to them
    if (isFinite(minX) && isFinite(maxX) && isFinite(minY) && isFinite(maxY)) {
        const dataW = maxX - minX;
        const dataH = maxY - minY;
        
        if (dataW <= 0 || dataH <= 0) return;

        const canvas = document.getElementById('container')?.querySelector('canvas');
        if (!canvas) return;
        
        const { width, height } = canvas.getBoundingClientRect();
        const minDimension = Math.min(width, height);
        
        const kx = width / (dataW * minDimension);
        const ky = height / (dataH * minDimension);
        const k = Math.min(kx, ky) * 0.9;

        const cx = minX + dataW / 2;
        const cy = minY + dataH / 2;
        
        const x = width / 2 - cx * k * minDimension;
        const y = height / 2 - cy * k * minDimension;
        
        plot.getController().setTransform(k, x, y);
    }
}

function zoomAtPoint(plot: any, mouseX: number, mouseY: number, scaleFactor: number) {
    const transform = plot.getTransform();
    const canvas = document.getElementById('container')?.querySelector('canvas');
    if (!canvas) return;
    
    // Calculate the point in data space before zoom
    const dataPoint = plot.screenToData(mouseX, mouseY);
    
    // Apply new scale
    const newK = transform.k * scaleFactor;
    
    // Calculate where that data point should be after zoom to keep it under the cursor
    const { width, height } = canvas;
    const baseScale = Math.min(width, height);
    const dpr = window.devicePixelRatio;
    
    // Target screen position (where we want the data point to stay)
    const targetScreenX = mouseX * dpr;
    const targetScreenY = mouseY * dpr;
    
    // Calculate new transform to keep the point at the same screen position
    const newTx = targetScreenX - dataPoint.x * newK * baseScale;
    const newTy = targetScreenY - dataPoint.y * newK * baseScale;
    
    // Convert back to CSS pixels
    const newX = newTx / dpr;
    const newY = newTy / dpr;
    
    plot.getController().setTransform(newK, newX, newY);
}

function setupRegionSelection(plot: any) {
    const selectModeToggle = document.getElementById('select-mode-toggle');
    const container = document.getElementById('container');
    const canvas = container?.querySelector('canvas');
    const selectionRectangle = document.getElementById('selection-rectangle');
    const actionPanel = document.getElementById('action-panel');
    
    if (!selectModeToggle || !canvas || !selectionRectangle || !actionPanel) {
        console.error('Required elements not found for region selection');
        return;
    }

    // Toggle selection mode when button is clicked
    selectModeToggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        selectionModeActive = !selectionModeActive;
        
        // Update button active state
        if (selectionModeActive) {
            selectModeToggle.classList.add('active');
        } else {
            selectModeToggle.classList.remove('active');
            // Clear any active selections when disabling
            clearSelection();
        }
        
        // Update cursor
        canvas.style.cursor = selectionModeActive ? 'crosshair' : 'default';
    });

    // Mouse event handlers for drawing selection rectangle
    canvas.addEventListener('mousedown', (e: MouseEvent) => {
        if (!selectionModeActive) return;
        
        e.stopPropagation();
        e.preventDefault();
        isDrawing = true;
        hasDragged = false;
        
        const rect = canvas.getBoundingClientRect();
        startX = e.clientX - rect.left;
        startY = e.clientY - rect.top;
    }, true);

    canvas.addEventListener('mousemove', (e: MouseEvent) => {
        if (!isDrawing) return;
        
        e.stopPropagation();
        e.preventDefault();
        
        const rect = canvas.getBoundingClientRect();
        endX = e.clientX - rect.left;
        endY = e.clientY - rect.top;

        const deltaX = Math.abs(endX - startX);
        const deltaY = Math.abs(endY - startY);
        
        if (!hasDragged && (deltaX > 5 || deltaY > 5)) {
            hasDragged = true;
            selectionRectangle.style.display = 'block';
        }

        if (hasDragged) {
            const left = Math.min(startX, endX);
            const top = Math.min(startY, endY);
            const width = Math.abs(endX - startX);
            const height = Math.abs(endY - startY);
            
            // Position relative to the viewport, not the canvas
            selectionRectangle.style.left = `${left}px`;
            selectionRectangle.style.top = `${top}px`;
            selectionRectangle.style.width = `${width}px`;
            selectionRectangle.style.height = `${height}px`;
        }
    });

    canvas.addEventListener('mouseup', async (e: MouseEvent) => {
        if (!isDrawing) return;
        
        e.stopPropagation();
        e.preventDefault();
        isDrawing = false;
        
        if (!hasDragged) {
            clearSelection();
            return;
        }
        
        hasActiveSelection = true;
        setTimeout(() => { hasDragged = false; }, 100);

        // console.log('=== SELECTION DEBUG ===');
        // console.log('Screen coordinates:', { startX, startY, endX, endY });
        
        // Convert screen coordinates to data coordinates
        const topLeft = plot.screenToData(Math.min(startX, endX), Math.min(startY, endY));
        const bottomRight = plot.screenToData(Math.max(startX, endX), Math.max(startY, endY));
        
        // console.log('Data coordinates:', { topLeft, bottomRight });
        
        const xMin = Math.min(topLeft.x, bottomRight.x);
        const xMax = Math.max(topLeft.x, bottomRight.x);
        const yMin = Math.min(topLeft.y, bottomRight.y);
        const yMax = Math.max(topLeft.y, bottomRight.y);

        selectionDataBounds = { xMin, xMax, yMin, yMax };
        
        // console.log('Selection bounds:', selectionDataBounds);
        // console.log('Current transform:', plot.getTransform());
        
        // Get selected points from tiles
        await extractSelectionData(plot, xMin, xMax, yMin, yMax);
        
        // Show action panel
        showActionPanel();
        
        // Setup transform listener to update rectangle position
        setupRectangleTracking(plot);
    });

    // Setup action panel controls
    setupActionPanel(plot);
}

async function extractSelectionData(plot: any, xMin: number, xMax: number, yMin: number, yMax: number) {
    try {
        const tileStore = plot.getTileStore();
        const allTiles = tileStore.getAllTiles();
        const selectedPoints: any[] = [];
        
        // console.log(`Extracting data from ${allTiles.length} tiles`);
        // console.log(`Selection bounds: x=[${xMin}, ${xMax}], y=[${yMin}, ${yMax}]`);
        
        for (const tile of allTiles) {
            if (!tile.data) {
                // console.log(`Tile ${tile.key} has no data`);
                continue;
            }
            
            const xCol = tile.data.getChild('x');
            const yCol = tile.data.getChild('y');
            
            if (!xCol || !yCol) {
                // console.log(`Tile ${tile.key} missing x or y column`);
                continue;
            }
            
            const numRows = tile.data.numRows;
            // console.log(`Tile ${tile.key} has ${numRows} rows`);
            
            // Sample first few points to see their coordinates
            // if (numRows > 0) {
            //     const sampleSize = Math.min(3, numRows);
            //     console.log(`Sample points from tile ${tile.key}:`);
            //     for (let i = 0; i < sampleSize; i++) {
            //         console.log(`  Point ${i}: x=${xCol.get(i)}, y=${yCol.get(i)}`);
            //     }
            // }
            
            let tileMatches = 0;
            for (let i = 0; i < numRows; i++) {
                const x = xCol.get(i);
                const y = yCol.get(i);
                
                if (x >= xMin && x <= xMax && y >= yMin && y <= yMax) {
                    tileMatches++;
                    // Extract all fields for this point
                    const row = tile.data.get(i);
                    if (row) {
                        selectedPoints.push(row.toJSON());
                    }
                }
            }
            // console.log(`Tile ${tile.key}: ${tileMatches} points matched selection`);
        }
        
        currentSelectionData = selectedPoints;
        // console.log(`Selected ${selectedPoints.length} points`);
        
        // Update selection count
        const selectionCount = document.getElementById('selection-count');
        if (selectionCount) {
            selectionCount.textContent = selectedPoints.length.toLocaleString();
        }
    } catch (error) {
        console.error('Error extracting selection data:', error);
    }
}

function setupActionPanel(plot: any) {
    const actionPanel = document.getElementById('action-panel');
    const closeButton = actionPanel?.querySelector('.panel-close-button');
    const collapseButton = actionPanel?.querySelector('.panel-collapse-button');
    const exportButton = document.getElementById('export-csv-button');
    const columnSelector = document.getElementById('column-selector') as HTMLSelectElement;
    
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            clearSelection();
            // Toggle off selection mode when closing the panel
            selectionModeActive = false;
            const selectModeToggle = document.getElementById('select-mode-toggle');
            const canvas = document.getElementById('container')?.querySelector('canvas');
            
            if (selectModeToggle) {
                selectModeToggle.classList.remove('active');
            }
            if (canvas) {
                canvas.style.cursor = 'default';
            }
        });
    }
    
    if (collapseButton) {
        collapseButton.addEventListener('click', () => {
            actionPanel?.classList.toggle('collapsed');
            collapseButton.textContent = actionPanel?.classList.contains('collapsed') ? '+' : '−';
        });
    }
    
    if (exportButton) {
        exportButton.addEventListener('click', () => {
            exportToCSV(columnSelector?.value || '');
        });
    }
    
    if (columnSelector) {
        columnSelector.addEventListener('change', () => {
            if (currentSelectionData && currentSelectionData.length > 0) {
                renderChart(columnSelector.value);
            }
        });
    }

    // Setup panel resize
    const resizeHandle = actionPanel?.querySelector('.panel-resize-handle') as HTMLElement;
    if (resizeHandle && actionPanel) {
        let isResizing = false;
        let startY = 0;
        let startHeight = 0;
        
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
            const newHeight = Math.min(Math.max(startHeight + deltaY, 150), window.innerHeight * 0.8);
            actionPanel.style.height = `${newHeight}px`;
        });
        
        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    }
}

function showActionPanel() {
    const actionPanel = document.getElementById('action-panel');
    const columnSelector = document.getElementById('column-selector') as HTMLSelectElement;
    
    if (!actionPanel || !columnSelector) {
        console.log('Action panel or selectors not found');
        return;
    }
    
    // Populate column selector with available fields
    if (currentSelectionData && currentSelectionData.length > 0) {
        const fields = Object.keys(currentSelectionData[0]).filter(k => k !== 'x' && k !== 'y');
        // console.log('Available fields:', fields);
        columnSelector.innerHTML = '';
        
        if (fields.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No columns available';
            columnSelector.appendChild(option);
        } else {
            // Determine default column using centralized logic
            let defaultField = lastColumn && fields.includes(lastColumn) ? lastColumn : null;
            
            // If no last column, use the centralized default selection from DataLoader
            if (!defaultField) {
                // @ts-ignore
                const plot = window.plot;
                if (plot && plot.dataLoader) {
                    // Build Column objects from fields for the heuristic
                    const fieldColumns = fields.map(f => {
                        const sampleValue = currentSelectionData![0][f];
                        const isNumeric = typeof sampleValue === 'number';
                        // Only mark as categorical if it's a string/non-numeric AND has reasonable cardinality
                        const uniqueValues = new Set(currentSelectionData!.map(d => d[f]));
                        const isCategorical = !isNumeric && uniqueValues.size > 1 && uniqueValues.size < currentSelectionData!.length * 0.5;
                        return {
                            name: f,
                            numeric: isNumeric,
                            categorical: isCategorical
                        };
                    });
                    
                    // Use the centralized selectDefaultColumn method
                    defaultField = plot.dataLoader.selectDefaultColumn(fieldColumns);
                }
            }
            
            // Fallback to first field if still no default
            if (!defaultField) {
                defaultField = fields[0];
            }
            
            fields.forEach(field => {
                const option = document.createElement('option');
                option.value = field;
                option.textContent = field;
                option.selected = field === defaultField;
                columnSelector.appendChild(option);
            });
            
            columnSelector.value = defaultField;
        }
        
    } else {
        console.warn('No selection data available');
        columnSelector.innerHTML = '<option>No data selected</option>';
    }
    
    actionPanel.classList.add('open');
    actionPanel.classList.remove('collapsed');
    
    // Auto-render chart with the selected column
    if (currentSelectionData && currentSelectionData.length > 0 && columnSelector.value) {
        setTimeout(() => renderChart(columnSelector.value), 100);
    }
}

function clearSelection() {
    const selectionRectangle = document.getElementById('selection-rectangle');
    const actionPanel = document.getElementById('action-panel');
    
    if (selectionRectangle) {
        selectionRectangle.style.display = 'none';
    }
    
    if (actionPanel) {
        actionPanel.classList.remove('open');
    }
    
    hasActiveSelection = false;
    selectionDataBounds = null;
    currentSelectionData = null;
}

function updateSelectionRectanglePosition(plot: any) {
    if (!hasActiveSelection || !selectionDataBounds) return;
    
    const selectionRectangle = document.getElementById('selection-rectangle');
    const canvas = document.getElementById('container')?.querySelector('canvas');
    
    if (!selectionRectangle || !canvas) return;
    
    try {
        // Convert data bounds to screen coordinates
        const topLeft = dataToScreen(plot, selectionDataBounds.xMin, selectionDataBounds.yMin);
        const bottomRight = dataToScreen(plot, selectionDataBounds.xMax, selectionDataBounds.yMax);
        
        const left = Math.min(topLeft.x, bottomRight.x);
        const top = Math.min(topLeft.y, bottomRight.y);
        const width = Math.abs(bottomRight.x - topLeft.x);
        const height = Math.abs(bottomRight.y - topLeft.y);
        
        if (width > 0 && height > 0) {
            selectionRectangle.style.left = `${left}px`;
            selectionRectangle.style.top = `${top}px`;
            selectionRectangle.style.width = `${width}px`;
            selectionRectangle.style.height = `${height}px`;
            selectionRectangle.style.display = 'block';
        } else {
            selectionRectangle.style.display = 'none';
        }
    } catch (error) {
        console.error('Error updating rectangle position:', error);
    }
}

function dataToScreen(plot: any, dataX: number, dataY: number): { x: number; y: number } {
    const canvas = document.getElementById('container')?.querySelector('canvas');
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    const { width, height } = canvas;
    const baseScale = Math.min(width, height);
    const dpr = window.devicePixelRatio;
    const transform = plot.getTransform();
    
    // Apply transform
    const tx = transform.x * dpr;
    const ty = transform.y * dpr;
    const k = transform.k * baseScale;
    
    const screenX = dataX * k + tx;
    const screenY = dataY * k + ty;
    
    // Convert from physical pixels to CSS pixels
    return {
        x: screenX / dpr,
        y: screenY / dpr
    };
}

function setupRectangleTracking(plot: any) {
    // Update rectangle on every render
    const originalRender = plot.render.bind(plot);
    plot.render = function(...args: any[]) {
        const result = originalRender(...args);
        updateSelectionRectanglePosition(plot);
        return result;
    };
}

async function renderChart(column: string) {
    // Save last used column
    lastColumn = column;
    
    const chartContainer = document.getElementById('chart-container');
    if (!chartContainer || !currentSelectionData) return;
    
    chartContainer.innerHTML = '';
    
    // Calculate available width (subtract padding and margins)
    const containerWidth = chartContainer.clientWidth - 40; // Account for padding
    
    // Detect dark mode
    const appContainer = document.getElementById('app-container');
    const isDarkMode = appContainer?.classList.contains('dark-mode');
    
    // Determine if column is numeric
    const sampleValue = currentSelectionData[0][column];
    const isNumeric = typeof sampleValue === 'number';
    
    // Dark mode configuration
    const config = isDarkMode ? {
        background: '#333',
        title: { color: '#fff' },
        style: {
            'guide-label': { fill: '#fff' },
            'guide-title': { fill: '#fff' }
        },
        axis: {
            domainColor: '#fff',
            gridColor: '#555',
            tickColor: '#fff',
            labelColor: '#fff',
            titleColor: '#fff'
        }
    } : {};
    
    let spec: any;
    
    if (isNumeric) {
        // Histogram for numeric data
        spec = {
            $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
            data: { values: currentSelectionData },
            mark: 'bar',
            encoding: {
                x: {
                    bin: { maxbins: 30 },
                    field: column,
                    title: column,
                    axis: {
                        labelAngle: -45,
                        labelLimit: 100
                    }
                },
                y: {
                    aggregate: 'count',
                    title: 'Count'
                },
                tooltip: [
                    { bin: true, field: column, title: column },
                    { aggregate: 'count', title: 'Count' }
                ]
            },
            width: containerWidth,
            height: 300,
            autosize: {
                type: 'fit',
                contains: 'padding'
            }
        };
    } else {
        // Bar chart for categorical data
        // Aggregate on original values
        const valueCounts = currentSelectionData.reduce((acc: any, item: any) => {
            const val = String(item[column]);
            acc[val] = (acc[val] || 0) + 1;
            return acc;
        }, {});
        
        // Sort and take top 20, keep original values
        const chartData = Object.entries(valueCounts)
            .sort((a: any, b: any) => b[1] - a[1]) // Sort by count
            .slice(0, 20) // Limit to top 20
            .map(([value, count]) => ({
                [column]: value,
                count
            }));
        
        spec = {
            $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
            data: { values: chartData },
            mark: 'bar',
            encoding: {
                x: {
                    field: column,
                    type: 'nominal',
                    title: column,
                    sort: '-y',
                    axis: {
                        labelAngle: -45,
                        labelLimit: 100,
                        labelExpr: `length(datum.label) > 10 ? substring(datum.label, 0, 10) + '...' : datum.label`
                    }
                },
                y: {
                    field: 'count',
                    type: 'quantitative',
                    title: 'Count'
                },
                tooltip: [
                    { field: column, title: column },
                    { field: 'count', title: 'Count' }
                ]
            },
            width: containerWidth,
            height: 300,
            autosize: {
                type: 'fit',
                contains: 'padding'
            }
        };
    }
    
    try {
        await embed(chartContainer, spec, {
            actions: false,
            config: config
        });
    } catch (error) {
        console.error('Error rendering chart:', error);
        chartContainer.innerHTML = '<p style="color: red;">Error rendering chart</p>';
    }
}

function exportToCSV(column: string) {
    if (!currentSelectionData) return;
    
    // Get all columns
    const columns = Object.keys(currentSelectionData[0]);
    
    // Create CSV content
    const csvContent = [
        columns.join(','),
        ...currentSelectionData.map(row => 
            columns.map(col => {
                const val = row[col];
                // Escape values containing commas or quotes
                if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
                    return `"${val.replace(/"/g, '""')}"`;
                }
                return val;
            }).join(',')
        )
    ].join('\n');
    
    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `selection_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

init();
