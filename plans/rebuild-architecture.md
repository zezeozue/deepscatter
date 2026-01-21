# Rebuilding Deepscatter: High-Level Architecture Guide

## Executive Summary

Deepscatter is a WebGL-based visualization library for rendering millions of points using quadtree tiling and Apache Arrow. This document provides a comprehensive architectural analysis and a roadmap for rebuilding it in a more concise, elegant way.

---

## Core Architecture Analysis

### 1. **Data Layer: Quadtree Tiling System**

**Current Implementation:**
- [`Deeptable`](src/Deeptable.ts): Manages the entire tile tree and data transformations
- [`Tile`](src/tile.ts): Individual quadtree nodes containing Arrow RecordBatches
- Supports both server-fetched tiles (via quadfeather format) and in-memory datasets
- Uses Apache Arrow IPC format (.feather files) for zero-copy data transfer

**Key Insights:**
```
Data Flow:
1. Tiles organized in quadtree: 0/0/0 → 1/0/0, 1/1/0, 1/0/1, 1/1/1 → ...
2. Each tile has metadata: {min_ix, max_ix, extent, nPoints, children}
3. Lazy loading: tiles fetch data only when visible in viewport
4. Transformation system: columns can be computed on-demand per tile
```

**Elegant Rebuild Approach:**
- **Single TileManager class** instead of Deeptable + Tile separation
- Use a **flat tile registry** (Map<tileKey, TileData>) instead of tree traversal
- **Streaming tile loader** with priority queue based on viewport visibility
- **Column-oriented transformations** as pure functions, not class methods

---

### 2. **Rendering Layer: WebGL via REGL**

