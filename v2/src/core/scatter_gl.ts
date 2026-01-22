import { Renderer } from '../rendering/renderer';
import { RenderSpec } from '../types';
import { TileStore } from '../data/tile_store';
import { Controller, Transform } from '../interaction/controller';
import { BBox, Tile } from '../data/tile';
import { colorScale, Scale } from '../aesthetics/scales';
import { Table, Vector, makeVector, Float32, Utf8, vectorFromArray } from 'apache-arrow';
import { ColorManager, ColorScale } from '../aesthetics/color_manager';
import { FilterManager } from '../aesthetics/filter_manager';

export class ScatterGL {
  private container: HTMLElement;
  private renderer: Renderer;
  private canvas: HTMLCanvasElement;
  private tileStore: TileStore;
  private controller: Controller;
  private transform: Transform = { k: 1, x: 0, y: 0 };
  private renderId: number | null = null;
  
  private spec: RenderSpec = { x: 'x', y: 'y' };
  private specVersion: number = 0;
  private hoveredPoint: {tileKey: string, index: number} | null = null;
  private lockedPoint: {tileKey: string, index: number} | null = null;
  private baseK: number = 1.0;
  private columns: {name: string, numeric: boolean, categorical?: boolean, min?: number, max?: number}[] = [];
  private columnMetadata: Map<string, {min?: number, max?: number, categories?: string[], num_categories?: number}> = new Map();
  
  public colorManager: ColorManager = new ColorManager();
  public filterManager: FilterManager = new FilterManager();
  private currentColorScale: ColorScale | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.style.position = 'relative';

    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.container.appendChild(this.canvas);
    
    // Initialize components
    this.renderer = new Renderer(this.canvas);
    this.tileStore = new TileStore();
    this.tileStore.onTileLoad = () => this.scheduleRender();

    // Initial resize
    this.resize();

    this.controller = new Controller(
      this.canvas,
      (t) => { // onUpdate
        this.transform = t;
        this.updateViewport();
        this.render();
      },
      (x, y) => { // onHover
        if (this.lockedPoint !== null) return;
        const result = this.pick(x, y);
        
        if (typeof result !== 'number') {
          const { tile, index } = result;
          
          // Check if this point is filtered out
          if (this.filterManager.hasFilters()) {
            const mask = this.filterManager.applyToTile(tile);
            if (mask[index] === 0) {
              // Point is filtered out, don't show tooltip
              if (this.hoveredPoint !== null) {
                this.hoveredPoint = null;
                this.showInNavBar(-1);
              }
              return;
            }
          }
          
          if (!this.hoveredPoint || this.hoveredPoint.tileKey !== tile.key || this.hoveredPoint.index !== index) {
            this.hoveredPoint = {tileKey: tile.key, index};
            this.showInNavBar(result);
          }
        } else if (this.hoveredPoint !== null) {
          this.hoveredPoint = null;
          this.showInNavBar(-1);
        }
      },
      (x, y) => { // onClick
        const result = this.pick(x, y);
        
        if (typeof result !== 'number') {
          const { tile, index } = result;
          
          // Check if this point is filtered out
          if (this.filterManager.hasFilters()) {
            const mask = this.filterManager.applyToTile(tile);
            if (mask[index] === 0) {
              // Point is filtered out, don't select it
              return;
            }
          }
          
          this.lockedPoint = {tileKey: tile.key, index};
          this.showInNavBar(result);
          
          if (tile.data) {
            const row = tile.data.get(index);
            if (row) {
              this.renderer.setHighlight(row.x, row.y);
            }
          }
        } else {
          this.lockedPoint = null;
          this.showInNavBar(-1);
          this.renderer.setHighlight(null, null);
        }
        this.render();
      }
    );

