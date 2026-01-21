import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
import os
import argparse
import subprocess
import json
import pyarrow.feather as feather

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
    config_json = {
        "columns": config_columns
    }
    
    os.makedirs('tiles', exist_ok=True)
    with open('tiles/config.json', 'w') as f:
        json.dump(config_json, f, indent=2)
    
    print("Generated tiles/config.json with auto-detected column types")

    # Post-processing: Fix metadata and file format
    def fix_tiles(tiles_dir):
        print("Post-processing tiles to ensure metadata and compatibility...")
        for root, dirs, files in os.walk(tiles_dir):
            for file in files:
                if file.endswith(".feather"):
                    path = os.path.join(root, file)
                    
                    # Parse key from path (e.g. tiles/0/0/0.feather -> 0/0/0)
                    rel_path = os.path.relpath(path, tiles_dir)
                    key = rel_path.replace('.feather', '')
                    parts = key.split('/')
                    if len(parts) != 3: 
                        continue
                    
                    try:
                        z, x, y = map(int, parts)
                    except ValueError:
                        continue
                    
                    # Check for children
                    children = []
                    for dx in [0, 1]:
                        for dy in [0, 1]:
                            cz, cx, cy = z + 1, x * 2 + dx, y * 2 + dy
                            child_path = os.path.join(tiles_dir, str(cz), str(cx), f"{cy}.feather")
                            if os.path.exists(child_path):
                                children.append(f"{cz}/{cx}/{cy}")
                    
                    # Read table
                    try:
                        table = feather.read_table(path)
                    except Exception as e:
                        print(f"Error reading {path}: {e}. Skipping.")
                        continue

                    # Update metadata
                    existing_meta = table.schema.metadata or {}
                    new_meta = {k.decode() if isinstance(k, bytes) else k : v for k, v in existing_meta.items()}
                    
                    meta_json = {}
                    if 'json' in new_meta:
                        try:
                            meta_json = json.loads(new_meta['json'])
                        except:
                            pass
                    
                    if children:
                        meta_json['children'] = children
                    else:
                        if 'children' in meta_json:
                            del meta_json['children']
                            
                    new_meta['json'] = json.dumps(meta_json)

                    # Replace schema and write back uncompressed
                    new_table = table.replace_schema_metadata(new_meta)
                    
                    try:
                        feather.write_feather(new_table, path, compression='uncompressed')
                    except Exception as e:
                        print(f"Error writing {path}: {e}")

    fix_tiles('tiles')
    print("Tile post-processing complete.")
