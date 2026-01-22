import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import argparse
import subprocess
import os
import json
import pyarrow.feather as feather

# Set up argument parser
parser = argparse.ArgumentParser(description='Convert a CSV/TSV/JSON file to a Parquet file, generate a config, and create tiles.')
parser.add_argument('file_path', type=str, help='Path to the CSV, TSV, or JSON file.')
parser.add_argument('--x', type=str, required=True, help='The column to use for the x-axis.')
parser.add_argument('--y', type=str, required=True, help='The column to use for the y-axis.')
parser.add_argument('--tile_size', type=int, default=10000, help='The number of rows per tile.')
parser.add_argument('--categorical', type=str, help='Comma-separated list of categorical column names to index.')
parser.add_argument('--default_column', type=str, help='Default column for color/filter selectors (must be numeric or categorical).')
args = parser.parse_args()

# Read file and infer schema based on extension
file_path = os.path.expanduser(args.file_path)
file_ext = os.path.splitext(file_path)[1].lower()

if file_ext == '.json':
    df = pd.read_json(file_path)
elif file_ext == '.tsv':
    df = pd.read_csv(file_path, sep='\t')
else:
    # Default to CSV
    df = pd.read_csv(file_path)

# Rename columns for x and y BEFORE generating schema
df = df.rename(columns={args.x: 'x', args.y: 'y'})

# Generate schema from renamed dataframe
schema = pa.Schema.from_pandas(df)

# Parse categorical columns
categorical_cols = set()
if args.categorical:
    categorical_cols = set(col.strip() for col in args.categorical.split(','))
    # Rename x/y if they were specified as categorical
    if args.x in categorical_cols:
        categorical_cols.remove(args.x)
        categorical_cols.add('x')
    if args.y in categorical_cols:
        categorical_cols.remove(args.y)
        categorical_cols.add('y')

# Generate columns list for config.json with min/max for numeric columns
config_columns = []
for field in schema:
    is_numeric = field.type in [pa.int64(), pa.int32(), pa.int16(), pa.int8(), pa.float64(), pa.float32(), pa.float16()]
    is_categorical = field.name in categorical_cols
    
    col_config = {
        "name": field.name,
        "numeric": is_numeric,
        "categorical": is_categorical,
    }
    
    # Add min/max for numeric columns
    if is_numeric and field.name in df.columns:
        col_min = float(df[field.name].min())
        col_max = float(df[field.name].max())
        col_config["min"] = col_min
        col_config["max"] = col_max
        print(f"Column {field.name}: min={col_min}, max={col_max}, count={len(df[field.name])}")
    
    # Add unique values for categorical columns (if reasonable size)
    if is_categorical and field.name in df.columns:
        unique_vals = df[field.name].unique()
        if len(unique_vals) <= 1000:  # Only store if <= 1000 unique values
            col_config["categories"] = sorted([str(v) for v in unique_vals])
        col_config["num_categories"] = len(unique_vals)
    
    config_columns.append(col_config)

print("Generated column configuration with auto-detected types, min/max values, and categorical metadata")

# Normalize x and y to [0, 1] range for better float precision
x_min = df['x'].min()
x_max = df['x'].max()
y_min = df['y'].min()
y_max = df['y'].max()

x_range = x_max - x_min
y_range = y_max - y_min

if x_range > 0:
    df['x'] = (df['x'] - x_min) / x_range
else:
    df['x'] = 0

if y_range > 0:
    # Normalize and invert y-axis
    df['y'] = 1.0 - ((df['y'] - y_min) / y_range)
else:
    df['y'] = 0

print(f"Normalized coordinates: x [{x_min}, {x_max}] -> [0, 1], y [{y_min}, {y_max}] -> [0, 1] (inverted)")

# Convert to Arrow Table and write to Parquet
table = pa.Table.from_pandas(df)
pq.write_table(table, 'f1_data.parquet')

print(f"Successfully converted data from '{args.file_path}' to f1_data.parquet")

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
    
    # Add default column if specified
    if args.default_column:
        # Rename if it was x or y
        default_col = args.default_column
        if default_col == args.x:
            default_col = 'x'
        elif default_col == args.y:
            default_col = 'y'
        
        # Verify it exists and is numeric or categorical
        col_exists = any(c['name'] == default_col for c in config_columns)
        if col_exists:
            col_info = next(c for c in config_columns if c['name'] == default_col)
            if col_info['numeric'] or col_info['categorical']:
                config_json['default_column'] = default_col
                print(f"Set default column to: {default_col}")
            else:
                print(f"Warning: {default_col} is not numeric or categorical, skipping default_column")
        else:
            print(f"Warning: {default_col} not found in columns, skipping default_column")
    
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
