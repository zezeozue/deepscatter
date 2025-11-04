import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
import os
import argparse

# Set up argument parser
parser = argparse.ArgumentParser(description='Convert a DuckDB table to a Parquet file.')
parser.add_argument('db_path', type=str, help='Path to the DuckDB database file.')
parser.add_argument('table_name', type=str, help='Name of the table to convert.')
parser.add_argument('--where', type=str, help='An optional WHERE clause to filter the data.')
parser.add_argument('--tile_size', type=int, default=10000, help='The number of rows per tile.')
parser.add_argument('--fetch-svg', action='store_true', help='Fetch the SVG column.')
args = parser.parse_args()

# Connect to the DuckDB database
db_path = os.path.expanduser(args.db_path)
con = duckdb.connect(database=db_path, read_only=True)

# Query the table
query = f"""
WITH Durations AS (
    SELECT
        min(startup_dur) as min_dur,
        max(startup_dur) as max_dur
    FROM {args.table_name}
)
SELECT
    t.x,
    t.y,
    t.cluster_id as og_cluster,
    t.trace_uuid,
    t._device_name,
    t._build_id,
    t.startup_type AS event_type,
    t.startup_dur AS dur,
    t.package,
    {'t.svg,' if args.fetch_svg else ''}
    CAST(FLOOR(10 * (t.startup_dur - d.min_dur) / (d.max_dur - d.min_dur)) + 1 AS INTEGER) as class
FROM {args.table_name} t, Durations d
"""
# Add the WHERE clause if it's provided
if args.where:
    query += f" WHERE {args.where}"

result = con.execute(query).fetch_arrow_table()

# Write the result to a Parquet file
pq.write_table(result, 'f1_data.parquet')

import subprocess

print(f"Successfully converted data from table '{args.table_name}' to f1_data.parquet")

# Execute the quadfeather command
quadfeather_command = f".venv/bin/quadfeather --files f1_data.parquet --tile_size {args.tile_size} --destination tiles"

print(f"Executing command: {quadfeather_command}")
process = subprocess.Popen(quadfeather_command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
stdout, stderr = process.communicate()

if process.returncode != 0:
    print(f"Error executing quadfeather: {stderr.decode('utf-8')}")
else:
    print("Quadfeather command executed successfully.")