    window.addEventListener('resize', () => this.resize());
  }

  private pick(x: number, y: number): number | {tile: Tile, index: number} {
    const { width, height } = this.canvas;
    const baseScale = Math.min(width, height);
    const dpr = window.devicePixelRatio;
    const renderTransform = {
      k: this.transform.k * baseScale,
      x: this.transform.x * dpr,
      y: this.transform.y * dpr,
      k_min: this.baseK * baseScale
    };
    
    return this.renderer.pick(x * dpr, y * dpr, this.tileStore.getTiles(), width, height, renderTransform);
  }

  private showInNavBar(result: -1 | {tile: Tile, index: number}) {
    const navbar = document.getElementById('point-data');
    if (!navbar) return;

    if (result === -1) {
        navbar.innerHTML = '';
        return;
    }

    const { tile, index } = result;
    if (!tile.data) return;

    const row = tile.data.get(index);
    if (!row) {
        navbar.innerHTML = '';
        return;
    }

    const data = row.toJSON();
    const html = Object.entries(data).map(([k, v]) => `
      <div class="point-row">
        <span class="point-key">${k}</span>
        <span class="point-value">${v}</span>
      </div>
    `).join('');
    navbar.innerHTML = html;
  }

  private resize() {
    const { width, height } = this.container.getBoundingClientRect();
    this.canvas.width = width * window.devicePixelRatio;
    this.canvas.height = height * window.devicePixelRatio;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    
    if (this.renderer) {
      this.renderer.resize(this.canvas.width, this.canvas.height);
      this.updateViewport();
      this.render();
    }
  }

  private updateViewport() {
      const { width, height } = this.canvas;
      const { k, x, y } = this.transform;
      const dpr = window.devicePixelRatio;
      
      const baseScale = Math.min(width, height);
      const effectiveK = k * baseScale;
      
      // Transform x/y are in CSS pixels, scale to physical
      const tx = x * dpr;
      const ty = y * dpr;
      
      const x0 = (0 - tx) / effectiveK;
      const x1 = (width - tx) / effectiveK;
      const y0 = (0 - ty) / effectiveK;
      const y1 = (height - ty) / effectiveK;
      
      const viewport: BBox = {
          x: [Math.min(x0, x1), Math.max(x0, x1)],
          y: [Math.min(y0, y1), Math.max(y0, y1)]
      };
      
      console.log('Update Viewport:', viewport);
      this.tileStore.update(viewport);
  }

  public async load(url: string) {
    // console.log('Loading data from', url);
    await this.tileStore.init(url);
    
    // Load config.json for metadata
    try {
      const configResponse = await fetch(`${url}/config.json`);
      if (configResponse.ok) {
        const config = await configResponse.json();
        console.log('Loaded config.json:', config);
        if (config.columns) {
          // Store metadata for all columns
          for (const col of config.columns) {
            const metadata: any = {};
            
            // Numeric metadata
            if (col.numeric && col.min !== undefined && col.max !== undefined) {
              metadata.min = col.min;
              metadata.max = col.max;
              console.log(`Column ${col.name}: min=${col.min}, max=${col.max}`);
            }
            
            // Categorical metadata
            if (col.categorical) {
              if (col.categories) {
                metadata.categories = col.categories;
              }
              if (col.num_categories !== undefined) {
                metadata.num_categories = col.num_categories;
              }
            }
            
            if (Object.keys(metadata).length > 0) {
              this.columnMetadata.set(col.name, metadata);
            }
          }
          console.log('Loaded column metadata:', this.columnMetadata);
        }
      } else {
        console.warn('config.json not found, will calculate ranges from data');
      }
    } catch (e) {
      console.warn('Could not load config.json, will calculate ranges from data', e);
    }
    
    const root = this.tileStore.getRoot();
    if (root && root.data) {
        this.updateSchema(root.data.schema);
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        const xCol = root.data.getChild('x');
        const yCol = root.data.getChild('y');
        if (xCol && yCol) {
            const count = root.data.numRows;
            // Sample extent from root tile (checking all points is fast for <1M)
            for(let i=0; i<count; i++) {
                const xv = Number(xCol.get(i));
                const yv = Number(yCol.get(i));
                if (xv < minX) minX = xv;
                if (xv > maxX) maxX = xv;
                if (yv < minY) minY = yv;
                if (yv > maxY) maxY = yv;
            }
            this.fitToExtent(minX, maxX, minY, maxY);
        }
    } else {
        this.updateViewport();
        this.render();
    }
  }

  public loadData(data: any[], xField: string, yField: string) {
      console.log('loadData called with:', { data, xField, yField });
      const xData = new Float32Array(data.map(d => parseFloat(d[xField])));
      const yData = new Float32Array(data.map(d => parseFloat(d[yField])));
    const x = makeVector(xData);
    const y = makeVector(yData);
    
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i=0; i<xData.length; i++) {
        const xv = xData[i];
        const yv = yData[i];
        if (xv < minX) minX = xv;
        if (xv > maxX) maxX = xv;
        if (yv < minY) minY = yv;
        if (yv > maxY) maxY = yv;
    }

    const otherCols: {[key: string]: Vector} = Object.keys(data[0]).reduce((acc: {[key: string]: Vector}, key) => {
        if (key !== xField && key !== yField) {
            if (typeof data[0][key] === 'number') {
                const colData = data.map(d => d[key]);
                acc[key] = vectorFromArray(colData, new Float32());
                
                // Calculate and store min/max for numeric columns
                const colMin = Math.min(...colData);
                const colMax = Math.max(...colData);
                this.columnMetadata.set(key, { min: colMin, max: colMax });
            } else {
                // Non-numeric column - treat as categorical
                const colData = data.map(d => String(d[key] ?? ''));
                acc[key] = vectorFromArray(colData, new Utf8());
                
                // Collect unique values for categorical columns
                const uniqueValues = Array.from(new Set(colData));
                this.columnMetadata.set(key, {
                    categories: uniqueValues,
                    num_categories: uniqueValues.length
                });
            }
        }
        return acc;
    }, {});

    // Store x and y metadata
    this.columnMetadata.set('x', { min: minX, max: maxX });
    this.columnMetadata.set('y', { min: minY, max: maxY });

    const table = new Table({ x, y, ...otherCols });
    console.log('Arrow table created:', table);
    this.updateSchema(table.schema);

    this.renderer.clear();
    this.tileStore.fromTable(table, { x: [minX, maxX], y: [minY, maxY] });
    
    this.fitToExtent(minX, maxX, minY, maxY);
  }

  private updateSchema(schema: any) {
    this.columns = schema.fields.map((d: any) => {
        const name = d.name;
        const numeric = d.type.toString().includes('Float');
        // Check if this column has categorical metadata
        const metadata = this.columnMetadata.get(name);
        const categorical = metadata?.categories !== undefined || metadata?.num_categories !== undefined;
        
        return {
            name,
            numeric,
            categorical,
        };
    });

    const colorBy = document.getElementById('color-by-selector') as HTMLSelectElement;
    const filterBy = document.getElementById('filter-by-selector') as HTMLSelectElement;

    if (colorBy) {
        // Remove old event listeners by replacing the element
        const newColorBy = colorBy.cloneNode(false) as HTMLSelectElement;
        colorBy.parentNode?.replaceChild(newColorBy, colorBy);
        
        newColorBy.innerHTML = '';
        this.columns.forEach(c => {
            const option = document.createElement('option');
            option.value = c.name;
            option.textContent = c.name;
            newColorBy.appendChild(option);
        });
        
        newColorBy.addEventListener('change', () => this.applyColorEncoding(newColorBy.value));
        
        // Apply default color encoding if columns exist
        if (this.columns.length > 0) {
            setTimeout(() => this.applyColorEncoding(newColorBy.value), 100);
        }
    }

    if (filterBy) {
        // Remove old event listeners by replacing the element
        const newFilterBy = filterBy.cloneNode(false) as HTMLSelectElement;
        filterBy.parentNode?.replaceChild(newFilterBy, filterBy);
        
        newFilterBy.innerHTML = '';
        this.columns.forEach(c => {
            const option = document.createElement('option');
            option.value = c.name;
            option.textContent = c.name;
            newFilterBy.appendChild(option);
        });
        
        newFilterBy.addEventListener('change', () => this.updateFilterControls());
        
        // Initialize filter controls
        if (this.columns.length > 0) {
            setTimeout(() => this.updateFilterControls(), 100);
        }
    }
  }

  private fitToExtent(minX: number, maxX: number, minY: number, maxY: number) {
      const dataW = maxX - minX;
      const dataH = maxY - minY;
      if (dataW <= 0 || dataH <= 0) return;

      const { width, height } = this.canvas.getBoundingClientRect();
      const minDimension = Math.min(width, height);
      
      const kx = width / (dataW * minDimension);
      const ky = height / (dataH * minDimension);
      let k = Math.min(kx, ky) * 0.9; // 0.9 padding
      
      this.baseK = k;

      const cx = minX + dataW / 2;
      const cy = minY + dataH / 2;
      
      const x = width / 2 - cx * k * minDimension;
      const y = height / 2 - cy * k * minDimension;
      
      this.controller.setTransform(k, x, y);
  }

  public applyColorEncoding(field: string): void {
    const column = this.columns.find(c => c.name === field);
    
    if (!column) return;

    // Only apply color encoding for numeric or categorical columns
    if (column.numeric) {
      const metadata = this.columnMetadata.get(field);
      if (metadata && metadata.min !== undefined && metadata.max !== undefined) {
        // Use metadata for consistent min/max without scanning tiles
        console.log(`Using metadata for ${field}: min=${metadata.min}, max=${metadata.max}`);
        this.currentColorScale = this.colorManager.createNumericScale(field, [], {min: metadata.min, max: metadata.max});
      } else {
        // Fallback: scan root tile to calculate min/max
        console.warn(`No metadata for ${field}, scanning root tile`);
        const root = this.tileStore.getRoot();
        if (root) {
          this.currentColorScale = this.colorManager.createNumericScale(field, [root]);
        }
      }
    } else if (column.categorical) {
      // For categorical, check if we have pre-indexed categories
      const metadata = this.columnMetadata.get(field);
      if (metadata && metadata.categories) {
        // Use pre-indexed categories from metadata
        this.currentColorScale = this.colorManager.createCategoricalScaleFromList(field, metadata.categories);
      } else {
        // Fallback: scan root tile to get unique values (only if marked as categorical)
        const root = this.tileStore.getRoot();
        if (root) {
          this.currentColorScale = this.colorManager.createCategoricalScale(field, [root]);
        }
      }
    } else {
      // String column without categorical flag - don't create a color scale
      console.warn(`Column '${field}' is not numeric or categorical. Skipping color encoding.`);
      this.currentColorScale = null;
      this.colorManager.clearScale();
      
      // Trigger re-render with grey colors
      this.specVersion++;
      this.render();
      return;
    }

    // Trigger re-render with new colors
    this.specVersion++;
    this.render();
  }

  private updateFilterControls() {
    const filterBy = document.getElementById('filter-by-selector') as HTMLSelectElement;
    const filterControls = document.getElementById('filter-controls');
    if (!filterBy || !filterControls) return;

    const selected = this.columns.find(c => c.name === filterBy.value);
    if (!selected) return;

    filterControls.innerHTML = '';

    if (selected.numeric) {
        const tiles = this.tileStore.getTiles();
        const [min, max] = this.filterManager.getNumericRange(selected.name, tiles);
        
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.gap = '5px';
        container.style.marginTop = '10px';
        
        const minInput = document.createElement('input');
        minInput.type = 'number';
        minInput.placeholder = `Min (${min.toFixed(2)})`;
        minInput.step = 'any';
        minInput.style.flex = '1';
        
        const maxInput = document.createElement('input');
        maxInput.type = 'number';
        maxInput.placeholder = `Max (${max.toFixed(2)})`;
        maxInput.step = 'any';
        maxInput.style.flex = '1';

        const applyBtn = document.createElement('button');
        applyBtn.textContent = 'Apply';
        applyBtn.style.marginTop = '5px';
        applyBtn.addEventListener('click', () => {
            const minVal = minInput.value ? parseFloat(minInput.value) : null;
            const maxVal = maxInput.value ? parseFloat(maxInput.value) : null;
            this.filterManager.setNumericFilter(selected.name, minVal, maxVal);
            this.applyFilters();
        });

        container.appendChild(minInput);
        container.appendChild(maxInput);
        filterControls.appendChild(container);
        filterControls.appendChild(applyBtn);
    } else if (selected.categorical) {
        // Categorical column - show dropdown
        const tiles = this.tileStore.getTiles();
        const uniqueValues = this.filterManager.getUniqueValues(selected.name, tiles);
        
        const label = document.createElement('label');
        label.textContent = 'Select Value:';
        label.style.display = 'block';
        label.style.marginTop = '10px';
        label.style.marginBottom = '5px';
        label.style.fontWeight = '600';
        label.style.fontSize = '0.9rem';
        
        const select = document.createElement('select');
        select.style.width = '100%';
        select.style.padding = '0.6rem';
        select.style.marginBottom = '10px';
        
        // Add "All" option
        const allOption = document.createElement('option');
        allOption.value = '__ALL__';
        allOption.textContent = 'All';
        select.appendChild(allOption);
        
        uniqueValues.forEach(val => {
            const option = document.createElement('option');
            option.value = String(val);
            option.textContent = String(val);
            select.appendChild(option);
        });

        select.addEventListener('change', () => {
            if (select.value === '__ALL__') {
                this.filterManager.removeFilter(selected.name);
            } else {
                const selectedSet = new Set([select.value]);
                this.filterManager.setCategoricalFilter(selected.name, selectedSet);
            }
            this.applyFilters();
        });
        
        filterControls.appendChild(label);
        filterControls.appendChild(select);
    } else {
        // String column (not categorical) - show text input for substring search
        const label = document.createElement('label');
        label.textContent = 'Search (substring):';
        label.style.display = 'block';
        label.style.marginTop = '10px';
        label.style.marginBottom = '5px';
        label.style.fontWeight = '600';
        label.style.fontSize = '0.9rem';
        
        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.placeholder = 'Enter text to search...';
        textInput.style.width = '100%';
        textInput.style.padding = '0.6rem';
        textInput.style.marginBottom = '10px';
        textInput.style.boxSizing = 'border-box';

        const applyBtn = document.createElement('button');
        applyBtn.textContent = 'Apply';
        applyBtn.addEventListener('click', () => {
            const searchText = textInput.value.trim();
            if (searchText) {
                this.filterManager.setStringFilter(selected.name, searchText);
                this.applyFilters();
            } else {
                this.filterManager.removeFilter(selected.name);
                this.applyFilters();
            }
        });

        const clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear';
        clearBtn.style.marginLeft = '5px';
        clearBtn.addEventListener('click', () => {
            textInput.value = '';
            this.filterManager.removeFilter(selected.name);
            this.applyFilters();
        });
        
        const btnContainer = document.createElement('div');
        btnContainer.style.display = 'flex';
        btnContainer.style.gap = '5px';
        btnContainer.appendChild(applyBtn);
        btnContainer.appendChild(clearBtn);
        
        filterControls.appendChild(label);
        filterControls.appendChild(textInput);
        filterControls.appendChild(btnContainer);
    }
  }

  private applyFilters() {
      this.specVersion++;
      this.render();
  }

  private scheduleRender() {
      if (this.renderId) return;
      this.renderId = requestAnimationFrame(() => {
          this.render();
          this.renderId = null;
      });
  }

  public render(spec?: RenderSpec) {
    if (spec) {
        this.spec = spec;
        this.specVersion++;
    }

    const tiles = this.tileStore.getTiles();
    
    for (const tile of tiles) {
        let initialized = this.renderer.isTileInitialized(tile);
        if (!initialized) {
            this.renderer.initTile(tile);
        }
        
        if (tile.data && tile.visualsVersion !== this.specVersion) {
            this.updateTileVisuals(tile);
        }
    }
    
    const { width, height } = this.canvas;
    const baseScale = Math.min(width, height);
    const dpr = window.devicePixelRatio;
    
    const renderTransform = {
        k: this.transform.k * baseScale,
        x: this.transform.x * dpr,
        y: this.transform.y * dpr,
        k_min: this.baseK * baseScale
    };

    this.renderer.render(tiles, width, height, renderTransform);
  }

  private updateTileVisuals(tile: Tile) {
      if (!tile.data) return;
      const count = tile.data.numRows;
      
      // Apply filters first to determine which points to show
      let visibleIndices: number[] | null = null;
      if (this.filterManager.hasFilters()) {
          const mask = this.filterManager.applyToTile(tile);
          visibleIndices = [];
          for (let i = 0; i < count; i++) {
              if (mask[i] === 1) {
                  visibleIndices.push(i);
              }
          }
      }
      
      // Apply color encoding only to visible points
      let colors: Float32Array;
      if (this.currentColorScale) {
          colors = this.colorManager.applyToTile(tile, this.currentColorScale);
      } else {
          // No color scale (e.g., string column selected) - use grey
          colors = new Float32Array(count * 3);
          for (let i = 0; i < count; i++) {
              colors[i * 3] = 0.5;
              colors[i * 3 + 1] = 0.5;
              colors[i * 3 + 2] = 0.5;
          }
      }

      // If filtering, create a new colors array with only visible points
      // For now, we'll set filtered points to transparent (0,0,0) and let renderer handle it
      // A better approach would be to modify the renderer to skip filtered points
      if (visibleIndices !== null) {
          const filteredColors = new Float32Array(count * 3);
          for (let i = 0; i < count; i++) {
              if (visibleIndices.includes(i)) {
                  filteredColors[i * 3] = colors[i * 3];
                  filteredColors[i * 3 + 1] = colors[i * 3 + 1];
                  filteredColors[i * 3 + 2] = colors[i * 3 + 2];
              } else {
                  // Set to NaN to signal renderer to skip this point
                  filteredColors[i * 3] = NaN;
                  filteredColors[i * 3 + 1] = NaN;
                  filteredColors[i * 3 + 2] = NaN;
              }
          }
          colors = filteredColors;
      }

      this.renderer.updateAesthetics(tile, colors);
      tile.visualsVersion = this.specVersion;
  }

  /**
   * Convert screen coordinates to data coordinates
   */
  public screenToData(screenX: number, screenY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const { width, height } = this.canvas;
    const baseScale = Math.min(width, height);
    const dpr = window.devicePixelRatio;
    
    // Convert screen coordinates to physical pixels
    const physicalX = screenX * dpr;
    const physicalY = screenY * dpr;
    
    // Apply inverse transform
    const tx = this.transform.x * dpr;
    const ty = this.transform.y * dpr;
    const k = this.transform.k * baseScale;
    
    const dataX = (physicalX - tx) / k;
    const dataY = (physicalY - ty) / k;
    
    return { x: dataX, y: dataY };
  }

  /**
   * Get the current transform
   */
  public getTransform(): Transform {
    return { ...this.transform };
  }

  /**
   * Get the tile store for accessing tiles
   */
  public getTileStore(): TileStore {
    return this.tileStore;
  }

  /**
   * Get the controller for enabling/disabling interaction
   */
  public getController(): Controller {
    return this.controller;
  }
}
