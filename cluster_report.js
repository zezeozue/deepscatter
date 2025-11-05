// Placeholder data - this will be replaced by a fetch call to the backend
let originalMetadata = [];
let clusterAnalysis = [];
let sequences = {};
let boxplotData = {};
let currentMetadata = [];
let selectedClusterId = null;
let maxPerCluster = 10;
let topSlices = 10;
let showAllUnique = false;

async function fetchData() {
  try {
    const response = await fetch('/cluster_analysis');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();

    originalMetadata = data.metadata;
    clusterAnalysis = data.clusterAnalysis;
    sequences = data.sequences;
    boxplotData = data.boxplotData;
    currentMetadata = [...originalMetadata];
    maxPerCluster = data.maxPerCluster;
    topSlices = data.topSlices;
    showAllUnique = data.showAllUnique;

    console.log("Data received from server:", data);

    document.getElementById('generation-timestamp').textContent = new Date(data.timestamp).toLocaleString();
    document.getElementById('results-dir').textContent = data.resultsDir;
    document.getElementById('summary-total-traces').textContent = data.totalTraces.toLocaleString();
    document.getElementById('summary-clusters').textContent = data.numClusters;
    document.getElementById('summary-avg-size').textContent = Math.round(data.avgClusterSize);
    document.getElementById('silhouette-score').textContent = data.silhouette;
    document.getElementById('calinski-score').textContent = data.calinski;
    
    return data;
  } catch (error) {
    console.error('Error fetching cluster data:', error);
    const container = document.querySelector('.container');
    container.innerHTML = '<h1>Error loading report data</h1><p>Could not fetch cluster analysis data from the backend. Please check the console for more details.</p>';
  }
}
async function renderCluster(clusterId) {
    selectedClusterId = clusterId;
    const detailView = document.getElementById('cluster-detail-view');
    
    // Fetch detailed trace data for the selected cluster
    const response = await fetch(`/cluster_traces/${clusterId}`);
    let clusterTraces = await response.json();
    
    // Ensure clusterTraces is always an array
    if (!Array.isArray(clusterTraces)) {
      clusterTraces = clusterTraces ? [clusterTraces] : [];
    }
    
    const clusterInfo = clusterAnalysis.find(c => c.cluster_id === clusterId);
    if (!clusterInfo) {
        detailView.innerHTML = `<p>No data available for cluster ${clusterId}.</p>`;
        detailView.style.display = 'block';
        return;
    }
    let statsHtml = '<div class="cluster-stats">';
    if (clusterInfo.avg_startup_dur) {
        statsHtml += `
            <div class="stat-item">
                <div class="stat-label">Avg Startup Duration</div>
                <div class="stat-value">${(clusterInfo.avg_startup_dur / 1e6).toLocaleString(undefined, {maximumFractionDigits: 0})} ms</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Duration (p50/p90/p99)</div>
                <div class="stat-value">${(clusterInfo.p50_startup_dur/1e6).toLocaleString(undefined, {maximumFractionDigits: 0})} / ${(clusterInfo.p90_startup_dur/1e6).toLocaleString(undefined, {maximumFractionDigits: 0})} / ${(clusterInfo.p99_startup_dur/1e6).toLocaleString(undefined, {maximumFractionDigits: 0})} ms</div>
            </div>`;
    }
    if (clusterInfo.unique_packages) {
        statsHtml += `
            <div class="stat-item">
                <div class="stat-label">Unique Packages</div>
                <div class="stat-value">${clusterInfo.unique_packages}</div>
            </div>`;
    }
     if (clusterInfo.unique_devices) {
        statsHtml += `
            <div class="stat-item">
                <div class="stat-label">Unique Devices</div>
                <div class="stat-value">${clusterInfo.unique_devices}</div>
            </div>`;
    }
    if (clusterInfo.unique_build_ids) {
        statsHtml += `
            <div class="stat-item">
                <div class="stat-label">Unique Build IDs</div>
                <div class="stat-value">${clusterInfo.unique_build_ids}</div>
            </div>`;
    }
    statsHtml += '</div>';
    let tableHtml = `
        <table class="traces-table">
            <thead>
                <tr>
                    <th data-sort="trace_uuid">Trace UUID</th>
                    <th data-sort="startup_dur">Startup Duration (ms)</th>
                    <th data-sort="startup_type">Type</th>
                    <th data-sort="num_events">Events</th>
                    <th data-sort="package">Package</th>
                    <th data-sort="_device_name">Device</th>
                    <th data-sort="_build_id">Build ID</th>
                    <th>Sequence</th>
                </tr>
            </thead>
            <tbody>`;
    const sortedTraces = clusterTraces.sort((a, b) => a.startup_dur - b.startup_dur);
    let tracesToDisplay = sortedTraces;
    if (maxPerCluster !== null && sortedTraces.length > maxPerCluster) {
        const fastest = sortedTraces.slice(0, 1);
        const slowest = sortedTraces.slice(-1);
        const middle = sortedTraces.slice(1, -1);
        const middleSample = [];
        const sampleCount = Math.max(0, maxPerCluster - 2);
        for (let i = 0; i < sampleCount; i++) {
            if (middle.length === 0) break;
            const randomIndex = Math.floor(Math.random() * middle.length);
            middleSample.push(middle.splice(randomIndex, 1)[0]);
        }
        tracesToDisplay = [...fastest, ...middleSample, ...slowest].sort((a, b) => a.startup_dur - b.startup_dur);
    }
    tracesToDisplay.forEach(row => {
        const startupTypeClass = row.startup_type ? row.startup_type.toLowerCase() : '';
        tableHtml += `
            <tr>
                <td><a href="https://apconsole.corp.google.com/link/perfetto/field_traces?uuid=${row.trace_uuid}&query=" class="trace-link" target="_blank">${row.trace_uuid}</a></td>
                <td><span class="duration">${row.startup_dur ? (row.startup_dur/1e6).toLocaleString(undefined, {maximumFractionDigits: 0}) + ' ms' : 'N/A'}</span></td>
                <td><span class="startup-type ${startupTypeClass}">${row.startup_type || 'N/A'}</span></td>
                <td>${row.num_events ? row.num_events.toLocaleString() : 'N/A'}</td>
                <td><span class="package">${row.package || 'N/A'}</span></td>
                <td>${row._device_name || 'N/A'}</td>
                <td>${row._build_id || 'N/A'}</td>
                <td><button class="sequence-button" data-trace-uuid="${row.trace_uuid}">Show</button></td>
            </tr>`;
    });
    tableHtml += '</tbody></table>';
    detailView.innerHTML = `
        <div class="cluster-section" id="cluster-${clusterId}">
            <div class="cluster-header">
                <h2 class="cluster-title">Cluster ${clusterId} (${clusterTraces.length} traces)</h2>
                <div class="nav-buttons">
                    <button id="prev-cluster-btn">← Prev</button>
                    <button id="next-cluster-btn">Next →</button>
                </div>
            </div>
            ${statsHtml}
            <div class="cluster-plots" id="cluster-plots-container">
                <div id="dur-histogram-container" class="plot-container"></div>
                <div id="package-dist-container" class="plot-container"></div>
            </div>
            ${tableHtml}
        </div>`;
    detailView.style.display = 'block';
    // Add sorting functionality to table headers
    const table = detailView.querySelector('.traces-table');
    const headers = table.querySelectorAll('th[data-sort]');
    headers.forEach(header => {
      header.style.cursor = 'pointer';
      header.addEventListener('click', () => {
        const sortKey = header.dataset.sort;
        sortTable(table, sortKey);
      });
    });

    // Add button listeners
    const sortedClusters = Object.entries(clusterSizes)
      .map(([id, size]) => ({ cluster_id: parseInt(id), size: size }))
      .sort((a, b) => b.size - a.size);
    const clusterIds = sortedClusters.map(d => d.cluster_id);
    const currentIndex = clusterIds.indexOf(clusterId);
    const prevBtn = document.getElementById('prev-cluster-btn');
    const nextBtn = document.getElementById('next-cluster-btn');
    prevBtn.disabled = currentIndex === 0;
    nextBtn.disabled = currentIndex === clusterIds.length - 1;
    prevBtn.onclick = () => {
        if (currentIndex > 0) {
            renderCluster(clusterIds[currentIndex - 1]);
        }
    };
    nextBtn.onclick = () => {
        if (currentIndex < clusterIds.length - 1) {
            renderCluster(clusterIds[currentIndex + 1]);
        }
    };
    // Render plots
    const plotsContainer = document.getElementById('cluster-plots-container');
    plotsContainer.innerHTML = ''; // Clear previous plots
    // Histogram of startup_dur
    const durHistogramContainer = document.createElement('div');
    durHistogramContainer.className = 'plot-container';
    plotsContainer.appendChild(durHistogramContainer);
    const durationsMs = clusterTraces.map(d => d.startup_dur / 1e6);
    const durTrace = {
        x: durationsMs,
        type: 'histogram',
        marker: {
            color: 'rgba(26, 115, 232, 0.7)',
        },
    };
    const durLayout = {
        title: `Cluster ${clusterId} - Startup Duration Distribution`,
        xaxis: { title: 'Startup Duration (ms)' },
        yaxis: { title: 'Count' }
    };
    Plotly.newPlot(durHistogramContainer, [durTrace], durLayout);
    const clusterTraceUuids = new Set(clusterTraces.map(t => t.trace_uuid));
    const clusterSequences = [];
    if (sequences) {
        for (const uuid in sequences) {
            if (clusterTraceUuids.has(uuid)) {
                clusterSequences.push(...sequences[uuid]);
            }
        }
    }
    // Use boxplot data if available, otherwise fall back to sequences
    const clusterBoxplotData = boxplotData ? boxplotData[`cluster_${clusterId}`] : null;
    
    if (clusterBoxplotData && clusterBoxplotData.slices) {
        // Create box plot using pre-computed boxplot data
        const plotDiv = document.createElement('div');
        plotDiv.className = 'plot-container';
        plotDiv.style.height = '600px';
        plotsContainer.appendChild(plotDiv);
        const sliceNames = Object.keys(clusterBoxplotData.slices);
        
        const traces = sliceNames.map(name => {
            const sliceData = clusterBoxplotData.slices[name];
            return {
                y: sliceData.durations,
                type: 'box',
                name: name,
                boxpoints: 'outliers',  // Show outliers only
                boxmean: false,         // Disable mean line
                whiskerwidth: 0.5,
                marker: {
                    size: 4
                },
                quartilemethod: 'exclusive'  // Force proper quartile calculation
            };
        });
        const layout = {
            title: `Cluster ${clusterId} - Top ${sliceNames.length} Slice Duration Distributions`,
            yaxis: {
                title: 'Duration (ms)',
                type: 'log'  // Use log scale for better visualization of wide duration ranges
            },
            xaxis: {
                title: 'Slice Type',
                tickangle: -45
            },
            height: 500,
            showlegend: false,
            margin: { b: 150 }  // Extra bottom margin for rotated labels
        };
        Plotly.newPlot(plotDiv, traces, layout);
        // Also create a summary table for this cluster using pre-computed statistics
        const summaryDiv = document.createElement('div');
        summaryDiv.className = 'plot-container';
        summaryDiv.style.marginTop = '20px';
        plotsContainer.appendChild(summaryDiv);
        let summaryHtml = `
            <h4>Cluster ${clusterId} - Slice Duration Summary</h4>
            <table class="traces-table" style="font-size: 0.9em;">
                <thead>
                    <tr>
                        <th>Slice Name</th>
                        <th>Count</th>
                        <th>Mean (ms)</th>
                        <th>Median (ms)</th>
                        <th>Std Dev (ms)</th>
                        <th>Min (ms)</th>
                        <th>Max (ms)</th>
                        <th>P90 (ms)</th>
                        <th>P99 (ms)</th>
                    </tr>
                </thead>
                <tbody>`;
        sliceNames.forEach(name => {
            const sliceData = clusterBoxplotData.slices[name];
            const stats = sliceData.statistics;
            
            summaryHtml += `
                <tr>
                    <td style="font-weight: 500;">${name}</td>
                    <td>${sliceData.count.toLocaleString()}</td>
                    <td>${stats.mean.toFixed(2)}</td>
                    <td>${stats.median.toFixed(2)}</td>
                    <td>${stats.std.toFixed(2)}</td>
                    <td>${stats.min.toFixed(2)}</td>
                    <td>${stats.max.toFixed(2)}</td>
                    <td>${stats.p90.toFixed(2)}</td>
                    <td>${stats.p99.toFixed(2)}</td>
                </tr>`;
        });
        summaryHtml += '</tbody></table>';
        summaryDiv.innerHTML = summaryHtml;
    } else if (clusterSequences.length > 0) {
        // Fallback to original sequence-based approach
        const plotDiv = document.createElement('div');
        plotDiv.className = 'plot-container';
        plotDiv.style.height = '600px';
        plotsContainer.appendChild(plotDiv);
        const sliceCounts = d3.rollup(clusterSequences, v => v.length, d => d.norm_name);
        const topSlices_list = Array.from(sliceCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, topSlices).map(d => d[0]);
        const plotData = clusterSequences.filter(d => topSlices_list.includes(d.norm_name));
        const traces = topSlices_list.map(name => {
            const durations = plotData.filter(d => d.norm_name === name).map(d => d.dur / 1e6);
            return {
                y: durations,
                type: 'box',
                name: name,
                boxpoints: 'outliers',  // Show outliers only
                boxmean: false,         // Disable mean line
                whiskerwidth: 0.5,
                quartilemethod: 'exclusive'  // Force proper quartile calculation
            };
        });
        const layout = {
            title: `Cluster ${clusterId} - Top ${topSlices} Slice Duration Distributions`,
            yaxis: {
                title: 'Duration (ms)',
                type: 'log'
            },
            xaxis: {
                title: 'Slice Type',
                tickangle: -45
            },
            height: 500,
            showlegend: false,
            margin: { b: 150 }
        };
        Plotly.newPlot(plotDiv, traces, layout);
    }
    ['package', '_device_name', '_build_id', 'startup_type'].forEach(col => {
        const plotDiv = document.createElement('div');
        plotDiv.className = 'plot-container';
        plotsContainer.appendChild(plotDiv);
        const counts = d3.rollup(clusterTraces, v => v.length, d => d[col]);
        let sortedCounts = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
        // Only limit if showAllUnique is false
        if (!showAllUnique) {
            sortedCounts = sortedCounts.slice(0, topSlices);
        }
        const trace = {
            x: sortedCounts.map(d => d[0]),
            y: sortedCounts.map(d => d[1]),
            type: 'bar'
        };
        const title = showAllUnique ?
            `Distribution of ${col.replace('_', ' ')} (All ${counts.size} unique values)` :
            `Distribution of ${col.replace('_', ' ')} (Top ${Math.min(topSlices, counts.size)})`;
        Plotly.newPlot(plotDiv, [trace], {title: title});
    });

    // Re-render the bar chart to update the highlight
    updateBarChart(clusterSizes);
}