**Current Implementation:**
- [`ReglRenderer`](src/regl_renderer.ts): Main WebGL rendering engine using REGL library
- [`BufferManager`](src/regl_renderer.ts#L972): Manages GPU buffer allocation and reuse
- [`AestheticSet`](src/aesthetics/AestheticSet.ts): Maps data columns to visual properties
- Custom GLSL shaders for point rendering with transitions

**Key Insights:**
```
Rendering Pipeline:
1. Allocate GPU buffers (64MB blocks, reused across tiles)
2. Convert Arrow columns to Float32Arrays for WebGL
3. Map aesthetics (x, y, color, size, etc.) to shader uniforms
4. Render visible tiles with alpha blending
5. Support smooth transitions between aesthetic states
```

**Elegant Rebuild Approach:**
- **Unified BufferPool** with automatic memory management
- **Declarative aesthetic mapping**: `{x: 'field', color: {field: 'category', scale: 'viridis'}}`
- **Shader composition system** instead of monolithic shaders
- **Framebuffer-based effects** (blur, selection) as composable passes

---

### 3. **Interaction Layer: D3-Zoom + Mouse Events**

**Current Implementation:**
- [`Zoom`](src/interaction.ts): Manages pan/zoom using d3-zoom
- Color-picking for point selection (render to offscreen buffer with encoded IDs)
- Tooltip system with hover detection
- Viewport-based tile loading

**Key Insights:**
```
Interaction Flow:
1. D3-zoom handles pan/zoom transforms
2. Transform updates trigger tile visibility checks
3. Throttled download queue spawns network requests
4. Color-picking: render points with encoded IDs, read pixel at mouse position
5. Hover circles drawn on SVG overlay
```

**Elegant Rebuild Approach:**
- **Event-driven architecture**: emit events for zoom, hover, click
- **Spatial index** (R-tree) for fast point queries instead of color-picking
- **Declarative interaction config**: `{zoom: true, hover: true, select: 'lasso'}`
- **Unified coordinate system** (no separate SVG overlay)

---

### 4. **API Design: Grammar of Graphics**

**Current Implementation:**
- Vega-Lite inspired encoding API
- Scatterplot class as main entry point
- `plotAPI()` method for updates with transitions
- Hook system for custom callbacks

**Key Insights:**
```javascript
// Current API
scatterplot.plotAPI({
  encoding: {
    x: {field: 'x', transform: 'literal'},
    y: {field: 'y', transform: 'literal'},
    color: {field: 'category', range: 'viridis', domain: [0, 10]},
    size: {constant: 3}
  },
  duration: 1000,
  zoom: {bbox: {x: [0, 100], y: [0, 100]}}
})
```

**Elegant Rebuild Approach:**
```javascript
// Proposed simplified API
plot.update({
  x: 'x_coord',
  y: 'y_coord', 
  color: {field: 'category', scale: 'viridis'},
  size: 3,
  filter: d => d.value > 0,
  transition: 1000
})
```

---

## Simplified Architecture Proposal

### Core Components (5 instead of 20+)

```
┌─────────────────────────────────────────────────────┐
│                    ScatterGL                        │
│  (Main API - replaces Scatterplot + Deeptable)     │
└─────────────────────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  TileStore   │ │   Renderer   │ │  Controller  │
│              │ │              │ │              │
│ - Quadtree   │ │ - WebGL      │ │ - Zoom       │
│ - Arrow data │ │ - Shaders    │ │ - Events     │
│ - Transforms │ │ - Buffers    │ │ - Selection  │
└──────────────┘ └──────────────┘ └──────────────┘
        │               │               │
        └───────────────┴───────────────┘
                        │
                ┌───────┴────────┐
                ▼                ▼
        ┌──────────────┐  ┌──────────────┐
        │ DataSource   │  │   Canvas     │
        │ (API/Memory) │  │   (WebGL)    │
        └──────────────┘  └──────────────┘
```

### 1. **ScatterGL** (Main API)
```typescript
class ScatterGL {
  constructor(container: HTMLElement, options?: Options)
  
  // Data loading
  async load(source: URL | ArrowTable): Promise<void>
  
  // Rendering
  render(spec: RenderSpec): void
  
  // Interaction
  on(event: string, handler: Function): void
  zoom(bbox: BBox, duration?: number): void
  select(query: Query): Selection
  
  // Lifecycle
  destroy(): void
}
```

### 2. **TileStore** (Data Management)
```typescript
class TileStore {
  private tiles: Map<string, Tile>
  private manifest: TileManifest
  private loader: TileLoader
  
  // Tile access
  getTile(key: string): Promise<Tile>
  getVisibleTiles(viewport: BBox): Tile[]
  
  // Column operations
  getColumn(tile: Tile, name: string): Float32Array
  addTransform(name: string, fn: TransformFn): void
  
  // Spatial queries
  queryPoint(x: number, y: number): Point | null
  queryRegion(bbox: BBox): Point[]
}
```

### 3. **Renderer** (WebGL Engine)
```typescript
class Renderer {
  private gl: WebGL2RenderingContext
  private bufferPool: BufferPool
  private shaderProgram: ShaderProgram
  
  // Rendering
  render(tiles: Tile[], aesthetics: Aesthetics): void
  
  // Buffer management
  uploadTile(tile: Tile, columns: string[]): void
  releaseTile(tile: Tile): void
  
  // Effects
  setBlending(mode: BlendMode): void
  applyFilter(filter: FilterFn): void
}
```

### 4. **Controller** (Interaction)
```typescript
class Controller {
  private viewport: Viewport
  private eventBus: EventEmitter
  
  // Zoom/Pan
  setTransform(transform: Transform): void
  zoomTo(bbox: BBox, duration: number): void
  
  // Selection
  selectPoint(x: number, y: number): Point | null
  selectRegion(bbox: BBox): Point[]
  
  // Events
  emit(event: string, data: any): void
}
```

### 5. **DataSource** (Backend Abstraction)
```typescript
interface DataSource {
  // Metadata
  getManifest(): Promise<Manifest>
  getExtent(): BBox
  
  // Tile loading
  fetchTile(key: string): Promise<ArrowTable>
  
  // Caching
  prefetch(keys: string[]): void
}

class QuadfeatherSource implements DataSource { /* ... */ }
class MemorySource implements DataSource { /* ... */ }
```

---

## Key Technical Decisions

### 1. **WebGL 2.0 Instead of WebGL 1.0**
- Vertex Array Objects (VAOs) for cleaner state management
- Transform feedback for GPU-side computations
- 3D textures for efficient color scales
- Better precision with `highp` floats

### 2. **Flat Tile Registry Instead of Tree Traversal**
```typescript
// Current: Recursive tree traversal
deeptable.visit(tile => { /* ... */ })

// Proposed: Direct lookup
const tile = tileStore.tiles.get('3/4/2')
const visible = tileStore.getVisibleTiles(viewport)
```

### 3. **Reactive State Management**
```typescript
// Observable pattern for automatic re-rendering
const state = reactive({
  viewport: {x: [0, 1], y: [0, 1]},
  aesthetics: {color: 'category'},
  filter: null
})

// Auto-triggers render on change
state.aesthetics.color = 'value'
```

### 4. **Worker-Based Tile Processing**
```typescript
// Offload Arrow parsing and transformations to workers
const worker = new Worker('tile-processor.js')
worker.postMessage({tile: tileData, transforms: ['log', 'normalize']})
worker.onmessage = ({data}) => renderer.uploadTile(data)
```

### 5. **Spatial Indexing for Point Queries**
```typescript
// Replace color-picking with R-tree
const rtree = new RTree()
for (const tile of visibleTiles) {
  rtree.insert(tile.points)
}
const point = rtree.search(mouseX, mouseY, radius)
```

---

## Simplified Data Flow

```
┌─────────────┐
│   User API  │  plot.render({x: 'x', color: 'category'})
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────┐
│  State Update                               │
│  - Parse render spec                        │
│  - Diff with current state                  │
│  - Plan transition                          │
└──────┬──────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────┐
│  Tile Loading                               │
│  - Calculate visible tiles from viewport    │
│  - Fetch missing tiles (priority queue)     │
│  - Apply transformations                    │
└──────┬──────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────┐
│  Buffer Management                          │
│  - Convert Arrow → Float32Array             │
│  - Upload to GPU buffers                    │
│  - Track buffer usage                       │
└──────┬──────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────┐
│  Rendering                                  │
│  - Set shader uniforms (scales, colors)     │
│  - Draw each tile's points                  │
│  - Apply blending & effects                 │
└──────┬──────────────────────────────────────┘
       │
       ▼
┌─────────────┐
│   Canvas    │  Visual output
└─────────────┘
```

---

## Implementation Phases

### Phase 1: Core Rendering (Week 1-2)
**Goal:** Render static points from in-memory Arrow data

```typescript
// Minimal viable product
const plot = new ScatterGL('#container')
await plot.load(arrowTable)
plot.render({x: 'x', y: 'y', color: 'category'})
```

**Components:**
- [ ] Basic WebGL2 renderer with point shader
- [ ] Arrow table → GPU buffer pipeline
- [ ] Simple aesthetic mapping (x, y, color, size)
- [ ] Canvas setup and resize handling

**Files to create:**
- `src/core/ScatterGL.ts` (main API)
- `src/rendering/Renderer.ts` (WebGL engine)
- `src/rendering/BufferPool.ts` (GPU memory)
- `src/rendering/shaders/point.vert` (vertex shader)
- `src/rendering/shaders/point.frag` (fragment shader)

---

### Phase 2: Quadtree Tiling (Week 3-4)
**Goal:** Load and render tiled datasets with viewport culling

```typescript
await plot.load('https://example.com/tiles/')
// Automatically loads only visible tiles
```

**Components:**
- [ ] TileStore with quadtree logic
- [ ] Tile visibility calculation
- [ ] Priority-based tile loading queue
- [ ] Tile caching and eviction

**Files to create:**
- `src/data/TileStore.ts`
- `src/data/TileLoader.ts`
- `src/data/QuadfeatherSource.ts`
- `src/data/MemorySource.ts`

---

### Phase 3: Interaction (Week 5)
**Goal:** Pan, zoom, hover, and selection

```typescript
plot.on('zoom', (transform) => console.log(transform))
plot.on('hover', (point) => showTooltip(point))
plot.on('select', (points) => highlightPoints(points))
```

**Components:**
- [ ] Controller with d3-zoom integration
- [ ] Event system (EventEmitter)
- [ ] Spatial index for point queries
- [ ] Selection rendering (highlight layer)

**Files to create:**
- `src/interaction/Controller.ts`
- `src/interaction/SpatialIndex.ts`
- `src/interaction/Selection.ts`

---

### Phase 4: Advanced Features (Week 6-7)
**Goal:** Transitions, filters, transformations

```typescript
plot.render({
  color: {field: 'value', scale: 'viridis', domain: [0, 100]},
  size: {field: 'importance', range: [1, 10]},
  filter: d => d.category === 'A',
  transition: 1000
})
```

**Components:**
- [ ] Transition system (interpolate aesthetics)
- [ ] Scale system (linear, log, categorical)
- [ ] Filter rendering (GPU-side filtering)
- [ ] Transform system (computed columns)

**Files to create:**
- `src/aesthetics/Scales.ts`
- `src/aesthetics/Transitions.ts`
- `src/data/Transforms.ts`

---

### Phase 5: Polish & Optimization (Week 8)
**Goal:** Production-ready performance and DX

**Components:**
- [ ] Automatic LOD (level of detail) based on zoom
- [ ] Progressive rendering for large datasets
- [ ] TypeScript types and JSDoc
- [ ] Performance profiling and optimization
- [ ] Error handling and validation
- [ ] Examples and documentation

---

## Code Size Comparison

**Current Deepscatter:**
- ~15,000 lines of TypeScript
- 20+ core classes
- Complex inheritance hierarchies
- Tight coupling between components

**Proposed Rebuild:**
- ~3,000-4,000 lines of TypeScript
- 5 core classes + utilities
- Composition over inheritance
- Clear separation of concerns

**Key Simplifications:**
1. **Unified API**: Single entry point instead of Scatterplot + Deeptable
2. **Flat architecture**: Direct tile access instead of tree traversal
3. **Functional transforms**: Pure functions instead of class methods
4. **Declarative rendering**: Spec-based instead of imperative
5. **Modern WebGL**: WebGL2 features reduce boilerplate

---

## Example: Side-by-Side Comparison

### Current Deepscatter
```typescript
// Setup (verbose)
const scatterplot = new Scatterplot('#container', 800, 600)
await scatterplot.load_deeptable({source_url: 'tiles/'})
await scatterplot.reinitialize()

// Render (nested objects)
await scatterplot.plotAPI({
  encoding: {
    x: {field: 'x', transform: 'literal'},
    y: {field: 'y', transform: 'literal'},
    color: {
      field: 'category',
      range: 'viridis',
      domain: [0, 10],
      transform: 'linear'
    },
    size: {constant: 3}
  },
  duration: 1000,
  background_color: '#000000'
})

// Interaction (manual setup)
scatterplot.click_function = (d, plot, ev) => {
  console.log(d)
}
scatterplot.tooltip_html = (d) => `<div>${d.name}</div>`
```

### Proposed Rebuild
```typescript
// Setup (concise)
const plot = new ScatterGL('#container')
await plot.load('tiles/')

// Render (flat object)
plot.render({
  x: 'x',
  y: 'y',
  color: {field: 'category', scale: 'viridis'},
  size: 3,
  transition: 1000,
  background: '#000'
})

// Interaction (event-based)
plot.on('click', d => console.log(d))
plot.on('hover', d => showTooltip(d.name))
```

---

## Key Patterns to Adopt

### 1. **Builder Pattern for Configuration**
```typescript
const plot = new ScatterGL('#container')
  .withData('tiles/')
  .withAesthetics({x: 'x', y: 'y', color: 'category'})
  .withInteraction({zoom: true, select: 'lasso'})
  .render()
```

### 2. **Plugin System for Extensions**
```typescript
plot.use(new TooltipPlugin({
  template: d => `<div>${d.name}: ${d.value}</div>`
}))

plot.use(new LegendPlugin({
  position: 'top-right'
}))
```

### 3. **Reactive State with Proxies**
```typescript
const state = reactive({
  viewport: {x: [0, 1], y: [0, 1]},
  aesthetics: {color: 'category'}
})

// Automatically triggers re-render
state.aesthetics.color = 'value'
```

### 4. **Async Iterators for Tile Streaming**
```typescript
for await (const tile of tileStore.stream(viewport)) {
  renderer.uploadTile(tile)
  renderer.render()
}
```

### 5. **Functional Composition for Transforms**
```typescript
const transforms = {
  log: (x: number) => Math.log(x),
  normalize: (x: number, min: number, max: number) => 
    (x - min) / (max - min)
}

// Compose transforms
const pipeline = compose(transforms.log, transforms.normalize)
const result = pipeline(value, min, max)
```

---

## Performance Optimizations

### 1. **Instanced Rendering**
```glsl
// Instead of drawing each point individually
// Use instanced rendering for massive speedup
gl.drawArraysInstanced(gl.POINTS, 0, 1, pointCount)
```

### 2. **Texture-Based Color Scales**
```typescript
// Upload color scale as 1D texture
const colorTexture = createTexture(colorScale)
// Sample in shader
vec3 color = texture(colorScale, normalizedValue).rgb
```

### 3. **Frustum Culling**
```typescript
// Only render tiles that intersect viewport
const visibleTiles = tiles.filter(tile => 
  intersects(tile.bbox, viewport)
)
```

### 4. **Progressive Loading**
```typescript
// Load low-res tiles first, then refine
const loadOrder = [
  ...lowResTiles,   // Load immediately
  ...mediumResTiles, // Load after 100ms
  ...highResTiles    // Load after 500ms
]
```

### 5. **GPU-Side Filtering**
```glsl
// Filter in fragment shader instead of CPU
if (value < filterMin || value > filterMax) {
  discard;
}
```

---

## Testing Strategy

### Unit Tests
- TileStore: tile visibility, quadtree logic
- Renderer: buffer allocation, shader compilation
- Controller: coordinate transforms, event handling

### Integration Tests
- End-to-end rendering pipeline
- Tile loading and caching
- Interaction flows (zoom, select, hover)

### Performance Tests
- Render 1M points at 60fps
- Load 100 tiles in <1s
- Smooth zoom transitions

### Visual Regression Tests
- Screenshot comparison for rendering accuracy
- Color scale correctness
- Selection highlighting

---

## Migration Path from Deepscatter

For users of the current library:

### 1. **API Compatibility Layer**
```typescript
// Wrapper that translates old API to new
class DeepscatterCompat extends ScatterGL {
  async plotAPI(prefs: OldAPICall) {
    const newSpec = translateAPI(prefs)
    return this.render(newSpec)
  }
}
```

### 2. **Gradual Migration Guide**
```typescript
// Step 1: Replace Scatterplot with ScatterGL
- const plot = new Scatterplot('#container')
+ const plot = new ScatterGL('#container')

// Step 2: Simplify data loading
- await plot.load_deeptable({source_url: 'tiles/'})
+ await plot.load('tiles/')

// Step 3: Flatten encoding
- await plot.plotAPI({encoding: {x: {field: 'x'}}})
+ plot.render({x: 'x'})
```

### 3. **Feature Parity Checklist**
- [x] Quadtree tiling
- [x] WebGL rendering
- [x] Pan/zoom interaction
- [x] Color scales
- [x] Transitions
- [x] Filtering
- [x] Selection
- [ ] Jitter (optional)
- [ ] Annotations (optional)
- [ ] 3D (out of scope)

---

## Conclusion

The rebuild focuses on:

1. **Simplicity**: 5 core classes instead of 20+
2. **Elegance**: Declarative API, functional transforms
3. **Performance**: WebGL2, instanced rendering, spatial indexing
4. **Maintainability**: Clear separation of concerns, minimal coupling
5. **Developer Experience**: Intuitive API, TypeScript types, good docs

**Core Philosophy:**
> "Make the common case simple, and the complex case possible"

The new architecture achieves the same functionality as Deepscatter but with:
- 70% less code
- Clearer abstractions
- Better performance
- Easier to extend

**Next Steps:**
1. Validate this architecture with stakeholders
2. Set up project structure and build tooling
3. Begin Phase 1 implementation
4. Iterate based on feedback

---

## Appendix: Technology Stack

### Core Dependencies
- **WebGL2**: Native browser API (no wrapper needed)
- **Apache Arrow**: Data format (keep existing)
- **D3-zoom**: Pan/zoom behavior (keep existing)
- **TypeScript**: Type safety and DX

### Optional Dependencies
- **RBush**: R-tree spatial index
- **Comlink**: Web Worker communication
- **Vite**: Build tool and dev server

### Removed Dependencies
- **REGL**: Too much abstraction, use raw WebGL2
- **Lodash**: Use native JS methods
- **D3-selection**: Use native DOM APIs

### Bundle Size Target
- Current: ~500KB minified
- Target: ~150KB minified (70% reduction)
