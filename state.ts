// Application state management

import type { Scatterplot } from './src/deepscatter';
import type { FilterInfo, SelectionBounds, TilesConfig } from './types';

/**
 * Global application state
 * Centralized to avoid scattered state management
 */
export class AppState {
  // Scatterplot instances
  scatterplot: Scatterplot;
  currentScatterplot: Scatterplot;

  // UI state
  tooltipLocked: boolean = false;
  selectedIx: number | null = null;
  selectionModeActive: boolean = false;
  hasActiveSelection: boolean = false;
  justResized: boolean = false;

  // Data state
  numericColumns: Set<string> = new Set();
  tilesConfig: TilesConfig | null = null;

  // Filter state
  activeFilters: Map<string, FilterInfo> = new Map();

  // Selection state
  selectionDataBounds: SelectionBounds | null = null;
  currentSelectionData: any[] | null = null;
  lastAction: string | null = null;
  lastColumn: string | null = null;

  constructor(scatterplot: Scatterplot) {
    this.scatterplot = scatterplot;
    this.currentScatterplot = scatterplot;
  }

  /**
   * Clear selection state
   */
  clearSelection(): void {
    this.hasActiveSelection = false;
    this.selectionDataBounds = null;
    this.currentSelectionData = null;
  }

  /**
   * Update selection bounds
   */
  setSelectionBounds(bounds: SelectionBounds): void {
    this.selectionDataBounds = bounds;
    this.hasActiveSelection = true;
  }

  /**
   * Toggle selection mode
   */
  toggleSelectionMode(): void {
    this.selectionModeActive = !this.selectionModeActive;
  }

  /**
   * Add or update a filter
   */
  setFilter(column: string, filterInfo: FilterInfo): void {
    this.activeFilters.set(column, filterInfo);
  }

  /**
   * Remove a filter
   */
  removeFilter(column: string): void {
    this.activeFilters.delete(column);
  }

  /**
   * Clear all filters
   */
  clearFilters(): void {
    this.activeFilters.clear();
  }

  /**
   * Check if a column has an active filter
   */
  hasFilter(column: string): boolean {
    return this.activeFilters.has(column);
  }

  /**
   * Get filter for a column
   */
  getFilter(column: string): FilterInfo | undefined {
    return this.activeFilters.get(column);
  }

  /**
   * Update numeric columns set
   */
  setNumericColumns(columns: Set<string>): void {
    this.numericColumns = columns;
  }

  /**
   * Check if a column is numeric
   */
  isNumericColumn(column: string): boolean {
    return this.numericColumns.has(column);
  }

  /**
   * Update tiles configuration
   */
  setTilesConfig(config: TilesConfig): void {
    this.tilesConfig = config;
  }

  /**
   * Update current scatterplot instance
   */
  setCurrentScatterplot(scatterplot: Scatterplot): void {
    this.currentScatterplot = scatterplot;
  }
}
