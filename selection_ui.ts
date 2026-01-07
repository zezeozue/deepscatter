/**
 * Selection rectangle UI management
 * Handles drawing and updating selection rectangles on the scatterplot
 */

import type { Scatterplot } from './src/deepscatter';
import type { SelectionBounds } from './types';
import { querySelectors } from './src/dom';

/**
 * Clear the selection rectangle and reset state
 */
export function clearSelectionRectangle(
  hasActiveSelection: { value: boolean },
  selectionDataBounds: { value: SelectionBounds | null }
): void {
  const selectionRectangle = document.getElementById('selection-rectangle');
  if (selectionRectangle) {
    selectionRectangle.style.display = 'none';
  }
  hasActiveSelection.value = false;
  selectionDataBounds.value = null;
  const panel = document.getElementById('action-panel') as HTMLElement;
  if (panel?.classList.contains('open')) {
    panel.classList.remove('open');
  }
}

/**
 * Update selection rectangle position based on current zoom/pan
 */
export function updateSelectionRectanglePosition(
  scatterplot: Scatterplot,
  hasActiveSelection: boolean,
  selectionDataBounds: SelectionBounds | null
): void {
  if (!hasActiveSelection || !selectionDataBounds) return;

  const selectionRectangle = document.getElementById('selection-rectangle');
  const currentSvg = querySelectors.svg();
  if (!selectionRectangle || !currentSvg) return;

  try {
    const { x_, y_ } = (scatterplot as any).zoom.scales();
    const svgRect = currentSvg.getBoundingClientRect();
    const parentRect = currentSvg.parentElement!.getBoundingClientRect();

    const leftPanel = document.getElementById('left-panel');
    const sidePanelWidth = leftPanel ? leftPanel.offsetWidth : 300;

    const bottomActionPanel = document.getElementById('action-panel');
    const bottomPanelHeight = (bottomActionPanel && bottomActionPanel.classList.contains('open') && !bottomActionPanel.classList.contains('collapsed'))
      ? bottomActionPanel.offsetHeight : 0;

    const screenX1 = x_(selectionDataBounds.xMin);
    const screenX2 = x_(selectionDataBounds.xMax);
    const screenY1 = y_(selectionDataBounds.yMin);
    const screenY2 = y_(selectionDataBounds.yMax);

    let left = Math.min(screenX1, screenX2);
    let top = Math.min(screenY1, screenY2);
    let right = Math.max(screenX1, screenX2);
    let bottom = Math.max(screenY1, screenY2);

    const maxWidth = window.innerWidth - sidePanelWidth;
    const maxHeight = window.innerHeight - bottomPanelHeight;

    left = Math.max(0, left);
    top = Math.max(0, top);
    right = Math.min(svgRect.width, right);
    bottom = Math.min(svgRect.height, bottom);

    const viewportRight = maxWidth - (svgRect.left - parentRect.left);
    const viewportBottom = maxHeight - (svgRect.top - parentRect.top);

    right = Math.min(right, viewportRight);
    bottom = Math.min(bottom, viewportBottom);

    const width = right - left;
    const height = bottom - top;

    const finalLeft = left + (svgRect.left - parentRect.left);
    const finalTop = top + (svgRect.top - parentRect.top);

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

/**
 * Setup selection region handlers
 */
export function setupSelectionRegion(plot: Scatterplot, selectionModeActive: boolean): void {
  const deepscatterDiv = document.getElementById('deepscatter');
  if (!deepscatterDiv) return;

  const svg = querySelectors.svg();
  if (svg && selectionModeActive) {
    svg.style.cursor = 'crosshair';
  }
}

/**
 * Setup zoom event handlers for selection rectangle tracking
 */
export function setupZoomHandlers(
  plot: Scatterplot,
  getHasActiveSelection: () => boolean,
  getSelectionDataBounds: () => SelectionBounds | null
): void {
  if ((plot as any).zoom && (plot as any).zoom.zoomer) {
    (plot as any).zoom.zoomer.on('zoom.selectionUpdate', () => {
      updateSelectionRectanglePosition(plot, getHasActiveSelection(), getSelectionDataBounds());
    });
    (plot as any).zoom.zoomer.on('end.selectionUpdate', () => {
      updateSelectionRectanglePosition(plot, getHasActiveSelection(), getSelectionDataBounds());
    });
  }
}
