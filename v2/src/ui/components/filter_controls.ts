import m from 'mithril';
import { FilterManager } from '../../aesthetics/filter_manager';
import { Tile } from '../../data/tile';

interface Column {
  name: string;
  numeric: boolean;
  categorical?: boolean;
}

interface FilterControlsAttrs {
  column: Column;
  tiles: Tile[];
  filterManager: FilterManager;
  onApply: () => void;
}

const NumericFilter: m.Component<FilterControlsAttrs> = {
  view({ attrs }) {
    const { column, tiles, filterManager, onApply } = attrs;
    const [min, max] = filterManager.getNumericRange(column.name, tiles);
    
    let minVal: number | null = null;
    let maxVal: number | null = null;
    
    const applyFilter = () => {
      if (minVal !== null || maxVal !== null) {
        filterManager.setNumericFilter(column.name, minVal, maxVal);
      } else {
        filterManager.removeFilter(column.name);
      }
      onApply();
    };
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        applyFilter();
      }
    };
    
    return m('.filter-numeric', [
      m('.input-group', {
        style: 'display: flex; gap: 5px; margin-top: 10px;'
      }, [
        m('input[type=number]', {
          placeholder: `Min (${min.toFixed(2)})`,
          step: 'any',
          style: 'flex: 1;',
          oninput: (e: Event) => {
            const val = (e.target as HTMLInputElement).value;
            minVal = val ? parseFloat(val) : null;
          },
          onkeydown: handleKeyDown
        }),
        m('input[type=number]', {
          placeholder: `Max (${max.toFixed(2)})`,
          step: 'any',
          style: 'flex: 1;',
          oninput: (e: Event) => {
            const val = (e.target as HTMLInputElement).value;
            maxVal = val ? parseFloat(val) : null;
          },
          onkeydown: handleKeyDown
        })
      ])
    ]);
  }
};

const CategoricalFilter: m.Component<FilterControlsAttrs> = {
  view({ attrs }) {
    const { column, tiles, filterManager, onApply } = attrs;
    const uniqueValues = filterManager.getUniqueValues(column.name, tiles);
    
    return m('.filter-categorical', [
      m('label.filter-label', {
        style: 'display: block; margin-top: 10px; margin-bottom: 5px; font-weight: 600; font-size: 0.9rem;'
      }, 'Select Value:'),
      m('select.filter-select', {
        style: 'width: 100%; padding: 0.6rem; margin-bottom: 10px;',
        onchange: (e: Event) => {
          const value = (e.target as HTMLSelectElement).value;
          
          if (value === '__ALL__') {
            filterManager.removeFilter(column.name);
          } else {
            filterManager.setCategoricalFilter(column.name, new Set([value]));
          }
          onApply();
        }
      }, [
        m('option', { value: '__ALL__' }, 'All'),
        ...uniqueValues.map(val =>
          m('option', { value: String(val) }, String(val))
        )
      ])
    ]);
  }
};

const StringFilter: m.Component<FilterControlsAttrs> = {
  view({ attrs }) {
    const { column, filterManager, onApply } = attrs;
    
    let currentValue = '';
    
    const applyFilter = () => {
      if (currentValue && currentValue.trim()) {
        filterManager.setStringFilter(column.name, currentValue);
      } else {
        filterManager.removeFilter(column.name);
      }
      onApply();
    };
    
    return m('.filter-string', [
      m('label.filter-label', {
        style: 'display: block; margin-top: 10px; margin-bottom: 5px; font-weight: 600; font-size: 0.9rem;'
      }, 'Search (substring):'),
      m('input[type=text]', {
        placeholder: 'Enter text to filter... (press Enter)',
        style: 'width: 100%; padding: 0.6rem; margin-bottom: 10px; box-sizing: border-box;',
        oninput: (e: Event) => {
          currentValue = (e.target as HTMLInputElement).value;
        },
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            applyFilter();
          }
        }
      })
    ]);
  }
};

export const FilterControls: m.Component<FilterControlsAttrs> = {
  view({ attrs }) {
    const { column } = attrs;
    
    if (column.numeric) {
      return m(NumericFilter, attrs);
    } else if (column.categorical) {
      return m(CategoricalFilter, attrs);
    } else {
      return m(StringFilter, attrs);
    }
  }
};
