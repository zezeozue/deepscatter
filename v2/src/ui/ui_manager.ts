import m from 'mithril';
import { ColorSelector, FilterSelector, PointInfo, FilterControls, FilterChips } from './components';
import { Tile } from '../data/tile';
import { FilterManager } from '../aesthetics/filter_manager';

export interface Column {
  name: string;
  numeric: boolean;
  categorical?: boolean;
}

/**
 * Manages UI rendering with Mithril components
 */
export class UIManager {
  private selectedDefault: string | null = null;

  /**
   * Set the selected default column
   */
  setSelectedDefault(selectedDefault: string | null): void {
    this.selectedDefault = selectedDefault;
  }

  /**
   * Render color selector dropdown
   */
  renderColorSelector(columns: Column[], onColorChange: (field: string) => void): void {
    // console.log('[UIManager] Rendering color selector with', columns.length, 'columns');
    const colorBy = document.getElementById('color-by-selector');
    if (!colorBy) {
      // console.warn('[UIManager] color-by-selector element not found');
      return;
    }
    
    // Get the parent container
    const parent = colorBy.parentNode;
    if (!parent) return;
    
    // Create a temporary container for Mithril rendering
    const tempDiv = document.createElement('div');
    m.render(tempDiv, m(ColorSelector, {
      columns,
      onChange: onColorChange,
      selectedDefault: this.selectedDefault
    }));
    
    const newSelect = tempDiv.firstChild as HTMLSelectElement;
    if (newSelect) {
      // Replace the old select with the new one
      parent.replaceChild(newSelect, colorBy);
      
      // Apply default color encoding if columns exist
      // Use setTimeout to avoid interfering with initial render
      if (columns.length > 0 && newSelect.value) {
        // console.log('[UIManager] Auto-applying color encoding for:', newSelect.value);
        setTimeout(() => onColorChange(newSelect.value), 0);
      }
    }
  }

  /**
   * Render filter selector dropdown
   */
  renderFilterSelector(
    columns: Column[],
    onFilterChange: () => void,
    activeFilters?: Set<string>
  ): void {
    // console.log('[UIManager] Rendering filter selector with', columns.length, 'columns');
    const filterBy = document.getElementById('filter-by-selector');
    if (!filterBy) {
      // console.warn('[UIManager] filter-by-selector element not found');
      return;
    }
    
    // Get the parent container
    const parent = filterBy.parentNode;
    if (!parent) return;
    
    // Create a temporary container for Mithril rendering
    const tempDiv = document.createElement('div');
    m.render(tempDiv, m(FilterSelector, {
      columns,
      onChange: onFilterChange,
      selectedDefault: this.selectedDefault,
      activeFilters
    }));
    
    const newSelect = tempDiv.firstChild;
    if (newSelect) {
      // Replace the old select with the new one
      parent.replaceChild(newSelect, filterBy);
      
      // Initialize filter controls
      // Use setTimeout to avoid interfering with initial render
      if (columns.length > 0) {
        // console.log('[UIManager] Auto-initializing filter controls');
        setTimeout(() => onFilterChange(), 0);
      }
    }
  }

  /**
   * Render point info display
   */
  renderPointInfo(data: Record<string, any> | null): void {
    const navbar = document.getElementById('point-data');
    if (!navbar) {
      // console.warn('[UIManager] point-data element not found');
      return;
    }

    if (data === null) {
      // console.log('[UIManager] Clearing point info');
      // Use Mithril to clear to maintain consistency
      m.render(navbar, null);
    } else {
      // console.log('[UIManager] Rendering point info:', Object.keys(data));
      // console.log('[UIManager] Point data values:', data);
      // console.log('[UIManager] navbar element:', navbar, 'innerHTML before:', navbar.innerHTML);
      
      // Force a fresh render by clearing first
      m.render(navbar, null);
      // Then render the new content
      m.render(navbar, m(PointInfo, { data }));
      
      // console.log('[UIManager] navbar innerHTML after:', navbar.innerHTML);
    }
  }

  /**
   * Render filter controls based on column type
   */
  renderFilterControls(
    column: Column,
    tiles: Tile[],
    filterManager: FilterManager,
    onApply: () => void
  ): void {
    const filterControls = document.getElementById('filter-controls');
    if (!filterControls) return;

    m.render(filterControls, m(FilterControls, {
      column,
      tiles,
      filterManager,
      onApply
    }));
  }

  /**
   * Get current filter selector value
   */
  getFilterSelectorValue(): string | null {
    const filterBy = document.getElementById('filter-by-selector') as HTMLSelectElement;
    return filterBy?.value || null;
  }

  /**
   * Resize canvas to match container
   */
  resizeCanvas(canvas: HTMLCanvasElement, container: HTMLElement): void {
    const { width, height } = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio;
    
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  /**
   * Render all UI controls (color + filter selectors)
   */
  renderAllControls(
    columns: Column[],
    onColorChange: (field: string) => void,
    onFilterChange: () => void,
    activeFilters?: Set<string>
  ): void {
    // console.log('[UIManager] renderAllControls called');
    this.renderColorSelector(columns, onColorChange);
    this.renderFilterSelector(columns, onFilterChange, activeFilters);
  }

  /**
   * Render filter chips
   */
  renderFilterChips(
    filterManager: FilterManager,
    onRemove: (field: string) => void
  ): void {
    const chipsContainer = document.getElementById('filter-chips-container');
    if (!chipsContainer) return;

    m.render(chipsContainer, m(FilterChips, {
      filters: filterManager.getFilters(),
      onRemove
    }));
  }

  /**
   * Update filter controls based on current selection
   */
  updateFilterControls(
    columns: Column[],
    tiles: any[],
    filterManager: FilterManager,
    onApply: () => void
  ): void {
    const filterValue = this.getFilterSelectorValue();
    if (!filterValue) return;

    const selected = columns.find(c => c.name === filterValue);
    if (!selected) return;

    this.renderFilterControls(selected, tiles, filterManager, onApply);
  }
}
