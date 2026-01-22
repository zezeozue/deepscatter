# Deepscatter V2 - Architecture Documentation

## Overview

Deepscatter V2 is a high-performance WebGL-based scatterplot visualization tool designed for exploring large datasets (millions of points). It uses a tile-based rendering system for efficient data loading and rendering.

**Key Differences from V1 (root version):**
- **V1**: Uses Regl (WebGL wrapper library)
- **V2**: Uses raw WebGL (no wrapper, direct GPU control)
- **Why V2**: Smaller bundle size, more control, slightly faster
- **Trade-off**: V2 code is more verbose but more optimized

## Quick Start for Beginners

**What is this?**
- A tool to visualize millions of data points as a scatterplot
- Uses your GPU (graphics card) to draw points super fast
- Can handle datasets too large to fit in Excel

**How it works:**
1. **Data**: Your CSV/Parquet file with X, Y coordinates
2. **Tiling** (optional): Quadfeather splits large files into chunks
3. **Loading**: Browser loads only visible chunks
4. **Rendering**: GPU draws points as colored dots
5. **Interaction**: Pan, zoom, select regions, filter data

## Architecture

### Core Components

```
v2/
├── main.ts                 # Application entry point, UI orchestration
├── index.html             # HTML structure and inline UI logic
├── styles.css             # Application styling
└── src/
    ├── core/
    │   └── scatter_gl.ts  # Main visualization controller
    ├── rendering/
    │   ├── renderer.ts    # WebGL rendering engine
    │   └── buffer_pool.ts # GPU buffer management
    ├── data/
    │   ├── tile_store.ts  # Tile loading and caching
    │   ├── tile.ts        # Tile data structure
    │   └── tile_loader.ts # Async tile loading
    ├── interaction/
    │   └── controller.ts  # Mouse/touch interaction handling
    └── aesthetics/
        ├── color_manager.ts  # Color encoding logic
        ├── filter_manager.ts # Data filtering logic
        ├── legend.ts         # Legend rendering
        └── scales.ts         # D3-style scales
```

### Key Libraries

1. **Raw WebGL** (native browser API)
   - Purpose: GPU-accelerated rendering
   - Used for: Drawing millions of points at 60fps
   - Implementation: Custom shaders, direct WebGL calls
   - Why: Maximum control, smallest bundle size, best performance
   - Trade-off: More verbose than using a wrapper like Regl

