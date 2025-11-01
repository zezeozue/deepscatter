import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
import os
import argparse

# Set up argument parser
parser = argparse.ArgumentParser(description='Convert a DuckDB table to a Parquet file.')
parser.add_argument('db_path', type=str, help='Path to the DuckDB database file.')
parser.add_argument('table_name', type=str, help='Name of the table to convert.')
args = parser.parse_args()

# Connect to the DuckDB database
db_path = os.path.expanduser(args.db_path)
con = duckdb.connect(database=db_path, read_only=True)

# Query the table
query = f"""
SELECT
    x,
    y,
    cluster_id as class,
    trace_uuid,
    _device_name,
    _build_id,
    startup_type,
    startup_dur,
    package,
    NTILE(10) OVER (ORDER BY startup_dur) as startup_speed
FROM {args.table_name}
"""
result = con.execute(query).fetch_arrow_table()

# Write the result to a Parquet file
pq.write_table(result, 'f1_data.parquet')

print(f"Successfully converted data from table '{args.table_name}' to f1_data.parquet")
