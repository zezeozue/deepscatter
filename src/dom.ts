/**
 * DOM element selections
 * Centralized DOM access to prevent "element not found" errors
 */

export const getEl = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Element with id "${id}" not found`);
  }
  return element as T;
};

export const getElSafe = <T extends HTMLElement>(id: string): T | null => {
  return document.getElementById(id) as T | null;
};

/**
 * All DOM elements used in the application
 * Initialized lazily to avoid errors during module loading
 */
export const elements = {
  get detailPanel() { return getEl<HTMLElement>('detail-panel'); },
  get detailContent() { return getEl<HTMLElement>('detail-content'); },
  get bottomPanel() { return getEl<HTMLElement>('bottom-panel'); },
  get bottomPanelContent() { return getEl<HTMLElement>('bottom-panel-content'); },
  get colorColumnSelector() { return getEl<HTMLSelectElement>('color-column-selector'); },
  get legend() { return getEl<HTMLElement>('legend'); },
  get filterContainer() { return getEl<HTMLElement>('filter-container'); },
  get filterColumnSelector() { return getEl<HTMLSelectElement>('filter-column-selector'); },
  get filterValueContainer() { return getEl<HTMLElement>('filter-value-container'); },
  get filterChipsContainer() { return getEl<HTMLElement>('filter-chips-container'); },
  get actionToolButton() { return getEl<HTMLButtonElement>('action-tool-button'); },
  get deepscatterDiv() { return getEl<HTMLElement>('deepscatter'); },
  get importCsvButton() { return getEl<HTMLButtonElement>('import-csv-button'); },
  get csvUpload() { return getEl<HTMLInputElement>('csv-upload'); },
  get importModal() { return getEl<HTMLElement>('import-modal'); },
  get importButton() { return getEl<HTMLButtonElement>('import-button'); },
  get loadingOverlay() { return getEl<HTMLElement>('loading-overlay'); },
  get progressBar() { return getEl<HTMLElement>('progress-bar'); },
  get progressText() { return getEl<HTMLElement>('progress-text'); },
  get actionPanel() { return getEl<HTMLElement>('action-panel'); },
  get selectionCount() { return getEl<HTMLElement>('selection-count'); },
  get executeButton() { return getEl<HTMLButtonElement>('execute-button'); },
  get columnSelector() { return getEl<HTMLSelectElement>('column-selector'); },
  get chartContainer() { return getEl<HTMLElement>('chart-container'); },
  get actionSelector() { return getEl<HTMLSelectElement>('action-selector'); },
  get xColumnSelector() { return getEl<HTMLSelectElement>('x-column-selector'); },
  get yColumnSelector() { return getEl<HTMLSelectElement>('y-column-selector'); },
  get notificationToast() { return getEl<HTMLElement>('notification-toast'); },
  get leftPanel() { return getElSafe<HTMLElement>('left-panel'); },
  get selectionRectangle() { return getElSafe<HTMLElement>('selection-rectangle'); },
};

/**
 * Query selectors for dynamic elements
 */
export const querySelectors = {
  svg: () => document.querySelector('#deepscatter svg#deepscatter-svg') as SVGSVGElement | null,
  closeModalButton: () => document.querySelector('#import-modal .close-button') as HTMLElement | null,
  panelCloseButton: () => document.querySelector('.panel-close-button') as HTMLElement | null,
  panelCollapseButton: () => document.querySelector('.panel-collapse-button') as HTMLElement | null,
};
