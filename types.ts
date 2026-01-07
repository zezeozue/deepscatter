// Type definitions for main application

import type { Scatterplot } from './src/deepscatter';

// Filter types
export interface FilterInfo {
  type: 'numeric' | 'categorical';
  value: NumericFilterValue | string;
  displayText: string;
}

export interface NumericFilterValue {
  minValue: number | null;
  maxValue: number | null;
}

// Selection types
export interface SelectionBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

// Column metadata
export interface ColumnInfo {
  name: string;
  numeric: boolean;
  display: boolean;
}

// Application state
export interface AppState {
  scatterplot: Scatterplot;
  currentScatterplot: Scatterplot;
  tooltipLocked: boolean;
  selectedIx: number | null;
  numericColumns: Set<string>;
  activeFilters: Map<string, FilterInfo>;
  selectionModeActive: boolean;
  hasActiveSelection: boolean;
  selectionDataBounds: SelectionBounds | null;
  justResized: boolean;
  lastAction: string | null;
  lastColumn: string | null;
  currentSelectionData: any[] | null;
  tilesConfig: TilesConfig | null;
}

// Tiles configuration
export interface TilesConfig {
  columns: ColumnInfo[];
}

// Data range for color encoding
export interface DataRange {
  min: number;
  max: number;
}

// Worker message types (matching parser_worker.ts)
export interface WorkerProgressMessage {
  type: 'progress';
  progress: number;
  text: string;
}

export interface WorkerCompleteMessage {
  type: 'complete';
  data: ParsedData;
}

export interface WorkerWarningMessage {
  type: 'warning';
  message: string;
  details?: any[];
}

export interface WorkerErrorMessage {
  type: 'error';
  message: string;
}

export type WorkerMessage =
  | WorkerProgressMessage
  | WorkerCompleteMessage
  | WorkerWarningMessage
  | WorkerErrorMessage;

// Parsed data structure
export interface ParsedRow {
  ix: number;
  [key: string]: string | number | null;
}

export interface ParsedData extends Array<ParsedRow> {
  columns: string[];
}

// UI element references
export interface UIElements {
  detailPanel: HTMLElement;
  detailContent: HTMLElement;
  bottomPanel: HTMLElement;
  bottomPanelContent: HTMLElement;
  colorColumnSelector: HTMLSelectElement;
  legend: HTMLElement;
  filterContainer: HTMLElement;
  filterColumnSelector: HTMLSelectElement;
  filterValueContainer: HTMLElement;
  filterChipsContainer: HTMLElement;
}

// Event handler types
export type ClickHandler = (datum: any, plot: Scatterplot, ev: MouseEvent) => void;
export type TooltipHandler = (datum: any, plot: Scatterplot | undefined) => string;