let sortState = {}; // { key: 'asc' | 'desc' }

function sortTable(table, key) {
  const tbody = table.querySelector('tbody');
  const rows = Array.from(tbody.querySelectorAll('tr'));

  const currentSortOrder = sortState[key] || 'desc';
  const newSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
  sortState = { [key]: newSortOrder }; // Reset sort state for other columns

  rows.sort((a, b) => {
    let valA = a.querySelector(`[data-sort="${key}"]`)?.textContent || a.cells[getColumnIndex(key)].textContent;
    let valB = b.querySelector(`[data-sort="${key}"]`)?.textContent || b.cells[getColumnIndex(key)].textContent;

    // Attempt to convert to numbers for numeric sorting
    const numA = parseFloat(valA.replace(/,/g, '').replace(' ms', ''));
    const numB = parseFloat(valB.replace(/,/g, '').replace(' ms', ''));

    if (!isNaN(numA) && !isNaN(numB)) {
      valA = numA;
      valB = numB;
    }

    if (valA < valB) {
      return newSortOrder === 'asc' ? -1 : 1;
    }
    if (valA > valB) {
      return newSortOrder === 'asc' ? 1 : -1;
    }
    return 0;
  });

  rows.forEach(row => tbody.appendChild(row));

  // Update header styles
  table.querySelectorAll('th[data-sort]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === key) {
      th.classList.add(newSortOrder === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

function getColumnIndex(key) {
  const headerMap = {
    'trace_uuid': 0,
    'startup_dur': 1,
    'startup_type': 2,
    'num_events': 3,
    'package': 4,
    '_device_name': 5,
    '_build_id': 6,
  };
  return headerMap[key];
}

let clusterSizes = {}; // Make this globally accessible within the module

function updateReport(filteredMetadata) {
    const visibleClusterIds = new Set(filteredMetadata.map(d => d.cluster_id));
    const filteredClusterSizes = {};
    visibleClusterIds.forEach(id => {
        filteredClusterSizes[id] = filteredMetadata.filter(d => d.cluster_id === id).length;
    });
    document.getElementById('summary-total-traces').textContent = filteredMetadata.length.toLocaleString();
    document.getElementById('summary-clusters').textContent = visibleClusterIds.size;
    const avgSize = visibleClusterIds.size > 0 ? filteredMetadata.length / visibleClusterIds.size : 0;
    document.getElementById('summary-avg-size').textContent = avgSize.toLocaleString(undefined, {maximumFractionDigits: 0});
    updateBarChart(filteredClusterSizes);
    // If a cluster was selected, re-render it with the filtered data
    if (selectedClusterId !== null && visibleClusterIds.has(selectedClusterId)) {
        renderCluster(selectedClusterId);
    } else {
        // If the selected cluster is filtered out, hide the detail view
        document.getElementById('cluster-detail-view').style.display = 'none';
        selectedClusterId = null;
    }
}
function applyFilters() {
    const selectedPackage = $('#package-filter').val();
    const selectedDevice = $('#device-filter').val();
    const selectedStartupType = $('#startup-type-filter').val();
    const minDuration = parseFloat(document.getElementById('min-duration-filter').value) || 0;
    const maxDuration = parseFloat(document.getElementById('max-duration-filter').value) || Infinity;
    currentMetadata = originalMetadata.filter(d => {
        const packageMatch = !selectedPackage || d.package === selectedPackage;
        const deviceMatch = !selectedDevice || d.device_name === selectedDevice;
        const startupTypeMatch = !selectedStartupType || d.startup_type === selectedStartupType;
        const durationMatch = (d.startup_dur >= minDuration) && (d.startup_dur <= maxDuration);
        return packageMatch && deviceMatch && startupTypeMatch && durationMatch;
    });
    updateReport(currentMetadata);
    generateCrossClusterPlots(); // Regenerate cross-cluster plots with filtered data
}
function populateFilters() {
    const packages = [...new Set(originalMetadata.map(d => d.package))].sort();
    const devices = [...new Set(originalMetadata.map(d => d._device_name))].sort();
    const startupTypes = [...new Set(originalMetadata.map(d => d.startup_type))].sort();
    populateSelect($('#package-filter'), packages);
    populateSelect($('#device-filter'), devices);
    populateSelect($('#startup-type-filter'), startupTypes);
    $('.select2').select2();
}
function populateSelect(selectElement, options) {
    selectElement.append(new Option('All', '', true, true));
    options.forEach(opt => {
        if (opt) {
            selectElement.append(new Option(opt, opt, false, false));
        }
    });
}
function generateCrossClusterPlots() {
    if (!sequences) return;
    const crossClusterContainer = document.getElementById('cross-cluster-plots');
    crossClusterContainer.innerHTML = '';
    // Collect all sequences with their cluster information
    const allSequencesWithClusters = [];
    for (const uuid in sequences) {
        const traceMetadata = currentMetadata.find(m => m.trace_uuid === uuid);
        if (traceMetadata) {
            sequences[uuid].forEach(seq => {
                allSequencesWithClusters.push({
                    ...seq,
                    cluster: traceMetadata.cluster_id,
                    trace_uuid: uuid
                });
            });
        }
    }
    if (allSequencesWithClusters.length === 0) return;
    // Find top slices across all data
    const sliceCounts = d3.rollup(allSequencesWithClusters, v => v.length, d => d.norm_name);
    const topSliceNames = Array.from(sliceCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, topSlices)
        .map(d => d[0]);
    // Create box plots for each top slice showing distribution across clusters
    topSliceNames.forEach(sliceName => {
        const plotDiv = document.createElement('div');
        plotDiv.className = 'plot-container';
        plotDiv.style.marginBottom = '30px';
        crossClusterContainer.appendChild(plotDiv);
        const sliceData = allSequencesWithClusters.filter(d => d.norm_name === sliceName);
        const clusterIds = [...new Set(currentMetadata.map(m => m.cluster_id))].sort((a, b) => a - b);
        const traces = clusterIds.map(clusterId => {
            const clusterSliceData = sliceData.filter(d => d.cluster_id === clusterId);
            return {
                y: clusterSliceData.map(d => d.dur / 1e6),
                type: 'box',
                name: `Cluster ${clusterId}`,
                boxpoints: 'outliers',  // Show outliers only
                boxmean: false,         // Disable mean line
                quartilemethod: 'exclusive'  // Force proper quartile calculation
            };
        }).filter(trace => trace.y.length > 0); // Only include clusters that have this slice
        const layout = {
            title: `${sliceName} - Duration Distribution Across Clusters`,
            yaxis: { title: 'Duration (ms)' },
            xaxis: { title: 'Cluster' },
            showlegend: true
        };
        Plotly.newPlot(plotDiv, traces, layout);
    });
}
$(document).ready(async function() {
    const data = await fetchData();
    if (data) {
      $('.select2').select2();
      populateFilters();
      updateReport(originalMetadata); // Initial draw
      // The cross-cluster plots require a div that is not in the current HTML.
      // generateCrossClusterPlots(); // Generate cross-cluster analysis
      $('#package-filter, #device-filter, #startup-type-filter').on('change', applyFilters);
      $('#min-duration-filter, #max-duration-filter').on('keyup change', applyFilters);
    }
});

document.addEventListener('keydown', (event) => {
  if (selectedClusterId === null) return;

  const prevBtn = document.getElementById('prev-cluster-btn');
  const nextBtn = document.getElementById('next-cluster-btn');

  if (event.key === 'ArrowLeft' && !prevBtn.disabled) {
    prevBtn.click();
  } else if (event.key === 'ArrowRight' && !nextBtn.disabled) {
    nextBtn.click();
  }
});
$(document).on('click', '.sequence-button', function() {
    const uuid = $(this).data('trace-uuid');
    const sequenceData = sequences[uuid];
    if (!sequenceData) {
        alert(`Sequence data not loaded. To load it, run:\n\npython tools/duck_db.py --db {duckdb_path} "SELECT * FROM {table_name} WHERE _trace_uuid='${uuid}'"`);
        return;
    }
    const tr = $(this).closest('tr');
    // Check if this specific row's chart is already open
    if (tr.next().hasClass('sequence-row') && tr.next().data('trace-uuid') === uuid) {
        tr.next().remove();
        $(this).text('Show');
        return;
    }
    // If there's an existing chart row for this trace, remove it first
    if (tr.next().hasClass('sequence-row') && tr.next().data('trace-uuid') === uuid) {
        tr.next().remove();
    }
    $(this).text('Hide');
    const durationData = Array.from(d3.rollup(sequenceData, v => d3.sum(v, d => d.dur), d => d.norm_name), ([name, value]) => ({name, value})).sort((a, b) => b.value - a.value);
    const countData = Array.from(d3.rollup(sequenceData, v => v.length, d => d.norm_name), ([name, value]) => ({name, value})).sort((a, b) => b.value - a.value);
    const allTokens = [...new Set(sequenceData.map(d => d.norm_name))];
    const colorScale = d3.scaleOrdinal(d3.schemeCategory10).domain(allTokens);
    const subRow = $('<tr class="sequence-row"><td colspan="8"></td></tr>').insertAfter(tr);
    subRow.data('trace-uuid', uuid);  // Mark which trace this row belongs to
    const container = subRow.find('td');
    const chartId = 'chart-' + uuid;  // Unique ID for this trace's charts
    container.html(`<div class="sequence-chart-container"><div class="chart-wrapper" id="${chartId}-duration"></div><div class="chart-wrapper" id="${chartId}-count"></div></div>`);
    createBarChart(`#${chartId}-duration`, durationData, 'Total Duration (ms)', colorScale, 'duration');
    createBarChart(`#${chartId}-count`, countData, 'Event Count', colorScale, 'count');
});
function createBarChart(selector, data, title, colorScale, formatType) {
    const margin = {top: 30, right: 20, bottom: 40, left: 250};
    const barHeight = 25;
    const height = data.length * barHeight;
    const width = $(selector).width() - margin.left - margin.right;
    const svg = d3.select(selector).append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
      .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);
    svg.append("text")
        .attr("x", width / 2)
        .attr("y", 0 - (margin.top / 2))
        .attr("text-anchor", "middle")
        .style("font-size", "16px")
        .text(title);
    const y = d3.scaleBand()
        .range([0, height])
        .domain(data.map(d => d.name))
        .padding(0.1);
    const x = d3.scaleLinear()
        .domain([0, d3.max(data, d => d.value)])
        .range([0, width]);
    svg.append("g")
        .call(d3.axisLeft(y));
    let xFormat;
    if (formatType === 'duration') {
        xFormat = d => `${(d/1e6).toFixed(0)}ms`;
    } else {
        xFormat = d => d;
    }
    svg.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x).ticks(5).tickFormat(xFormat));
    const tooltip = d3.select("body").append("div")
        .attr("class", "tooltip")
        .style("opacity", 0);
    svg.selectAll(".bar")
        .data(data)
        .enter().append("rect")
        .attr("class", "bar")
        .attr("y", d => y(d.name))
        .attr("height", y.bandwidth())
        .attr("x", 0)
        .attr("width", d => x(d.value))
        .attr("fill", d => colorScale(d.name))
        .on("mouseover", function(event, d) {
            tooltip.transition().duration(200).style("opacity", .9);
            tooltip.html(`${d.name}<br/>${d.value.toLocaleString()}`)
                .style("left", (event.pageX) + "px")
                .style("top", (event.pageY - 28) + "px");
        })
        .on("mouseout", function(d) {
            tooltip.transition().duration(500).style("opacity", 0);
        });
}
// --- D3 Visualization ---
const plotContainer = d3.select("#cluster-plot");
const margin = {top: 20, right: 20, bottom: 30, left: 40};
const width = plotContainer.node().getBoundingClientRect().width - margin.left - margin.right;
const height = 400 - margin.top - margin.bottom;
const svg = plotContainer.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

function updateBarChart(sizes) {
    clusterSizes = sizes; // Update global variable
    svg.selectAll("*").remove();
    const sortedClusters = Object.entries(clusterSizes)
        .map(([id, size]) => ({cluster_id: parseInt(id), size: size}))
        .sort((a, b) => b.size - a.size);
    const x = d3.scaleBand()
        .range([0, width])
        .domain(sortedClusters.map(d => d.cluster_id))
        .padding(0.2);
    const y = d3.scaleLinear()
        .domain([0, d3.max(sortedClusters, d => d.size) || 1])
        .range([height, 0]);
    svg.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x));
    svg.append("g")
        .call(d3.axisLeft(y));
    svg.selectAll(".bar")
        .data(sortedClusters)
        .enter().append("rect")
        .attr("class", "bar")
        .attr("x", d => x(d.cluster_id))
        .attr("width", x.bandwidth())
        .attr("y", d => y(d.size))
        .attr("height", d => height - y(d.size))
        .attr("fill", "#1a73e8")
        .style("cursor", "pointer")
        .on("click", (event, d) => {
            renderCluster(d.cluster_id);
        })
        .classed("selected", d => d.cluster_id === selectedClusterId);
}