// Application constants extracted from main.js

// Default scatterplot preferences
export const DEFAULT_PREFS = {
  max_points: 2000000,
  alpha: 15,
  zoom_balance: 0.3,
  point_size: 2,
  background_color: '#FFFFFF',
} as const;

// Default encoding configuration
export const DEFAULT_ENCODING = {
  x: { field: 'x', transform: 'literal' as const },
  y: { field: 'y', transform: 'literal' as const },
} as const;

// UI timing constants
export const TIMING = {
  CLICK_DELAY: 100,
  RESIZE_DELAY: 100,
  ZOOM_DURATION: 100,
  PAN_DURATION: 50,
  ZOOM_RESTART: 60_000,
  LINK_OPEN_DELAY: 200,
} as const;

// Selection and interaction constants
export const SELECTION = {
  MIN_DRAG_DISTANCE: 5,
  SIZE_RANGE: [2, 10] as [number, number],
} as const;

// Data processing constants
export const DATA_PROCESSING = {
  CHUNK_SIZE: 1000,
  TYPE_DETECTION_SAMPLE_SIZE: 100,
  MAX_CATEGORICAL_VALUES: 100,
} as const;

// Chart dimensions
export const CHART = {
  MIN_HEIGHT: 300,
  CONTAINER_PADDING: 100,
  CATEGORICAL_BAR_HEIGHT: 25,
  LABEL_LIMIT: 200,
  CONTAINER_OFFSET: 80,
} as const;

// Panel dimensions
export const PANEL = {
  MIN_HEIGHT: 150,
  MAX_HEIGHT_RATIO: 0.8,
  DEFAULT_SIDE_WIDTH: 300,
} as const;

// Zoom and pan
export const ZOOM = {
  SCALE_IN: 1.2,
  SCALE_OUT: 0.8,
  PAN_AMOUNT: 10,
} as const;

// Background options
export const BACKGROUND = {
  OPACITY: [0.01, 1.0] as [number, number],
  SIZE: [0.6, 1.0] as [number, number],
} as const;

// Color scales
export const COLORS = {
  VIRIDIS_EXTENDED: [
    '#fde725',
    '#a0da39',
    '#4ac16d',
    '#1fa187',
    '#277f8e',
    '#365c8d',
    '#46327e',
    '#440154',
  ] as const,
  VIRIDIS_SHORT: ['#fde725', '#21918c'] as const,
  TABLEAU: [
    '#e41a1c',
    '#377eb8',
    '#4daf4a',
    '#984ea3',
    '#ff7f00',
  ] as const,
} as const;

// URL templates (make configurable to remove Google-specific hardcoding)
export const URL_TEMPLATES = {
  PERFETTO_TRACE: (uuid: string) =>
    `https://apconsole.corp.google.com/link/perfetto/field_traces?uuid=${uuid}&query=`,
} as const;

// Special column names
export const SPECIAL_COLUMNS = {
  IX: 'ix',
  X: 'x',
  Y: 'y',
  TRACE_UUID: 'trace_uuid',
  CLUSTER_ID: 'cluster_id',
  DURATION: 'dur',
} as const;

// Duration conversion
export const DURATION = {
  NS_TO_MS: 1_000_000,
} as const;

// Number formatting thresholds
export const NUMBER_FORMAT = {
  LARGE_NUMBER_THRESHOLD: 1000000,
  THOUSAND_THRESHOLD: 1000,
} as const;
