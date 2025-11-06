export const config = {
  title: "App Launch Latency",
  columns: [
    { name: '_device_name', numeric: false },
    { name: '_build_id', numeric: false },
    { name: 'event_type', numeric: false },
    { name: 'dur', numeric: true },
    { name: 'package', numeric: false },
    { name: 'svg', numeric: false },
    { name: 'cluster_id', numeric: false },
    { name: 'trace_uuid', numeric: false, required: true, display: false }
  ],
  clusterReport: {
    columns: [
      { name: 'trace_uuid', display: 'Trace UUID', sortable: true },
      { name: 'startup_dur', display: 'Startup Duration (ms)', sortable: true, format: 'duration' },
      { name: 'startup_type', display: 'Type', sortable: true },
      { name: 'package', display: 'Package', sortable: true },
      { name: '_device_name', display: 'Device', sortable: true },
      { name: '_build_id', display: 'Build ID', sortable: true }
    ],
    filterableColumns: [
      'package',
      '_device_name',
      'startup_type'
    ]
  }
};