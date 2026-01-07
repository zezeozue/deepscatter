/**
 * Event handlers
 * Centralized event handling for scatterplot interactions
 */

import type { Scatterplot } from './src/deepscatter';
import { elements } from './src/dom';

/**
 * Setup scatterplot click handler
 */
export function setupScatterplotHandlers(
  plot: Scatterplot,
  getState: () => {
    justClicked: boolean;
    tooltipLocked: boolean;
    selectedIx: number | null;
  },
  setState: (updates: Partial<{
    justClicked: boolean;
    tooltipLocked: boolean;
    selectedIx: number | null;
  }>) => void
): void {
  (plot as any).click_function = async (datum: any, plotInstance: any, ev: MouseEvent) => {
    if (ev.ctrlKey || ev.metaKey) {
      const trace = datum['trace_uuid'];
      if (trace) {
        window.open(
          `https://apconsole.corp.google.com/link/perfetto/field_traces?uuid=${trace}&query=`,
          '_blank'
        );
      }
      return;
    }
    
    setState({
      justClicked: true,
      tooltipLocked: true,
      selectedIx: datum.ix
    });
    
    elements.detailPanel.classList.add('open');
    
    let output = '<div style="font-family: monospace; font-size: 12px;">';
    const keys = Object.keys(datum).filter(k => k !== 'ix' && k !== 'x' && k !== 'y');
    
    for (const key of keys) {
      let value = datum[key];
      console.log(`[handlers] Key: ${key}, Raw value:`, value, `Type: ${typeof value}`);
      if (value !== null && value !== undefined) {
        // Convert to string to handle Arrow dictionary-encoded columns
        const originalValue = value;
        value = String(value);
        console.log(`[handlers] Key: ${key}, After String():`, value, `Original:`, originalValue);
        let displayValue: any = value;
        if (typeof value === 'number') {
          if (key === 'dur' || key.includes('duration')) {
            displayValue = `${(Number(value) / 1_000_000).toFixed(2)}ms`;
          } else if (value > 1000000) {
            displayValue = value.toLocaleString();
          }
        }
        
        if (key.includes('uuid') || key.includes('trace')) {
          output += `<div style="margin-bottom: 4px;"><strong>${key}:</strong> <a href="https://apconsole.corp.google.com/link/perfetto/field_traces?uuid=${value}&query=" target="_blank">${displayValue}</a></div>`;
        } else {
          output += `<div style="margin-bottom: 4px;"><strong>${key}:</strong> ${displayValue}</div>`;
        }
      }
    }
    output += '</div>';
    elements.detailContent.innerHTML = output;
    
    const hasSvg = datum.svg && datum.svg.trim() && datum.svg.includes('<svg');
    if (hasSvg) {
      elements.bottomPanel.classList.add('open');
      elements.bottomPanelContent.innerHTML = `<div class="svg-container">${datum.svg}</div>`;
    } else {
      elements.bottomPanel.classList.remove('open');
    }
    
    const currentState = getState();
    
    // Don't create a selection or change the visualization
    // Just show the detail panel (which is already done above)
    // The selection system is causing issues with the rendering
  };
}

/**
 * Setup keyboard navigation handlers
 */
export function setupKeyboardHandlers(
  scatterplot: Scatterplot,
  state: {
    selectionModeActive: { value: boolean };
    hasActiveSelection: boolean;
    selectionDataBounds: any;
  },
  updateSelectionRectanglePosition: () => void
): void {
  document.addEventListener('keydown', (e) => {
    // Don't trigger shortcuts if user is typing in an input field
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
      return;
    }
    
    const zoom = (scatterplot as any).zoom;
    if (!zoom) return;
    
    const amount = 10;
    
    switch (e.key.toLowerCase()) {
      case 'l':
        // Toggle selection mode
        state.selectionModeActive.value = !state.selectionModeActive.value;
        const actionToolButton = document.getElementById('action-tool-button');
        const svg = document.querySelector('#deepscatter svg#deepscatter-svg') as SVGSVGElement;
        if (actionToolButton && svg) {
          actionToolButton.classList.toggle('active', state.selectionModeActive.value);
          svg.style.cursor = state.selectionModeActive.value ? 'crosshair' : 'default';
        }
        break;
      case 'w':
        zoom.zoomer.scaleBy(zoom.svg_element_selection.transition().duration(100), 1.2);
        setTimeout(updateSelectionRectanglePosition, 150);
        break;
      case 's':
        zoom.zoomer.scaleBy(zoom.svg_element_selection.transition().duration(100), 0.8);
        setTimeout(updateSelectionRectanglePosition, 150);
        break;
      case 'a':
      case 'arrowleft':
        zoom.zoomer.translateBy(zoom.svg_element_selection.transition().duration(50), amount, 0);
        setTimeout(updateSelectionRectanglePosition, 100);
        break;
      case 'd':
      case 'arrowright':
        zoom.zoomer.translateBy(zoom.svg_element_selection.transition().duration(50), -amount, 0);
        setTimeout(updateSelectionRectanglePosition, 100);
        break;
      case 'arrowup':
        zoom.zoomer.translateBy(zoom.svg_element_selection.transition().duration(50), 0, amount);
        setTimeout(updateSelectionRectanglePosition, 100);
        break;
      case 'arrowdown':
        zoom.zoomer.translateBy(zoom.svg_element_selection.transition().duration(50), 0, -amount);
        setTimeout(updateSelectionRectanglePosition, 100);
        break;
    }
  });
}

/**
 * Setup click-outside handler to close detail panel
 */
export function setupClickOutsideHandler(
  getState: () => {
    justClicked: boolean;
    tooltipLocked: boolean;
    selectedIx: number | null;
  },
  setState: (updates: Partial<{
    justClicked: boolean;
    tooltipLocked: boolean;
    selectedIx: number | null;
  }>) => void,
  scatterplot: Scatterplot,
  numericColumns: Set<string>
): void {
  document.addEventListener('click', (event) => {
    const clickedOnDetails = elements.detailPanel.contains(event.target as Node);
    const leftPanel = document.getElementById('left-panel');
    const clickedOnLeftPanel = leftPanel?.contains(event.target as Node);
    
    const currentState = getState();
    if (currentState.justClicked) {
      setState({ justClicked: false });
      return;
    }
    
    if (!clickedOnDetails && !clickedOnLeftPanel && currentState.selectedIx !== null) {
      setTimeout(() => {
        const state = getState();
        if (state.justClicked) return;
        
        setState({
          tooltipLocked: false,
          selectedIx: null
        });
        elements.detailPanel.classList.remove('open');
        elements.bottomPanel.classList.remove('open');
        
        scatterplot.plotAPI({
          encoding: {
            size: { constant: 2 },
          }
        });
      }, 100);
    }
  });
}
