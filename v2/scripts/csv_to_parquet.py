import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import argparse
import subprocess
import os
import json
import pyarrow.feather as feather

# Set up argument parser
parser = argparse.ArgumentParser(description='Convert a CSV file to a Parquet file, generate a config, and create tiles.')
parser.add_argument('csv_path', type=str, help='Path to the CSV file.')
parser.add_argument('--x', type=str, required=True, help='The column to use for the x-axis.')
parser.add_argument('--y', type=str, required=True, help='The column to use for the y-axis.')
parser.add_argument('--tile_size', type=int, default=10000, help='The number of rows per tile.')
args = parser.parse_args()

# Read CSV and infer schema
csv_path = os.path.expanduser(args.csv_path)
df = pd.read_csv(csv_path)

# Rename columns for x and y BEFORE generating schema
df = df.rename(columns={args.x: 'x', args.y: 'y'})

# Generate schema from renamed dataframe
schema = pa.Schema.from_pandas(df)

# Generate columns list for config.json
config_columns = []
for field in schema:
    is_numeric = field.type in [pa.int64(), pa.int32(), pa.int16(), pa.int8(), pa.float64(), pa.float32(), pa.float16()]
    config_columns.append({
        "name": field.name,
        "numeric": is_numeric,
    })

print("Generated column configuration with auto-detected types")

# Invert y-axis
y_min = df['y'].min()
y_max = df['y'].max()
df['y'] = y_max - (df['y'] - y_min)

print("Inverted y-axis")

# Convert to Arrow Table and write to Parquet
table = pa.Table.from_pandas(df)
pq.write_table(table, 'f1_data.parquet')

print(f"Successfully converted data from '{args.csv_path}' to f1_data.parquet")

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
                    # Handle windows paths if necessary, but we are on linux
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
                    # Ensure keys are decoded
                    new_meta = {k.decode() if isinstance(k, bytes) else k : v for k, v in existing_meta.items()}
                    
                    # Update json metadata
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
                        # Write uncompressed for max compatibility
                        feather.write_feather(new_table, path, compression='uncompressed')
                        # print(f"Fixed {key}: {len(children)} children")
                    except Exception as e:
                        print(f"Error writing {path}: {e}")

    fix_tiles('tiles')
    print("Tile post-processing complete.")
