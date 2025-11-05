export const config = {
  columns: [
    { name: '_device_name', numeric: false },
    { name: '_build_id', numeric: false },
    { name: 'event_type', numeric: false },
    { name: 'dur', numeric: true },
    { name: 'package', numeric: false },
    { name: 'svg', numeric: false },
    { name: 'cluster_id', numeric: false },
    { name: 'trace_uuid', numeric: false, required: true, display: false }
  ]
};