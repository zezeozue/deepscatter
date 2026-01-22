import m from 'mithril';
import { Filter } from '../../aesthetics/filter_manager';

interface FilterChipsAttrs {
  filters: Map<string, Filter>;
  onRemove: (field: string) => void;
}

/**
 * FilterChips component - displays active filters as removable chips
 * Follows the pattern from the parent directory's filter implementation
 */
export const FilterChips: m.Component<FilterChipsAttrs> = {
  view({ attrs }) {
    const { filters, onRemove } = attrs;
    
    if (filters.size === 0) {
      return null;
    }
    
    const chips: m.Vnode[] = [];
    
    filters.forEach((filter, field) => {
      let displayText = '';
      
      if (filter.type === 'numeric') {
        const { min, max } = filter;
        if (min !== null && max !== null) {
          displayText = `${field}: ${min} - ${max}`;
        } else if (min !== null) {
          displayText = `${field}: ≥ ${min}`;
        } else if (max !== null) {
          displayText = `${field}: ≤ ${max}`;
        }
      } else if (filter.type === 'categorical') {
        const values = Array.from(filter.values);
        if (values.length === 1) {
          displayText = `${field}: ${values[0]}`;
        } else {
          displayText = `${field}: ${values.length} values`;
        }
      } else if (filter.type === 'string') {
        displayText = `${field}: "${filter.substring}"`;
      }
      
      chips.push(
        m('.filter-chip', {
          key: field
        }, [
          m('span.filter-chip-text', displayText),
          m('button.filter-chip-remove', {
            title: 'Remove filter',
            onclick: () => onRemove(field)
          }, '×')
        ])
      );
    });
    
    return m('.filter-chips-wrapper', {
      style: 'display: flex; flex-wrap: wrap; gap: 6px;'
    }, chips);
  }
};
