import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
import os
import argparse

# Set up argument parser
parser = argparse.ArgumentParser(description='Convert a DuckDB table to a Parquet file and generate a config file.')
parser.add_argument('db_path', type=str, help='Path to the DuckDB database file.')
parser.add_argument('table_name', type=str, help='Name of the table to convert.')
parser.add_argument('--x', type=str, required=True, help='The column to use for the x-axis.')
parser.add_argument('--y', type=str, required=True, help='The column to use for the y-axis.')
parser.add_argument('--where', type=str, help='An optional WHERE clause to filter the data.')
parser.add_argument('--tile_size', type=int, default=10000, help='The number of rows per tile.')
args = parser.parse_args()

# Connect to the DuckDB database
db_path = os.path.expanduser(args.db_path)
con = duckdb.connect(database=db_path, read_only=True)
con.execute("SET arrow_large_buffer_size=true")

# Get table schema
schema_query = f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '{args.table_name}'"
schema = con.execute(schema_query).fetchall()

# Generate columns list for config.json with renamed x/y columns
config_columns = []
select_expressions = []
for col_name, col_type in schema:
    is_numeric = col_type in ['BIGINT', 'DOUBLE', 'INTEGER', 'FLOAT', 'DECIMAL', 'REAL']
    
    # Use 'x' and 'y' in config for renamed columns
    if col_name == args.x:
        config_columns.append({"name": "x", "numeric": is_numeric})
        select_expressions.append(f'"{col_name}" AS x')
    elif col_name == args.y:
        config_columns.append({"name": "y", "numeric": is_numeric})
        select_expressions.append(f'"{col_name}" AS y')
    else:
        config_columns.append({"name": col_name, "numeric": is_numeric})
        select_expressions.append(f'"{col_name}"')

print("Generated column configuration with auto-detected types")

# Query the table
select_clause = ", ".join(select_expressions)
query = f"SELECT {select_clause} FROM {args.table_name}"
# Add the WHERE clause if it's provided
if args.where:
    query += f" WHERE {args.where}"

result = con.execute(query).fetch_arrow_table()

# Invert y-axis
df = result.to_pandas()
y_min = df['y'].min()
y_max = df['y'].max()
df['y'] = y_max - (df['y'] - y_min)
result = pa.Table.from_pandas(df)

print("Inverted y-axis")

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
    
    # Write config.json to tiles directory
    import json
    config_json = {
        "columns": config_columns
    }
    
    os.makedirs('tiles', exist_ok=True)
    with open('tiles/config.json', 'w') as f:
        json.dump(config_json, f, indent=2)
    
    print("Generated tiles/config.json with auto-detected column types")
