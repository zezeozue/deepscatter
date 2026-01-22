import m from 'mithril';

interface PointInfoAttrs {
  data: Record<string, any>;
}

/**
 * Check if a value is a URL (starts with http:// or https://)
 */
function isUrl(value: any): boolean {
  if (typeof value !== 'string') return false;
  return value.startsWith('http://') || value.startsWith('https://');
}

export const PointInfo: m.Component<PointInfoAttrs> = {
  view({ attrs }) {
    const { data } = attrs;
    
    return m('.point-info',
      Object.entries(data).map(([key, value]) =>
        m('.point-row', [
          m('span.point-key', key),
          isUrl(value)
            ? m('span.point-value',
                m('a', {
                  href: value,
                  target: '_blank',
                  rel: 'noopener noreferrer'
                }, value)
              )
            : m('span.point-value', value)
        ])
      )
    );
  }
};
