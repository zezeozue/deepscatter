# Deepscatter V2 - Architecture Documentation

## Overview

Deepscatter V2 is a high-performance WebGL-based scatterplot visualization tool designed for exploring large datasets (millions of points). It uses a tile-based rendering system for efficient data loading and rendering.

**Key Differences from V1 (root version):**
- **V1**: Uses Regl (WebGL wrapper library)
- **V2**: Uses raw WebGL (no wrapper, direct GPU control)
- **Why V2**: Smaller bundle size, more control, slightly faster
- **Trade-off**: V2 code is more verbose but more optimized

## Architecture

### Domain-Driven Structure

```
v2/src/
├── core/
│   └── scatter_gl.ts          # Main coordinator (~350 lines)
├── data/                       # Data domain
│   ├── tile.ts                # Tile data structure
│   ├── tile_store.ts          # Tile loading and caching
│   ├── tile_loader.ts         # Async tile loading
│   └── data_loader.ts         # Data operations manager
├── ui/                         # UI domain (Mithril.js)
│   ├── ui_manager.ts          # UI operations manager
│   └── components/            # Mithril components
│       ├── point_info.ts      # Point data display
│       ├── ui_controls.ts     # Color/filter selectors
│       ├── filter_controls.ts # Dynamic filter UI
│       └── index.ts           # Component exports
├── aesthetics/                 # Visual encoding domain
│   ├── color_manager.ts       # Color operations manager
│   ├── filter_manager.ts      # Data filtering logic
│   ├── legend.ts              # Legend rendering
│   └── scales.ts              # D3-style scales
├── interaction/                # Interaction domain
│   └── controller.ts          # Mouse/touch interaction
└── rendering/                  # Rendering domain (WebGL)
    ├── renderer.ts            # WebGL rendering engine
    ├── buffer_pool.ts         # GPU buffer management
    └── shaders/               # GLSL shaders
```

### Design Principles

**Domain-Driven Design:**
- Each folder is a complete, cohesive domain
- Clear boundaries between domains
- Managers own their complete domain logic
- ScatterGL coordinates between domains

**Separation of Concerns:**
- **Logic**: Pure TypeScript classes (testable)
- **DOM**: Mithril components (declarative)
- **WebGL**: Renderer (imperative, GPU-specific)

**Clean Architecture:**
- **ScatterGL**: Coordinator (state, rendering math, orchestration)
- **Managers**: Domain logic (data, colors, UI, filters)
- **Components**: Declarative UI (Mithril.js)

### Key Libraries

1. **Mithril.js** (`mithril`) - **NEW!**
   - Purpose: Declarative UI framework
   - Used for: All interactive UI components
   - Why: Small (10KB), fast, TypeScript-friendly
   - Bundle size: Minimal overhead
   
   **Clean Separation:**
   - All DOM manipulation in UI components
   - Logic stays in managers (testable)
   - No imperative DOM in business logic

2. **Raw WebGL** (native browser API)
   - Purpose: GPU-accelerated rendering
   - Used for: Drawing millions of points at 60fps
   - Why: Maximum control, smallest bundle, best performance

3. **Apache Arrow** (`apache-arrow`)
   - Purpose: Efficient columnar data format
   - Used for: Storing and accessing point data in tiles
   - Why: Zero-copy data access, memory efficient, blazing fast
   - Bundle size: ~200KB (worth it for performance)

4. **Vega-Embed** (`vega-embed`)
   - Purpose: Declarative visualization grammar
   - Used for: Rendering charts in selection panel

5. **D3 Scales** (custom implementation in `scales.ts`)
   - Purpose: Data-to-visual mappings
   - Used for: Color scales, coordinate transforms

## Mithril Integration

### Component Architecture

**All UI is now Mithril-based:**
- ✅ Point info display
- ✅ Color selector dropdown
- ✅ Filter selector dropdown
- ✅ Dynamic filter controls (numeric/categorical/text)
- ✅ Canvas resizing
- ✅ All control rendering

