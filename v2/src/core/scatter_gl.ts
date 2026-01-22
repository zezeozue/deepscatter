import { Renderer } from '../rendering/renderer';
import { RenderSpec } from '../types';
import { TileStore } from '../data/tile_store';
import { Controller, Transform } from '../interaction/controller';
import { BBox, Tile } from '../data/tile';
import { ColorManager, ColorScale } from '../aesthetics/color_manager';
import { FilterManager } from '../aesthetics/filter_manager';
import { DataLoader, Column } from '../data/data_loader';
import { UIManager } from '../ui/ui_manager';

interface PointSelection {
  tileKey: string;
  index: number;
}

/**
 * ScatterGL: Main coordination class for the scatter plot visualization
 * Delegates to specialized managers for data, UI, colors, and filters
 */
export class ScatterGL {
  // --- Core Components ---
  private container: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private renderer!: Renderer;
  private tileStore!: TileStore;
  private controller!: Controller;
  
  // --- Managers ---
  public dataLoader = new DataLoader();
  private uiManager = new UIManager();
  public colorManager = new ColorManager();
  public filterManager = new FilterManager();
  
  // --- Transform State ---
  private transform: Transform = { k: 1, x: 0, y: 0 };
  private baseK: number = 1.0;
  
  // --- Render State ---
  // private _spec: RenderSpec = { x: 'x', y: 'y' };
  private specVersion: number = 0;
  private currentColorScale: ColorScale | null = null;
  
  // --- Selection State ---
  private hoveredPoint: PointSelection | null = null;
  private lockedPoint: PointSelection | null = null;
  
  // --- Data State ---
  private columns: Column[] = [];
  private dataExtent: { minX: number; maxX: number; minY: number; maxY: number } | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.setupCanvas();
    this.setupManagers();
    this.setupInteraction();
    this.resize();
    
    window.addEventListener('resize', () => this.resize());
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  private setupCanvas(): void {
    this.container.style.position = 'relative';
    
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.container.appendChild(this.canvas);
    
    this.renderer = new Renderer(this.canvas);
  }

  private setupManagers(): void {
    this.tileStore = new TileStore();
    this.tileStore.onTileLoad = () => this.render();
  }

  private setupInteraction(): void {
    this.controller = new Controller(
      this.canvas,
      (t) => this.handleTransformUpdate(t),
      (x, y) => this.handleHover(x, y),
      (x, y) => this.handleClick(x, y)
    );
  }

  private resize(): void {
    this.uiManager.resizeCanvas(this.canvas, this.container);
    this.renderer.resize(this.canvas.width, this.canvas.height);
    this.updateViewport();
    this.render();
  }

  // ============================================================================
  // INTERACTION HANDLERS
  // ============================================================================

  private handleTransformUpdate(transform: Transform): void {
    this.transform = transform;
    this.updateViewport();
    this.render();
  }

  private handleHover(x: number, y: number): void {
    if (this.lockedPoint !== null) return;
    
    const result = this.pick(x, y);
    
    if (typeof result !== 'number') {
      const { tile, index } = result;
      
      if (this.isPointFiltered(tile, index)) {
        // console.log('[ScatterGL] Point is filtered, clearing hover');
        this.clearHover();
        return;
      }
      
      if (this.shouldUpdateHover(tile.key, index)) {
        // console.log('[ScatterGL] Hovering over point:', tile.key, index);
        this.hoveredPoint = { tileKey: tile.key, index };
        this.updatePointInfo(result);
      }
    } else {
      this.clearHover();
    }
  }

  private handleClick(x: number, y: number): void {
    const result = this.pick(x, y);
    
    if (typeof result !== 'number') {
      const { tile, index } = result;
      
      if (this.isPointFiltered(tile, index)) return;
      
      this.lockedPoint = { tileKey: tile.key, index };
      this.updatePointInfo(result);
      this.setHighlightFromTile(tile, index);
    } else {
      this.clearSelection();
    }
    
    this.render();
  }

