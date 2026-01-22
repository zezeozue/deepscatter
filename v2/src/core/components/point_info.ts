import m from 'mithril';

interface PointInfoAttrs {
  data: Record<string, any>;
}

export const PointInfo: m.Component<PointInfoAttrs> = {
  view({ attrs }) {
    const { data } = attrs;
    
    return m('.point-info', 
      Object.entries(data).map(([key, value]) =>
        m('.point-row', [
          m('span.point-key', key),
          m('span.point-value', value)
        ])
      )
    );
  }
};
