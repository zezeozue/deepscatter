import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import argparse
import subprocess
import os

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
    import json
    config_json = {
        "columns": config_columns
    }
    
    os.makedirs('tiles', exist_ok=True)
    with open('tiles/config.json', 'w') as f:
        json.dump(config_json, f, indent=2)
    
    print("Generated tiles/config.json with auto-detected column types")
