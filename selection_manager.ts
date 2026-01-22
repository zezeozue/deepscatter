// Selection rectangle management - extracted from main.js
import type { Scatterplot } from './src/deepscatter';
import type { SelectionBounds } from './types';
import { SELECTION } from './constants';

export class SelectionManager {
  private hasActiveSelection: boolean = false;
  private selectionDataBounds: SelectionBounds | null = null;
  private isDrawing: boolean = false;
  private startX: number = 0;
  private startY: number = 0;
  private endX: number = 0;
  private endY: number = 0;
  private hasDragged: boolean = false;

  constructor(
    private scatterplot: Scatterplot,
    private deepscatterDiv: HTMLElement
  ) {}

  /**
   * Clear the selection rectangle and reset state
   */
  clearSelection(): void {
    const selectionRectangle = document.getElementById('selection-rectangle');
    if (selectionRectangle) {
      selectionRectangle.style.display = 'none';
    }
    this.hasActiveSelection = false;
    this.selectionDataBounds = null;
    
    const panel = document.getElementById('action-panel');
    if (panel?.classList.contains('open')) {
      panel.classList.remove('open');
    }
  }

  /**
   * Update selection rectangle position based on current zoom/pan
   */
  updateSelectionRectanglePosition(): void {
    if (!this.hasActiveSelection || !this.selectionDataBounds) {
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
      const { x_, y_ } = this.scatterplot.zoom.scales();
      const svgRect = currentSvg.getBoundingClientRect();
      const parentRect = currentSvg.parentElement!.getBoundingClientRect();
      
      // Get side panel width to avoid occlusion
      const leftPanel = document.getElementById('left-panel');
      const sidePanelWidth = leftPanel ? leftPanel.offsetWidth : 300;
      
      // Get bottom panel height if open
      const bottomPanel = document.getElementById('action-panel');
      const bottomPanelHeight = (bottomPanel && bottomPanel.classList.contains('open') && !bottomPanel.classList.contains('collapsed'))
        ? bottomPanel.offsetHeight : 0;
      
      // Convert data coordinates back to screen coordinates
      const screenX1 = x_(this.selectionDataBounds.xMin);
      const screenX2 = x_(this.selectionDataBounds.xMax);
      const screenY1 = y_(this.selectionDataBounds.yMin);
      const screenY2 = y_(this.selectionDataBounds.yMax);
      
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

  /**
   * Setup zoom event handlers for selection rectangle
   */
  setupZoomHandlers(): void {
    if (this.scatterplot.zoom && this.scatterplot.zoom.zoomer) {
      this.scatterplot.zoom.zoomer.on('zoom.selectionUpdate', () => {
        this.updateSelectionRectanglePosition();
      });
      
      this.scatterplot.zoom.zoomer.on('end.selectionUpdate', () => {
        this.updateSelectionRectanglePosition();
      });
    }
  }

  /**
   * Setup selection region handlers
   */
  setupSelectionRegion(): void {
    const svg = document.querySelector('#deepscatter svg#deepscatter-svg') as SVGElement;
    if (svg) {
      // Cursor will be set by selection mode toggle
    }
  }

  /**
   * Setup mouse event handlers for drawing selection rectangle
   */
  setupMouseHandlers(selectionModeActive: () => boolean): void {
    // Mousedown - start drawing
    this.deepscatterDiv.addEventListener('mousedown', (e: MouseEvent) => {
      if (!selectionModeActive()) return;
      
      const currentSvg = document.querySelector('#deepscatter svg#deepscatter-svg');
      if (!currentSvg || !currentSvg.contains(e.target as Node)) return;
      
      e.stopPropagation();
      e.preventDefault();
      this.isDrawing = true;
      this.hasDragged = false;
      
      const svgRect = currentSvg.getBoundingClientRect();
      
      this.startX = e.clientX - svgRect.left;
      this.startY = e.clientY - svgRect.top;
    });

    // Mousemove - draw selection rectangle
    this.deepscatterDiv.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.isDrawing) return;
      
      const currentSvg = document.querySelector('#deepscatter svg#deepscatter-svg');
      if (!currentSvg) return;
      
      const svgRect = currentSvg.getBoundingClientRect();
      
      this.endX = e.clientX - svgRect.left;
      this.endY = e.clientY - svgRect.top;
      
      // Check if we've moved enough to consider this a drag
      const deltaX = Math.abs(this.endX - this.startX);
      const deltaY = Math.abs(this.endY - this.startY);
      
      if (!this.hasDragged && (deltaX > SELECTION.MIN_DRAG_DISTANCE || deltaY > SELECTION.MIN_DRAG_DISTANCE)) {
        this.hasDragged = true;
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
          currentSvg.parentElement!.appendChild(selectionRectangle);
        }
        selectionRectangle.style.display = 'block';
      }
      
      if (this.hasDragged) {
        const selectionRectangle = document.getElementById('selection-rectangle');
        if (!selectionRectangle) return;
        
        const width = Math.abs(this.endX - this.startX);
        const height = Math.abs(this.endY - this.startY);
        
        const parentRect = currentSvg.parentElement!.getBoundingClientRect();
        const left = Math.min(this.startX, this.endX) + (svgRect.left - parentRect.left);
        const top = Math.min(this.startY, this.endY) + (svgRect.top - parentRect.top);
        
        selectionRectangle.style.width = `${width}px`;
        selectionRectangle.style.height = `${height}px`;
        selectionRectangle.style.left = `${left}px`;
        selectionRectangle.style.top = `${top}px`;
      }
    });

    // Mouseup - complete selection
    this.deepscatterDiv.addEventListener('mouseup', async (e: MouseEvent) => {
      if (!this.isDrawing) return;
      e.stopPropagation();
      this.isDrawing = false;
      
      // Only proceed with selection if we actually dragged
      if (!this.hasDragged) {
        this.hasDragged = false;
        this.clearSelection();
        return;
      }
      
      // Keep the selection rectangle visible
      this.hasActiveSelection = true;
      
      // Reset hasDragged after a short delay
      setTimeout(() => {
        this.hasDragged = false;
      }, 100);
      
      const currentSvg = document.querySelector('#deepscatter svg#deepscatter-svg');
      if (!currentSvg) return;
      
      const svgRect = currentSvg.getBoundingClientRect();
      
      this.endX = e.clientX - svgRect.left;
      this.endY = e.clientY - svgRect.top;
      
      // Calculate selection bounds in data coordinates
      const { x_, y_ } = this.scatterplot.zoom.scales();
            
      const xDomainMin = Math.min(x_.invert(this.startX), x_.invert(this.endX));
      const xDomainMax = Math.max(x_.invert(this.startX), x_.invert(this.endX));
      const startYData = y_.invert(this.startY);
      const endYData = y_.invert(this.endY);
      const yDomainMin = Math.min(startYData, endYData);
      const yDomainMax = Math.max(startYData, endYData);
      
      // Store selection bounds in data coordinates
      this.selectionDataBounds = {
        xMin: xDomainMin,
        xMax: xDomainMax,
        yMin: yDomainMin,
        yMax: yDomainMax
      };
    });
  }

  /**
   * Get current selection bounds
   */
  getSelectionBounds(): SelectionBounds | null {
    return this.selectionDataBounds;
  }

  /**
   * Check if there's an active selection
   */
  hasSelection(): boolean {
    return this.hasActiveSelection;
  }
}
