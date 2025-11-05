from flask import Flask, jsonify
import duckdb
import pandas as pd
import os
import argparse
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

app = Flask(__name__)

# Global variables to hold database path and table name
DB_PATH = None
TABLE_NAME = None

@app.route('/cluster_analysis')
def get_cluster_analysis():
    logging.info("Received request for /cluster_analysis")
    if not DB_PATH or not TABLE_NAME:
        logging.error("Database path and table name not configured.")
        return jsonify({"error": "Database path and table name not configured."}), 500

    if not os.path.exists(DB_PATH):
        logging.error(f"Database file not found at {DB_PATH}")
        return jsonify({"error": f"Database file not found at {DB_PATH}"}), 404

    try:
        logging.info(f"Connecting to database: {DB_PATH}")
        con = duckdb.connect(database=DB_PATH, read_only=True)
        
        # Check if table exists
        tables = con.execute("SHOW TABLES;").fetchdf()
        if TABLE_NAME not in tables['name'].values:
            logging.error(f"Table '{TABLE_NAME}' not found in the database.")
            return jsonify({"error": f"Table '{TABLE_NAME}' not found in the database."}), 404

        # Fetch metadata
        logging.info(f"Fetching data from table: {TABLE_NAME}")
        metadata_df = con.execute(f"SELECT * FROM {TABLE_NAME}").fetchdf()
        logging.info(f"Fetched {len(metadata_df)} rows from the database.")

        # Drop rows where cluster_id is NaN or null to prevent a 'NaN' cluster
        # Explicitly filter out rows where cluster_id is null or NaN
        initial_rows = len(metadata_df)
        metadata_df = metadata_df[metadata_df['cluster_id'].notna()]
        rows_dropped = initial_rows - len(metadata_df)
        if rows_dropped > 0:
            logging.warning(f"Dropped {rows_dropped} rows because cluster_id was null.")

        if len(metadata_df) == 0:
            logging.warning("No valid cluster data found after filtering nulls.")
            # Return empty but valid data to the frontend
            return jsonify({
                "metadata": [], "clusterAnalysis": [], "sequences": {}, "boxplotData": {},
                "totalTraces": 0, "numClusters": 0, "avgClusterSize": 0,
                "timestamp": pd.Timestamp.now().isoformat(), "resultsDir": "from_duckdb",
                "silhouette": "N/A", "calinski": "N/A"
            })

        logging.info(f"Unique cluster_id values after filtering: {metadata_df['cluster_id'].unique()}")
        
        # Perform analysis similar to the Python script
        analysis = metadata_df.groupby('cluster_id').agg(
            avg_startup_dur=('startup_dur', 'mean'),
            p50_startup_dur=('startup_dur', lambda x: x.quantile(0.50)),
            p90_startup_dur=('startup_dur', lambda x: x.quantile(0.90)),
            p99_startup_dur=('startup_dur', lambda x: x.quantile(0.99)),
            unique_packages=('package', 'nunique'),
            unique_devices=('_device_name', 'nunique'),
            unique_build_ids=('_build_id', 'nunique')
        ).reset_index()

        # For sequences and boxplot data, you would need to join with another table
        # This is a simplified example
        sequences = {}
        boxplot_data = {}

        # Summary stats
        total_traces = len(metadata_df)
        num_clusters = metadata_df['cluster_id'].nunique()
        avg_cluster_size = total_traces / num_clusters if num_clusters > 0 else 0

        con.close()
        logging.info("Successfully processed data and closing database connection.")

        return jsonify({
            "metadata": metadata_df.to_dict(orient='records'),
            "clusterAnalysis": analysis.to_dict(orient='records'),
            "sequences": sequences,
            "boxplotData": boxplot_data,
            "maxPerCluster": 10,
            "topSlices": 10,
            "showAllUnique": False,
            "timestamp": pd.Timestamp.now().isoformat(),
            "resultsDir": "from_duckdb",
            "totalTraces": total_traces,
            "numClusters": num_clusters,
            "avgClusterSize": avg_cluster_size,
            "silhouette": "N/A", # Placeholder
            "calinski": "N/A" # Placeholder
        })

    except Exception as e:
        logging.error(f"An error occurred: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Flask server for cluster analysis')
    parser.add_argument('db_path', type=str, help='Path to the DuckDB database file')
    parser.add_argument('table_name', type=str, help='Name of the table with cluster data')
    parser.add_argument('--port', type=int, default=5001, help='Port to run the server on')
    args = parser.parse_args()

    DB_PATH = os.path.expanduser(args.db_path)
    TABLE_NAME = args.table_name

    print(f" * Starting server for {DB_PATH} on table {TABLE_NAME}")
    app.run(debug=True, port=args.port)