2. **Apache Arrow** (`apache-arrow`)
   - Purpose: Efficient columnar data format and in-memory analytics
   - Used for: Storing and accessing point data in tiles
   - Why: Zero-copy data access, memory efficient, blazing fast
   - **Bundle size**: ~200KB minified (worth it for the performance)
   
   **Arrow Terminology Explained:**
   
   | Term | What It Is | Example |
   |------|------------|---------|
   | **Arrow Table** | In-memory data structure (like a DataFrame) | `const table = new Table({x: [...], y: [...]})` |
   | **Arrow IPC** | File format for saving/loading Arrow Tables | `0.arrow`, `0-0.arrow` (binary files) |
   | **Tile** | One chunk of spatial data (our concept, not Arrow's) | "Top-left quadrant of the map" |
   | **Arrow IPC File** | A tile saved to disk in Arrow format | `tiles/0-0.arrow` contains one tile's data |
   
   **Relationship:**
   ```
   Arrow Table (in memory) ←→ Arrow IPC File (on disk)
                ↓
           Contains data for one Tile (spatial region)
   ```
   
   **What Arrow Provides:**
   - **Columnar Storage**: Data organized by column (all X values together, all Y values together)
   - **Zero-Copy Reads**: Access data directly in memory without parsing/copying
   - **Type System**: Strongly typed columns (Float32, Int32, Utf8, etc.)
   - **Interoperability**: Same format used by Pandas, Polars, DuckDB, Spark
   - **Compression**: Efficient binary format, much smaller than JSON/CSV
   
   **Example:**
   ```typescript
   // Without Arrow (traditional approach)
   const data = JSON.parse(csvText); // Parse entire file
   const x = data.map(row => row.x); // Copy all X values
   const y = data.map(row => row.y); // Copy all Y values
   // Memory: 3x the data size (original + x array + y array)
   
   // With Arrow (zero-copy)
   const table = await Table.from(arrowFile);
   const xColumn = table.getChild('x'); // Just a pointer!
   const yColumn = table.getChild('y'); // Just a pointer!
   const xValue = xColumn.get(0); // Direct memory access
   // Memory: 1x the data size (no copies)
   ```
   
   **Performance Impact:**
   - **10-100x faster** than JSON parsing
   - **50% smaller** than JSON on disk
   - **Instant access** to any column without scanning entire dataset
   - **GPU-friendly**: Can upload directly to WebGL buffers

3. **Vega-Embed** (`vega-embed`)
   - Purpose: Declarative visualization grammar
   - Used for: Rendering charts in the selection panel
   - Why: Quick, beautiful charts without manual D3 coding

4. **D3 Scales** (custom implementation in `scales.ts`)
   - Purpose: Data-to-visual mappings
   - Used for: Color scales, coordinate transforms
   - Why: Standard visualization primitive

5. **Quadfeather** (Python, backend preprocessing)
   - **What it is**: A Python tool that splits large datasets into spatial tiles
   - **What it does**: Reads your data, divides it into a quadtree, writes Arrow IPC files
   - **Why it exists**: Browsers can't load billions of points at once, so we load chunks
   - **Used for**: Converting CSV/Parquet → tiled Arrow IPC format
   - **Alternative**: You could reimplement it in any language (Java, Rust, Go, etc.)

### Why Raw WebGL Instead of Regl?

**V2 uses raw WebGL** for maximum control and performance. Here's the comparison:

**Regl (used in root version):**
- ✅ **Easier**: Declarative API, less boilerplate
- ✅ **Cleaner**: Functional style, automatic state management
- ✅ **Safer**: Validates inputs, prevents common errors
- ⚠️ **Bundle size**: +23KB minified
- ⚠️ **Abstraction**: Hides some WebGL details

**Raw WebGL (used in V2):**
- ✅ **Smaller**: No library overhead
- ✅ **Faster**: Direct GPU control, no abstraction layer
- ✅ **Flexible**: Full access to all WebGL features
- ⚠️ **Verbose**: More code for same functionality
- ⚠️ **Manual**: Must manage state, buffers, shaders yourself

**Example Comparison:**

```typescript
// With Regl (root version)
const drawPoints = regl({
  vert: vertexShader,
  frag: fragmentShader,
  attributes: {
    position: positions,
    color: colors
  },
  count: numPoints
});
drawPoints(); // That's it!

// With Raw WebGL (V2)
const program = gl.createProgram();
gl.attachShader(program, vertexShader);
gl.attachShader(program, fragmentShader);
gl.linkProgram(program);
gl.useProgram(program);

const posBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
// ... 20 more lines of setup ...
gl.drawArrays(gl.POINTS, 0, numPoints);
```

**When to use Regl:**
- Rapid prototyping
- Learning WebGL
- Complex state management
- Multiple render passes

**When to use Raw WebGL:**
- Production apps (smaller bundle)
- Maximum performance needed
- Full control required
- You know WebGL well

**V2's choice**: Raw WebGL because the rendering is relatively simple (just points), performance is critical, and we want the smallest possible bundle.

### Data Flow: Complete Pipeline

**Two Paths: Client-Side vs Backend Tiling**

#### Path 1: Client-Side CSV Import (Small Datasets < 1M points)

```
1. User uploads CSV file
   ↓
2. Browser reads file as text
   ↓
3. JavaScript parses CSV → Array of Objects
   [{x: 1.2, y: 3.4, category: "A"}, ...]
   ↓
4. Convert to Apache Arrow Table
   - Create Float32Array for numeric columns
   - Create Utf8Array for string columns
   - Build Arrow schema
   ↓
5. Store as Single Tile
   - All data in one tile (no spatial partitioning)
   - Calculate min/max for each column
   - Mark string columns as categorical
   ↓
6. Upload to GPU
   - Extract X, Y positions → Float32Array
   - Apply color encoding → RGB Float32Array
   - Create WebGL buffers
   ↓
7. Render
   - Vertex shader transforms positions
   - Fragment shader applies colors
   - Draw all points at once
```

**Limitations:**
- No progressive loading
- No level-of-detail
- Memory limited (~1-2M points max)
- Single zoom level
- **GPU memory limit**: If data > GPU memory, browser crashes or rendering fails

**What happens if data is bigger than GPU?**

Modern GPUs have 2-8GB of VRAM, but browsers limit WebGL to ~1-2GB:

```
GPU Memory Breakdown (1M points):
- Positions (x, y): 8MB (2 × Float32 × 1M)
- Colors (r, g, b): 12MB (3 × Float32 × 1M)
- Picking IDs: 16MB (4 × Float32 × 1M for RGBA)
- Total per 1M points: ~36MB

Maximum with 1GB GPU limit: ~27M points
Maximum with 2GB GPU limit: ~55M points
```

**If you exceed GPU memory:**
1. **Browser crashes** (most common)
2. **WebGL context lost** (recoverable but data lost)
3. **Rendering fails silently** (black screen)
4. **System freezes** (GPU driver crash)

**Solutions:**
1. **Use backend tiling** (recommended for > 1M points)
2. **Downsample client-side** (lose detail)
3. **Implement client-side tiling** (complex, not worth it - see below)
4. **Use WebGL2 + compression** (helps but limited)

**Is Client-Side Tiling Worth It?**

**No, not really.** Here's why:

**Pros of Client-Side Tiling:**
- ✅ No backend preprocessing needed
- ✅ Works with any CSV file
- ✅ User uploads and immediately sees tiled visualization

**Cons of Client-Side Tiling:**
- ❌ **Slow**: Parsing CSV + building quadtree in JavaScript is slow (minutes for 10M points)
- ❌ **Memory intensive**: Must load entire dataset into memory first, then tile it
- ❌ **Browser limits**: Still limited by browser memory (~2-4GB)
- ❌ **No caching**: Tiles not saved, must recompute on every page load
- ❌ **Complex**: Need to implement quadtree splitting, Arrow IPC writing, etc.
- ❌ **Battery drain**: CPU-intensive work on user's device

**When Client-Side Tiling Makes Sense:**
- Dataset is 1-5M points (small enough to parse, big enough to benefit from tiling)
- Users can't run backend preprocessing
- One-time exploration (don't need to reload data)
- You have Web Workers to avoid blocking UI

**Better Alternatives:**
1. **Backend tiling** (best): Preprocess once, serve to many users
2. **Downsample** (simple): Show 1M random points from 10M dataset
3. **Progressive loading** (medium): Load data in chunks, render as you go
4. **Server-side rendering** (overkill): Render on server, stream images

**Recommendation:**
- **< 1M points**: No tiling needed, load directly
- **1-10M points**: Use backend tiling (quadfeather)
- **> 10M points**: Must use backend tiling + consider server-side filtering

**Why single tile is NOT fine for large data:**
- All data must fit in GPU memory at once
- No way to unload/reload parts of data
- Can't zoom in for more detail
- Browser will crash before you hit theoretical limits

#### Path 2: Backend Tiling with Quadfeather (Large Datasets > 1M points)

```
1. Prepare Data (Backend)
   CSV file
   ↓
   (Optional) Convert to Parquet for speed
   python csv_to_parquet.py data.csv → data.parquet
   ↓
2. Run Quadfeather (Backend)
   quadfeather --files data.parquet --tile_size 50000 --destination tiles/
   ↓
   Reads Parquet → Pandas/Polars DataFrame
   ↓
3. Spatial Partitioning (Backend)
   - Calculate data bounds (min_x, max_x, min_y, max_y)
   - Create root tile (downsample to 50K points)
   - Recursively split into quadrants
   - Each quadrant becomes a tile
   ↓
4. Write Arrow IPC Files (Backend)
   tiles/
   ├── 0.arrow          (root, 50K points, all data downsampled)
   ├── 0-0.arrow        (top-left quadrant)
   ├── 0-1.arrow        (top-right quadrant)
   ├── 0-0-0.arrow      (deeper zoom)
   └── config.json      (metadata: bounds, columns, types)
   ↓
5. Serve Tiles (Backend)
   Static file server (nginx, Apache, or simple HTTP server)
   ↓
6. Browser Loads Tiles (Frontend)
   - Fetch config.json
   - Calculate visible tiles based on viewport
   - Load only visible .arrow files
   - Parse Arrow IPC → Arrow Tables
   ↓
7. Cache in Memory (Frontend)
   - Store tiles in TileStore
   - Keep recently used tiles
   - Evict old tiles if memory pressure
   ↓
8. Upload to GPU (Frontend)
   For each visible tile:
   - Extract X, Y → Float32Array
   - Apply color encoding → RGB Float32Array
   - Create WebGL buffers per tile
   ↓
9. Render (Frontend)
   - Loop through visible tiles
   - For each tile: bind buffers, draw points
   - Vertex shader transforms positions
   - Fragment shader applies colors
```

**Advantages:**
- Progressive loading (only visible tiles)
- Level-of-detail (zoom in = more detail)
- Scales to billions of points
- Tiles cached for instant re-display

#### Data Format Comparison

| Stage | Client-Side | Backend Tiling |
|-------|-------------|----------------|
| Input | CSV text | CSV or Parquet |
| Parsing | JavaScript (slow) | Python/Pandas (fast) |
| Storage | Single Arrow Table | Multiple .arrow files |
| Tiling | No | Yes (quadtree) |
| Loading | All at once | Progressive |
| Memory | All data in RAM | Only visible tiles |
| Max Size | ~1-2M points | Billions |

#### Column Metadata Flow

Both paths generate metadata:

```
For each column:
  - name: "category"
  - type: "string" or "float"
  - numeric: true/false
  - If numeric:
      - min: 0.0
      - max: 100.0
  - If categorical:
      - categories: ["A", "B", "C"]
      - num_categories: 3
```

This metadata enables:
- Fast color scale creation (no need to scan data)
- Proper filter UI (numeric range vs categorical dropdown)
- Efficient rendering (pre-computed bounds)

### Rendering Pipeline (WebGL Basics for Beginners)

**What is WebGL?**
- WebGL = Web Graphics Library
- Lets JavaScript talk directly to your GPU (graphics card)
- GPU can process millions of points in parallel (CPU can't)
- Same technology used in video games

**How V2 Renders Points:**

1. **Tile System**: Data is divided into spatial tiles (quadtree structure)
   - Like Google Maps: zoom in = load more detailed tiles
   - Only load tiles you can see on screen

2. **Viewport Culling**: Only visible tiles are loaded/rendered
   - If tile is off-screen, don't load it
   - Saves memory and makes everything faster

3. **GPU Upload**: Point positions and colors uploaded to WebGL buffers
   ```typescript
   // Simplified version of what happens:
   const positions = new Float32Array([x1, y1, x2, y2, ...]); // All X,Y coords
   const colors = new Float32Array([r1, g1, b1, r2, g2, b2, ...]); // RGB colors
   
   // Upload to GPU memory
   gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
   gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
   ```

4. **Shader Rendering**: Custom shaders draw points with transforms
   - **Vertex Shader**: Runs once per point, calculates screen position
   - **Fragment Shader**: Runs once per pixel, determines color
   - Both run on GPU in parallel (millions at once!)
   
   ```glsl
   // Vertex Shader (simplified)
   void main() {
     vec2 position = a_position; // Point's X,Y from data
     vec2 transformed = position * u_scale + u_translate; // Apply zoom/pan
     gl_Position = vec4(transformed, 0.0, 1.0); // Final screen position
     gl_PointSize = 2.0; // How big to draw the point
   }
   
   // Fragment Shader (simplified)
   void main() {
     gl_FragColor = v_color; // Color from data
   }
   ```

5. **Picking**: Separate render pass for mouse hover/click detection
   - Render each point with unique color ID
   - Read pixel color under mouse
   - Map color back to point index
   - Show tooltip for that point

**Key Files:**
- [`renderer.ts`](src/rendering/renderer.ts): WebGL setup, buffer management, draw calls
- [`point.vert`](src/rendering/shaders/point.vert): Vertex shader (position calculation)
- [`point.frag`](src/rendering/shaders/point.frag): Fragment shader (color)
- [`picking.vert/frag`](src/rendering/shaders/picking.vert): Mouse interaction shaders

### State Management

Currently uses **module-level state variables** in `main.ts`:
- `selectionModeActive`: Boolean for selection mode
- `hasActiveSelection`: Boolean for active region
- `currentSelectionData`: Array of selected points
- `selectionDataBounds`: Bounding box of selection

UI state is managed through:
- Direct DOM manipulation
- CSS class toggling
- Event listeners

## Migrating to Mithril

### Effort Assessment: **Medium (2-3 days)**

### What Would Change

#### 1. **UI Components** (Most Work)
Convert inline HTML + event listeners to Mithril components:

```typescript
// Current: Inline HTML + manual event binding
document.getElementById('select-mode-toggle').addEventListener('click', ...)

// With Mithril: Component-based
const SelectModeToggle: m.Component = {
  view: () => m('button.nav-btn', {
    class: selectionModeActive ? 'active' : '',
    onclick: toggleSelectionMode
  }, m('svg', ...))
}
```

**Components to create:**
- `SidePanel` - Main side panel container
- `PointDataPanel` - Tooltip/point info display
- `ColorPanel` - Color encoding controls
- `FilterPanel` - Filter controls
- `SelectModeToggle` - Selection mode button
- `ActionPanel` - Bottom panel for region actions
- `Legend` - Color legend (already separate)

#### 2. **State Management** (Less Work)
Centralize state in a single object:

```typescript
const state = {
  selectionMode: false,
  activeSelection: null,
  hoveredPoint: null,
  // ... etc
}
```

Mithril's `m.redraw()` handles re-rendering when state changes.

#### 3. **What Stays the Same**
- **Core rendering** (`scatter_gl.ts`, `renderer.ts`) - No changes needed
- **Data loading** (`tile_store.ts`, `tile_loader.ts`) - No changes needed
- **WebGL code** - Completely independent of UI framework
- **Arrow data structures** - No changes needed

### Migration Strategy

**Phase 1: Setup** (2-4 hours)
1. Install Mithril: `npm install mithril @types/mithril`
2. Create `src/ui/` directory for components
3. Set up Mithril mount point in `main.ts`

**Phase 2: Component Migration** (1-2 days)
1. Start with simple components (buttons, toggles)
2. Move to complex components (panels with state)
3. Migrate event handlers to component methods
4. Test each component individually

**Phase 3: State Consolidation** (4-6 hours)
1. Create central state object
2. Replace module variables with state references
3. Add state update helpers
4. Connect state changes to `m.redraw()`

**Phase 4: Integration** (4-6 hours)
1. Connect components to ScatterGL instance
2. Test all interactions
3. Fix any rendering issues
4. Clean up old DOM manipulation code

### Benefits of Mithril

✅ **Pros:**
- **Small**: 10KB gzipped (vs React 40KB+)
- **Fast**: Virtual DOM is very efficient
- **Simple**: Hyperscript syntax, no JSX needed
- **TypeScript-friendly**: Good type definitions
- **No build complexity**: Works with existing Vite setup

✅ **Good fit for this project:**
- Lots of UI panels with state
- Complex interactions (selection, filtering, coloring)
- Need for reactive updates
- Want component reusability

⚠️ **Considerations:**
- Learning curve if team unfamiliar with Mithril
- Less ecosystem than React (but you don't need much)
- Hyperscript syntax different from JSX

### Alternative: Keep Current Approach

The current vanilla JS approach is actually **not bad** for this project because:
- Most complexity is in WebGL rendering (framework-agnostic)
- UI is relatively simple (panels, buttons, selectors)
- Performance is already excellent
- No framework lock-in

**When to migrate:**
- UI becomes more complex (modals, forms, wizards)
- Need component reusability across projects
- Team prefers component-based development
- Want better state management

### Recommendation

**Do it now if:**
- You plan to add more UI features (settings panel, export wizard, etc.)
- You want cleaner, more maintainable UI code
- You're comfortable with Mithril or willing to learn

**Wait if:**
- Current UI meets all needs
- No major UI features planned
- Team prefers vanilla JS
- Want to minimize dependencies

The migration is **not urgent** but would make future UI development easier. The core rendering architecture is solid and framework-independent, so you can migrate the UI layer without touching the visualization engine.

## Development

### Running Locally
```bash
cd v2
npm install
npm run dev
```

### Building for Production
```bash
npm run build
```

### Project Structure Best Practices

1. **Keep rendering separate from UI**: ScatterGL should never import UI components
2. **Use events for communication**: ScatterGL emits events, UI listens
3. **Centralize state**: Whether vanilla or Mithril, keep state in one place
4. **Type everything**: TypeScript prevents many bugs in complex interactions

## Data Capacity & Performance

### Client-Side Limits

- **Optimal**: 1-5 million points (smooth 60fps)
- **Maximum**: 10-20 million points (depends on GPU)
- **Bottleneck**: GPU memory and vertex processing
- **Performance**: Raw WebGL gives us maximum speed

### Memory Breakdown (per 1M points)
- **Positions (x, y)**: 8MB (2 × Float32)
- **Colors (r, g, b)**: 12MB (3 × Float32)
- **Additional columns**: ~4-8MB each
- **Total**: ~20-30MB per million points

### Tile-Based Architecture

**What Quadfeather Does:**
1. **Spatial Partitioning**: Divides data into quadtree tiles
2. **Progressive Loading**: Only loads visible tiles
3. **Level of Detail**: Different zoom levels = different tile sizes
4. **Format Conversion**: CSV/Parquet → Arrow IPC format

**Example Workflow:**
```bash
# 1. Convert CSV to Parquet (optional, for speed)
python scripts/csv_to_parquet.py data.csv

# 2. Tile the data with quadfeather
quadfeather --files data.parquet --tile_size 50000 --destination tiles/

# 3. Generates:
# tiles/
#   ├── 0.arrow          # Root tile (all data, downsampled)
#   ├── 0-0.arrow        # Quadrant tiles
#   ├── 0-1.arrow
#   ├── 0-0-0.arrow      # Sub-quadrants
#   └── config.json      # Metadata (bounds, columns, etc.)
```

**Tile Size Recommendations:**
- **50,000 points/tile**: Good balance (default)
- **100,000 points/tile**: Fewer tiles, more memory per tile
- **25,000 points/tile**: More tiles, smoother loading

### Backend Capacity (Static Files)

**With Quadfeather Tiling:**
- **Tested**: Up to 100 million points
- **Theoretical**: Billions (limited by disk space)
- **Practical**: 10-100 million for good UX

**Why it scales:**
- Only loads ~5-10 tiles at a time (250K-500K points visible)
- Tiles cached in browser
- Zoom in = load higher detail tiles
- Zoom out = load lower detail tiles

### CSV Import (Client-Side)

**Without Tiling (direct CSV import in browser):**
- **Maximum**: ~1-2 million rows
- **Bottleneck**: Browser memory, parsing time
- **Use case**: Quick exploration, small datasets
- **How it works**: Entire CSV loaded into memory, converted to single Arrow table, rendered as one tile

**Does client-side import do tiling?**
- **No**: Client-side CSV import loads everything into memory at once
- **Single tile**: All data treated as one big tile
- **No progressive loading**: Can't zoom in for more detail
- **Memory limited**: Browser will crash if file too large

**Recommendation:**
- **< 1M points**: Direct CSV import is fine
- **1-10M points**: Use quadfeather tiling (backend preprocessing)
- **> 10M points**: Definitely use quadfeather + consider server-side filtering

**Why backend tiling is better:**
- Only loads visible data (5-10 tiles at a time)
- Supports billions of points
- Smooth zooming with level-of-detail
- Tiles cached for instant re-display

## Performance Considerations

- **Tile-based rendering**: Only load/render visible data
- **GPU buffers**: Reuse buffers, minimize uploads
- **Debounce interactions**: Don't re-render on every mouse move
- **Web Workers**: Consider for data processing (not yet implemented)
- **Arrow format**: Zero-copy data access is critical for performance

### Performance Tips

1. **Use Arrow format**: 10x faster than CSV parsing
2. **Tile large datasets**: Essential for > 1M points
3. **Limit visible columns**: Each column adds memory
4. **Use categorical encoding**: Strings → integers saves memory
5. **Downsample for overview**: Root tile should be < 100K points

## Future Enhancements

1. **Web Workers**: Move tile loading to background thread
2. **IndexedDB caching**: Cache tiles locally
3. **Server-side filtering**: Push filters to tile server
4. **Animation**: Smooth transitions between states
5. **3D support**: Add Z-axis for 3D scatterplots
6. **Streaming tiles**: Load tiles on-demand from server
7. **GPU-based filtering**: Move filtering to shaders for better performance
# Tile Format and Quadfeather Deep Dive

## Tile Format: Apache Arrow IPC

**File Extension**: `.arrow` (binary format)

**Format**: Apache Arrow IPC Stream Format
- NOT Feather (older format)
- NOT Parquet (columnar file format)
- Arrow IPC = In-Process Communication format
- Designed for zero-copy data sharing

**Structure**:
```
[Arrow IPC Header]
[Schema]
[RecordBatch 1]
  - Column 1 data (x coordinates)
  - Column 2 data (y coordinates)
  - Column 3 data (color values)
  - Column N data (other columns)
[Footer]
```

**Typical Tile Size**:
- 50,000 points = ~1-5MB per tile
- Depends on number of columns
- Optional compression (LZ4, ZSTD)

## Tile Naming Convention

```
0.arrow           # Root (zoom level 0, all data downsampled)
0-0.arrow         # Top-left quadrant
0-1.arrow         # Top-right quadrant  
0-2.arrow         # Bottom-left quadrant
0-3.arrow         # Bottom-right quadrant
0-0-0.arrow       # Top-left of top-left (deeper zoom)
0-0-1.arrow       # Top-right of top-left
0-0-2.arrow       # Bottom-left of top-left
0-0-3.arrow       # Bottom-right of top-left
...and so on
```

**Quadrant Numbering**:
```
+-------+-------+
|   0   |   1   |  (Top half)
+-------+-------+
|   2   |   3   |  (Bottom half)
+-------+-------+
```

## config.json Format

```json
{
  "extent": {
    "x": [min_x, max_x],
    "y": [min_y, max_y]
  },
  "columns": [
    {
      "name": "x",
      "type": "float",
      "numeric": true,
      "min": 0.0,
      "max": 100.0
    },
    {
      "name": "y",
      "type": "float",
      "numeric": true,
      "min": 0.0,
      "max": 100.0
    },
    {
      "name": "category",
      "type": "string",
      "numeric": false,
      "categorical": true,
      "categories": ["A", "B", "C"],
      "num_categories": 3
    },
    {
      "name": "value",
      "type": "float",
      "numeric": true,
      "min": -10.5,
      "max": 99.2
    }
  ],
  "tile_size": 50000,
  "version": "2.0"
}
```

## What Quadfeather Does (Detailed Algorithm)

### Step 1: Read Data
```python
# Reads CSV, Parquet, or any tabular format
data = read_file("input.csv")
# Result: DataFrame with columns [x, y, col1, col2, ...]
```

### Step 2: Calculate Bounds
```python
min_x = data['x'].min()
max_x = data['x'].max()
min_y = data['y'].min()
max_y = data['y'].max()
```

### Step 3: Create Root Tile
```python
# If data > tile_size, downsample randomly
if len(data) > tile_size:
    root_data = data.sample(n=tile_size)
else:
    root_data = data

# Write as Arrow IPC file
write_arrow_file(root_data, "tiles/0.arrow")
```

### Step 4: Recursive Quadtree Split
```python
def split_quadrant(data, x0, x1, y0, y1, tile_name, tile_size):
    # Filter data to this spatial region
    quad_data = data[
        (data.x >= x0) & (data.x < x1) &
        (data.y >= y0) & (data.y < y1)
    ]
    
    # Base case: small enough
    if len(quad_data) <= tile_size:
        return
    
    # Split into 4 sub-quadrants
    mid_x = (x0 + x1) / 2
    mid_y = (y0 + y1) / 2
    
    quadrants = [
        (0, x0, mid_x, y0, mid_y),      # Top-left
        (1, mid_x, x1, y0, mid_y),      # Top-right
        (2, x0, mid_x, mid_y, y1),      # Bottom-left
        (3, mid_x, x1, mid_y, y1)       # Bottom-right
    ]
    
    for q_num, qx0, qx1, qy0, qy1 in quadrants:
        child_name = f"{tile_name}-{q_num}"
        child_data = quad_data[
            (quad_data.x >= qx0) & (quad_data.x < qx1) &
            (quad_data.y >= qy0) & (quad_data.y < qy1)
        ]
        
        if len(child_data) > 0:
            # Downsample if needed
            tile_data = child_data.sample(n=tile_size) if len(child_data) > tile_size else child_data
            write_arrow_file(tile_data, f"tiles/{child_name}.arrow")
            
            # Recurse if still too large
            if len(child_data) > tile_size:
                split_quadrant(child_data, qx0, qx1, qy0, qy1, child_name, tile_size)
```

### Step 5: Generate config.json
```python
config = {
    "extent": {"x": [min_x, max_x], "y": [min_y, max_y]},
    "columns": analyze_columns(data),
    "tile_size": tile_size
}
write_json(config, "tiles/config.json")
```

## Reimplementing Quadfeather

### Yes, You Can! Here's How:

**In Java:**
```java
import org.apache.arrow.vector.*;
import org.apache.arrow.memory.BufferAllocator;
import org.apache.arrow.vector.ipc.ArrowFileWriter;

public class QuadfeatherJava {
    public void tile(DataFrame data, String outputDir, int tileSize) {
        // 1. Calculate bounds
        double minX = data.column("x").min();
        double maxX = data.column("x").max();
        double minY = data.column("y").min();
        double maxY = data.column("y").max();
        
        // 2. Create root tile
        DataFrame root = data.size() > tileSize 
            ? data.sample(tileSize) 
            : data;
        writeArrowFile(root, outputDir + "/0.arrow");
        
        // 3. Recursively split
        splitQuadrant(data, minX, maxX, minY, maxY, "0", tileSize, outputDir);
        
        // 4. Write config
        writeConfig(data, minX, maxX, minY, maxY, tileSize, outputDir);
    }
    
    private void writeArrowFile(DataFrame data, String path) {
        BufferAllocator allocator = new RootAllocator();
        VectorSchemaRoot root = VectorSchemaRoot.create(schema, allocator);
        
        // Fill vectors with data
        Float8Vector xVector = (Float8Vector) root.getVector("x");
        Float8Vector yVector = (Float8Vector) root.getVector("y");
        
        for (int i = 0; i < data.size(); i++) {
            xVector.set(i, data.getDouble(i, "x"));
            yVector.set(i, data.getDouble(i, "y"));
        }
        
        // Write to file
        try (FileOutputStream out = new FileOutputStream(path);
             ArrowFileWriter writer = new ArrowFileWriter(root, null, out.getChannel())) {
            writer.start();
            writer.writeBatch();
            writer.end();
        }
    }
}
```

**In Rust (Fastest):**
```rust
use arrow::array::*;
use arrow::ipc::writer::FileWriter;
use arrow::record_batch::RecordBatch;

fn tile_data(data: &DataFrame, output_dir: &str, tile_size: usize) {
    // Calculate bounds
    let (min_x, max_x) = data.column("x").min_max();
    let (min_y, max_y) = data.column("y").min_max();
    
    // Create root tile
    let root = if data.len() > tile_size {
        data.sample(tile_size)
    } else {
        data.clone()
    };
    write_arrow_file(&root, &format!("{}/0.arrow", output_dir));
    
    // Recursive split
    split_quadrant(data, min_x, max_x, min_y, max_y, "0", tile_size, output_dir);
}

fn write_arrow_file(data: &DataFrame, path: &str) {
    let schema = data.schema();
    let batch = RecordBatch::try_new(
        schema.clone(),
        vec![
            Arc::new(Float64Array::from(data.column("x"))),
            Arc::new(Float64Array::from(data.column("y"))),
            // ... other columns
        ],
    ).unwrap();
    
    let file = File::create(path).unwrap();
    let mut writer = FileWriter::try_new(file, &schema).unwrap();
    writer.write(&batch).unwrap();
    writer.finish().unwrap();
}
```

**Libraries Needed:**
- **Java**: `org.apache.arrow:arrow-vector`, `org.apache.arrow:arrow-memory`
- **Python**: `pyarrow` (what quadfeather uses)
- **Rust**: `arrow-rs`
- **JavaScript**: `apache-arrow` (for reading only, not writing)
- **Go**: `github.com/apache/arrow/go/arrow`

## Storing Sketches in Tiles

### Yes! Great for Fast Aggregations

**Add Sketch Columns to Arrow Schema:**

```python
import pyarrow as pa
from datasketches import hll_sketch, kll_floats_sketch

# Create schema with sketch columns
schema = pa.schema([
    ('x', pa.float64()),
    ('y', pa.float64()),
    ('category', pa.utf8()),
    ('value', pa.float64()),
    # Sketch columns (binary blobs)
    ('hll_sketch', pa.binary()),           # For distinct counts
    ('quantile_sketch', pa.binary()),      # For percentiles
    ('histogram', pa.binary()),            # For distributions
])

# When creating each tile:
def create_tile_with_sketches(data):
    # Build HyperLogLog sketch for distinct count
    hll = hll_sketch(12)  # log2(m) = 12
    for cat in data['category']:
        hll.update(cat)
    
    # Build KLL sketch for quantiles
    kll = kll_floats_sketch(200)  # k = 200
    for val in data['value']:
        kll.update(val)
    
    # Serialize sketches
    hll_bytes = hll.serialize()
    kll_bytes = kll.serialize()
    
    # Add to tile
    tile_data = {
        'x': data['x'],
        'y': data['y'],
        'category': data['category'],
        'value': data['value'],
        'hll_sketch': [hll_bytes],  # One sketch per tile
        'quantile_sketch': [kll_bytes],
    }
    
    return pa.Table.from_pydict(tile_data, schema=schema)
```

**Using Sketches for Fast Aggregations:**

```typescript
// Client-side (JavaScript)
import { hll_sketch, kll_floats_sketch } from 'datasketches-js';

// Fast distinct count across selection
async function getDistinctCount(selectedTiles: Tile[]) {
    // Merge HLL sketches from all tiles
    const merged = new hll_sketch(12);
    
    for (const tile of selectedTiles) {
        const sketchBytes = tile.data.getChild('hll_sketch').get(0);
        const tileSketch = hll_sketch.deserialize(sketchBytes);
        merged.merge(tileSketch);
    }
    
    return merged.estimate(); // ~1% error, instant!
}

// Fast percentiles across selection
async function getPercentiles(selectedTiles: Tile[]) {
    const merged = new kll_floats_sketch(200);
    
    for (const tile of selectedTiles) {
        const sketchBytes = tile.data.getChild('quantile_sketch').get(0);
        const tileSketch = kll_floats_sketch.deserialize(sketchBytes);
        merged.merge(tileSketch);
    }
    
    return {
        median: merged.get_quantile(0.5),
        p95: merged.get_quantile(0.95),
        p99: merged.get_quantile(0.99),
    };
}
```

**Benefits:**
- **100-1000x faster** than scanning all points
- **Constant memory**: Sketch size doesn't grow with data
- **Mergeable**: Combine sketches from multiple tiles
- **Approximate**: Small error (1-2%) but instant results

**Sketch Types:**
- **HyperLogLog**: Distinct counts (cardinality)
- **KLL/T-Digest**: Quantiles, percentiles, median
- **Count-Min**: Frequency estimation
- **Bloom Filter**: Set membership
- **Theta Sketch**: Set operations (union, intersection)

**Trade-offs:**
- **Tile size increases**: +1-10KB per sketch per tile
- **Preprocessing time**: Must compute sketches during tiling
- **Approximate**: Not exact (but usually good enough)
- **Library dependency**: Need sketch library on client

## Summary

**Tile Format**: Apache Arrow IPC (binary, columnar, zero-copy)

**Quadfeather Algorithm**: 
1. Read data
2. Calculate bounds
3. Create downsampled root
4. Recursively split into quadrants
5. Write config.json

**Reimplementation**: Easy! Just need Arrow library for your language

**Sketches**: Yes! Add binary columns with serialized sketches for fast aggregations

**File Structure**:
```
tiles/
├── 0.arrow              # Root tile
├── 0-0.arrow            # Quadrants
├── 0-1.arrow
├── 0-2.arrow
├── 0-3.arrow
├── 0-0-0.arrow          # Sub-quadrants
├── ...
└── config.json          # Metadata
```