**Benefits:**
- **Declarative**: UI defined as functions of state
- **Testable**: Components are pure functions
- **Maintainable**: Clear separation of logic and presentation
- **Fast**: Virtual DOM handles updates efficiently
- **Small**: Only 10KB gzipped

### Example Component

```typescript
// Before: Imperative DOM manipulation
const navbar = document.getElementById('point-data');
navbar.innerHTML = Object.entries(data)
  .map(([k, v]) => `<div>${k}: ${v}</div>`)
  .join('');

// After: Declarative Mithril component
m.render(navbar, m(PointInfo, { data }));

// Component definition
export const PointInfo: m.Component<{data: Record<string, any>}> = {
  view({ attrs }) {
    return m('.point-info', 
      Object.entries(attrs.data).map(([key, value]) =>
        m('.point-row', [
          m('span.point-key', key),
          m('span.point-value', value)
        ])
      )
    );
  }
};
```

### Testing

**Easy to test:**
```typescript
// Test a component
const vnode = m(PointInfo, { data: { x: 1, y: 2 } });
const html = m.render(vnode);
assert(html.includes('x'));
assert(html.includes('1'));

// Test a manager
const dataLoader = new DataLoader();
const { table, extent } = dataLoader.createTableFromData(data, 'x', 'y');
assert(extent.minX < extent.maxX);
```

## Data Flow

### Complete Pipeline

#### Path 1: Client-Side CSV Import (< 1M points)

```
User uploads CSV
  ↓
DataLoader.createTableFromData()
  - Parses CSV → Array of objects
  - Creates Arrow table
  - Calculates extent
  ↓
TileStore.fromTable()
  - Stores as single tile
  ↓
UIManager.renderAllControls()
  - Renders color/filter selectors
  ↓
ColorManager.applyColorEncoding()
  - Computes colors for points
  ↓
Renderer.render()
  - Uploads to GPU
  - Draws points
```

#### Path 2: Backend Tiling (> 1M points)

```
Quadfeather preprocessing (backend)
  - Splits data into spatial tiles
  - Writes Arrow IPC files
  ↓
DataLoader.loadFromUrl()
  - Fetches config.json
  - Loads metadata
  ↓
TileStore.init()
  - Initializes tile system
  ↓
TileStore.update(viewport)
  - Calculates visible tiles
  - Loads .arrow files
  ↓
ColorManager.computeTileColors()
  - Applies color encoding
  - Applies filter masks
  ↓
Renderer.render()
  - Draws visible tiles
```

## Performance

### Optimizations

1. **Tile-based rendering**: Only load/render visible data
2. **GPU buffers**: Reuse buffers, minimize uploads
3. **Mithril Virtual DOM**: Efficient UI updates
4. **Arrow zero-copy**: Direct memory access
5. **Domain separation**: Easy to optimize each domain independently

### Capacity

- **Client-side**: 1-2M points (single tile)
- **Backend tiling**: 100M+ points (progressive loading)
- **GPU memory**: ~36MB per 1M points
- **Tile size**: 50K points/tile (recommended)

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

1. **Domain Cohesion**: Keep related code together
2. **Clear Boundaries**: Managers don't cross domains
3. **Testability**: Logic separated from DOM
4. **Type Safety**: TypeScript throughout
5. **Component Reusability**: Mithril components are portable

## Future Enhancements

1. **Web Workers**: Move tile loading to background thread
2. **IndexedDB caching**: Cache tiles locally
3. **Server-side filtering**: Push filters to tile server
4. **Animation**: Smooth transitions between states
5. **3D support**: Add Z-axis for 3D scatterplots
6. **More Mithril**: Convert remaining UI to components
7. **GPU-based filtering**: Move filtering to shaders

## Migration from V1

The Mithril refactoring makes V2 even better:
- **Smaller**: Mithril is tiny (10KB vs React 40KB+)
- **Faster**: Virtual DOM + WebGL = maximum performance
- **Cleaner**: Declarative UI, testable logic
- **Maintainable**: Clear domain separation

All core rendering remains unchanged - Mithril only handles UI, WebGL handles visualization.