  private pick(x: number, y: number): number | { tile: Tile; index: number } {
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

  // --- Interaction Helpers ---

  private isPointFiltered(tile: Tile, index: number): boolean {
    if (!this.filterManager.hasFilters()) return false;
    const mask = this.filterManager.applyToTile(tile);
    return mask[index] === 0;
  }

  private shouldUpdateHover(tileKey: string, index: number): boolean {
    return !this.hoveredPoint || 
           this.hoveredPoint.tileKey !== tileKey || 
           this.hoveredPoint.index !== index;
  }

  private clearHover(): void {
    if (this.hoveredPoint) {
      // console.log('[ScatterGL] Clearing hover');
      this.hoveredPoint = null;
      this.uiManager.renderPointInfo(null);
    }
  }

  private clearSelection(): void {
    this.lockedPoint = null;
    this.uiManager.renderPointInfo(null);
    this.renderer.setHighlight(null, null);
  }

  private setHighlightFromTile(tile: Tile, index: number): void {
    if (!tile.data) return;
    const row = tile.data.get(index);
    if (row) {
      this.renderer.setHighlight(row.x, row.y);
    }
  }

  private updatePointInfo(result: { tile: Tile; index: number }): void {
    if (!result.tile.data) {
      // console.warn('[ScatterGL] Tile has no data');
      this.uiManager.renderPointInfo(null);
      return;
    }

    const row = result.tile.data.get(result.index);
    if (!row) {
      // console.warn('[ScatterGL] Could not get row data');
      this.uiManager.renderPointInfo(null);
      return;
    }

    // Transform normalized coordinates back to original values for display
    const data = row.toJSON();
    if (this.dataExtent) {
      const xRange = this.dataExtent.maxX - this.dataExtent.minX;
      const yRange = this.dataExtent.maxY - this.dataExtent.minY;
      
      // Reverse normalization: original = normalized * range + min
      // For y, also reverse the inversion: normalized_y = 1 - ((original - min) / range)
      // So: original_y = min + (1 - normalized_y) * range
      data.x = data.x * xRange + this.dataExtent.minX;
      data.y = this.dataExtent.minY + (1 - data.y) * yRange;
    }

    // console.log('[ScatterGL] Updating point info with data');
    this.uiManager.renderPointInfo(data);
  }

  // ============================================================================
  // DATA LOADING
  // ============================================================================

  public async load(url: string): Promise<void> {
    const { columns, extent } = await this.dataLoader.loadFromUrl(url, this.tileStore);
    
    this.columns = columns;
    this.dataExtent = extent;
    this.renderUIControls();
    
    // Data is normalized to [0, 1], so fit to normalized extent
    this.fitToExtent(0, 1, 0, 1);
  }

  public loadData(data: any[], xField: string, yField: string, defaultColumn?: string | null): void {
    console.log('loadData called with:', { data, xField, yField, defaultColumn });
    
    this.renderer.clear();
    const { columns, extent } = this.dataLoader.loadFromArray(data, xField, yField, this.tileStore);
    
    this.columns = columns;
    this.dataExtent = extent;
    
    // Set the user-specified default column if provided and valid
    if (defaultColumn) {
      const col = columns.find(c => c.name === defaultColumn);
      if (col && (col.numeric || col.categorical)) {
        // Store it in the dataLoader so it takes precedence over heuristics
        (this.dataLoader as any).defaultColumn = defaultColumn;
        console.log('Using user-specified default column:', defaultColumn);
      } else {
        console.warn('Invalid default column specified:', defaultColumn);
      }
    }
    
    this.renderUIControls();
    // Data is normalized to [0, 1], so fit to normalized extent
    this.fitToExtent(0, 1, 0, 1);
  }

  // ============================================================================
  // UI CONTROLS
  // ============================================================================

  private renderUIControls(): void {
    // console.log('[ScatterGL] Rendering UI controls with', this.columns.length, 'columns');
    // Use centralized default column selection from DataLoader
    const selectedDefault = this.dataLoader.selectDefaultColumn(this.columns);
    this.uiManager.setSelectedDefault(selectedDefault);
    
    // Get active filter fields
    const activeFilters = new Set(this.filterManager.getFilters().keys());
    
    this.uiManager.renderAllControls(
      this.columns,
      (field) => this.applyColorEncoding(field),
      () => this.updateFilterControls(),
      activeFilters
    );
  }

  // ============================================================================
  // COLOR ENCODING
  // ============================================================================

  public applyColorEncoding(field: string): void {
    const column = this.columns.find(c => c.name === field);
    if (!column) return;

    const metadata = this.dataLoader.getColumnMetadata(field);
    this.currentColorScale = this.colorManager.applyColorEncoding(
      field,
      column,
      metadata,
      this.tileStore
    );

    this.specVersion++;
    this.render();
  }

  // ============================================================================
  // FILTERING
  // ============================================================================

  private updateFilterControls(): void {
    // Render filter chips
    this.uiManager.renderFilterChips(
      this.filterManager,
      (field) => this.removeFilter(field)
    );
    
    this.uiManager.updateFilterControls(
      this.columns,
      this.tileStore.getTiles(),
      this.filterManager,
      () => this.applyFilters()
    );
  }

  private removeFilter(field: string): void {
    this.filterManager.removeFilter(field);
    
    // If the removed filter is currently selected in the dropdown, switch to first column
    const filterSelector = document.getElementById('filter-by-selector') as HTMLSelectElement;
    if (filterSelector && filterSelector.value === field) {
      // Switch to the first column
      if (this.columns.length > 0) {
        filterSelector.value = this.columns[0].name;
      }
      // Clear the filter controls
      const filterControls = document.getElementById('filter-controls');
      if (filterControls) {
        filterControls.innerHTML = '';
      }
    }
    
    this.applyFilters();
    // Re-render chips and controls to keep everything in sync
    this.updateFilterControls();
    // Also re-render the filter selector to update the checkmarks
    const activeFilters = new Set(this.filterManager.getFilters().keys());
    this.uiManager.renderFilterSelector(
      this.columns,
      () => this.updateFilterControls(),
      activeFilters
    );
  }

  private applyFilters(): void {
    this.specVersion++;
    this.render();
    // Update the filter selector to show current active filters
    const activeFilters = new Set(this.filterManager.getFilters().keys());
    this.uiManager.renderFilterSelector(
      this.columns,
      () => this.updateFilterControls(),
      activeFilters
    );
  }

  // ============================================================================
  // VIEWPORT & FITTING
  // ============================================================================

  private updateViewport(): void {
    const { width, height } = this.canvas;
    const { k, x, y } = this.transform;
    const dpr = window.devicePixelRatio;
    
    const baseScale = Math.min(width, height);
    const effectiveK = k * baseScale;
    
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
    
    // console.log('Update Viewport:', viewport);
    this.tileStore.update(viewport);
  }

  private fitToExtent(minX: number, maxX: number, minY: number, maxY: number): void {
    const dataW = maxX - minX;
    const dataH = maxY - minY;
    
    if (dataW <= 0 || dataH <= 0) return;

    const { width, height } = this.canvas.getBoundingClientRect();
    const minDimension = Math.min(width, height);
    
    const kx = width / (dataW * minDimension);
    const ky = height / (dataH * minDimension);
    const k = Math.min(kx, ky) * 0.9;
    
    this.baseK = k;

    const cx = minX + dataW / 2;
    const cy = minY + dataH / 2;
    
    const x = width / 2 - cx * k * minDimension;
    const y = height / 2 - cy * k * minDimension;
    
    this.controller.setTransform(k, x, y);
  }

  // ============================================================================
  // RENDERING
  // ============================================================================

  public render(spec?: RenderSpec): void {
    if (spec) {
      // this.spec = spec;
      this.specVersion++;
    }

    const tiles = this.tileStore.getTiles();
    
    for (const tile of tiles) {
      const initialized = this.renderer.isTileInitialized(tile);
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

  private updateTileVisuals(tile: Tile): void {
    if (!tile.data) return;
    
    const visibleIndices = this.filterManager.hasFilters()
      ? this.getVisibleIndices(tile)
      : null;
    
    const colors = this.colorManager.computeTileColors(
      tile,
      this.currentColorScale,
      visibleIndices
    );

    this.renderer.updateAesthetics(tile, colors);
    tile.visualsVersion = this.specVersion;
  }

  private getVisibleIndices(tile: Tile): number[] {
    const mask = this.filterManager.applyToTile(tile);
    const visibleIndices: number[] = [];
    const count = tile.data!.numRows;
    
    for (let i = 0; i < count; i++) {
      if (mask[i] === 1) {
        visibleIndices.push(i);
      }
    }
    
    return visibleIndices;
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Convert screen coordinates to data coordinates
   */
  public screenToData(screenX: number, screenY: number): { x: number; y: number } {
    // const rect = this.canvas.getBoundingClientRect();
    const { width, height } = this.canvas;
    const baseScale = Math.min(width, height);
    const dpr = window.devicePixelRatio;
    
    const physicalX = screenX * dpr;
    const physicalY = screenY * dpr;
    
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
