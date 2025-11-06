import express from 'express';
import duckdb from 'duckdb';
import { promisify } from 'util';
import path from 'path';

// --- Environment Variable Parsing ---
const dbPath = process.env.DB_PATH;
const tableName = process.env.TABLE_NAME;

if (!dbPath || !tableName) {
  console.error('Error: DB_PATH and TABLE_NAME environment variables must be set.');
  // We don't exit here because Vite will continue to run.
  // The server will just return an error if the endpoint is hit.
} else {
  console.log(` * Server configured for database: ${dbPath}`);
  console.log(` * Table: ${tableName}`);
}

console.log(` * Starting server for ${dbPath} on table ${tableName}`);

// --- Database and Express Setup ---
const app = express();
const db = new duckdb.Database(dbPath, { access_mode: 'READ_ONLY' });
const dbAll = promisify(db.all).bind(db);

app.get('/cluster_analysis', async (req, res) => {
  console.log('--- Handling /cluster_analysis request ---');
  console.log('Request query:', req.query);
  try {
    if (!dbPath || !tableName) {
      console.error('Database path or table name is not set.');
      return res.status(500).json({ error: 'Server configuration error.' });
    }
    
    let whereClauses = ['cluster_id IS NOT NULL'];
    const queryParams = [];
    
    for (const [key, value] of Object.entries(req.query)) {
      if (key === 'min_startup_dur') {
        whereClauses.push('startup_dur >= ?');
        queryParams.push(Number(value));
      } else if (key === 'max_startup_dur') {
        whereClauses.push('startup_dur <= ?');
        queryParams.push(Number(value));
      } else {
        if (key !== 'initial') {
          whereClauses.push(`${key} = ?`);
          queryParams.push(value);
        }
      }
    }
    
    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    if (req.query.initial === 'true') {
      // --- Initial Load: Fetch aggregated data only ---
      const aggQuery = `
        SELECT
          COUNT(*) as totalTraces,
          COUNT(DISTINCT cluster_id) as numClusters,
          AVG(startup_dur) as avg_startup_dur,
          APPROX_QUANTILE(startup_dur, 0.5) as p50_startup_dur,
          APPROX_QUANTILE(startup_dur, 0.9) as p90_startup_dur,
          APPROX_QUANTILE(startup_dur, 0.99) as p99_startup_dur
        FROM ${tableName}
        ${whereClause}
      `;
      console.log(`Querying table with aggregation: ${aggQuery}`);
      const summary = await dbAll(aggQuery, ...queryParams);
      const clusterAnalysisQuery = `
        SELECT
            cluster_id,
            COUNT(*) as num_traces,
            AVG(startup_dur) as avg_startup_dur,
            APPROX_QUANTILE(startup_dur, 0.5) as p50_startup_dur,
            APPROX_QUANTILE(startup_dur, 0.9) as p90_startup_dur,
            APPROX_QUANTILE(startup_dur, 0.99) as p99_startup_dur,
            COUNT(DISTINCT package) as unique_packages,
            COUNT(DISTINCT _device_name) as unique_devices,
            COUNT(DISTINCT _build_id) as unique_build_ids
        FROM ${tableName}
        ${whereClause}
        GROUP BY cluster_id
        ORDER BY num_traces DESC
      `;
      console.log(`Querying cluster analysis: ${clusterAnalysisQuery}`);
      const clusterAnalysis = await dbAll(clusterAnalysisQuery, ...queryParams);

      const filterOptions = {};
      const filterableColumns = ['package', '_device_name', '_build_id', 'startup_type']; // Add other filterable columns here
      for (const col of filterableColumns) {
        const distinctValuesQuery = `SELECT DISTINCT ${col} FROM ${tableName} WHERE ${col} IS NOT NULL ORDER BY ${col}`;
        const values = await dbAll(distinctValuesQuery);
        filterOptions[col] = values.map(v => v[col]);
      }

      const totalTraces = summary[0].totalTraces;
      const numClusters = summary[0].numClusters;
      const avgClusterSize = totalTraces / numClusters;
      const convertBigInts = (obj) => {
        for (const key in obj) {
            if (typeof obj[key] === 'bigint') {
            obj[key] = Number(obj[key]);
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            convertBigInts(obj[key]);
            }
        }
        return obj;
        };
      return res.json(convertBigInts({
        metadata: [], // No metadata on initial load
        clusterAnalysis,
        sequences: {},
        boxplotData: {},
        totalTraces,
        numClusters,
        avgClusterSize,
        timestamp: new Date().toISOString(),
        resultsDir: "from_duckdb",
        silhouette: "N/A",
        calinski: "N/A",
        filterOptions
      }));

    } else {
      // --- Full Data Load ---
      const query = `SELECT * FROM ${tableName} ${whereClause}`;
      console.log(`Querying table: ${tableName} with query: ${query} and params: ${queryParams}`);
      const metadata = await dbAll(query, ...queryParams);
      console.log(`Successfully fetched ${metadata.length} rows.`);
      const filteredMetadata = metadata.filter(row => row.cluster_id !== null && row.cluster_id !== undefined);
      if (filteredMetadata.length === 0) {
      return res.json({
        metadata: [], clusterAnalysis: [], sequences: {}, boxplotData: {},
        totalTraces: 0, numClusters: 0, avgClusterSize: 0,
        timestamp: new Date().toISOString(), resultsDir: "from_duckdb",
        silhouette: "N/A", calinski: "N/A"
      });
    }

    // Perform analysis
    const clusterGroups = filteredMetadata.reduce((acc, row) => {
      acc[row.cluster_id] = acc[row.cluster_id] || [];
      acc[row.cluster_id].push(row);
      return acc;
    }, {});

    const clusterAnalysis = Object.entries(clusterGroups).map(([cluster_id, rows]) => {
      const startupDurs = rows.map(r => Number(r.startup_dur));
      const packages = [...new Set(rows.map(r => r.package))];
      const devices = [...new Set(rows.map(r => r._device_name))];
      const builds = [...new Set(rows.map(r => r._build_id))];

      startupDurs.sort((a, b) => a - b);

      return {
        cluster_id: parseInt(cluster_id),
        avg_startup_dur: startupDurs.reduce((a, b) => a + b, 0) / startupDurs.length,
        p50_startup_dur: startupDurs[Math.floor(startupDurs.length * 0.5)],
        p90_startup_dur: startupDurs[Math.floor(startupDurs.length * 0.9)],
        p99_startup_dur: startupDurs[Math.floor(startupDurs.length * 0.99)],
        unique_packages: packages.length,
        unique_devices: devices.length,
        unique_build_ids: builds.length,
      };
    });

    const totalTraces = filteredMetadata.length;
    const numClusters = Object.keys(clusterGroups).length;
    const avgClusterSize = totalTraces / numClusters;

    // Recursively convert BigInts to Numbers for JSON serialization
    const convertBigInts = (obj) => {
      for (const key in obj) {
        if (typeof obj[key] === 'bigint') {
          obj[key] = Number(obj[key]);
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          convertBigInts(obj[key]);
        }
      }
      return obj;
    };

    res.json(convertBigInts({
      metadata: filteredMetadata, // Send full metadata
      clusterAnalysis,
      sequences: {}, // Placeholder
      boxplotData: {}, // Placeholder
      totalTraces,
      numClusters,
      avgClusterSize,
      timestamp: new Date().toISOString(),
      resultsDir: "from_duckdb",
      silhouette: "N/A", // Placeholder
      calinski: "N/A" // Placeholder
    }));
    }
  }
 catch (error) {
    console.error('!!! Critical Error in /cluster_analysis:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

app.get('/cluster_traces/:cluster_id', async (req, res) => {
  const { cluster_id } = req.params;
  try {
    const traces = await dbAll(
      `SELECT * FROM ${tableName} WHERE cluster_id = ? ORDER BY startup_dur`,
      parseInt(cluster_id)
    );
    // Ensure the result is always an array, even if it's null or a single object
    if (!traces) {
      res.json([]);
    } else {
      const result = Array.isArray(traces) ? traces : [traces];
      // Recursively convert BigInts to Numbers for JSON serialization
      const convertBigInts = (obj) => {
        for (const key in obj) {
          if (typeof obj[key] === 'bigint') {
            obj[key] = Number(obj[key]);
          } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            convertBigInts(obj[key]);
          }
        }
        return obj;
      };
      res.json(convertBigInts(result));
    }
  } catch (error) {
    console.error(`Error fetching traces for cluster ${cluster_id}:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default app;