import m from 'mithril';

interface Column {
  name: string;
  numeric: boolean;
  categorical?: boolean;
}

interface ColorSelectorAttrs {
  columns: Column[];
  onChange: (field: string) => void;
}

interface FilterSelectorAttrs {
  columns: Column[];
  onChange: () => void;
}

export const ColorSelector: m.Component<ColorSelectorAttrs> = {
  view({ attrs }) {
    const { columns, onChange } = attrs;
    
    return m('select#color-by-selector', {
      onchange: (e: Event) => {
        const value = (e.target as HTMLSelectElement).value;
        onChange(value);
      }
    },
      columns.map(col =>
        m('option', { value: col.name }, col.name)
      )
    );
  }
};

export const FilterSelector: m.Component<FilterSelectorAttrs> = {
  view({ attrs }) {
    const { columns, onChange } = attrs;
    
    return m('select#filter-by-selector', {
      onchange: () => onChange()
    },
      columns.map(col =>
        m('option', { value: col.name }, col.name)
      )
    );
  }
};
