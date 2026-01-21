import { Renderer } from '../rendering/renderer';
import { RenderSpec } from '../types';
import { TileStore } from '../data/tile_store';
import { Controller, Transform } from '../interaction/controller';
import { BBox, Tile } from '../data/tile';
import { colorScale, Scale } from '../aesthetics/scales';
import { Table, Vector, makeVector, Float32, Utf8 } from 'apache-arrow';

export class ScatterGL {
  private container: HTMLElement;
  private renderer: Renderer;
  private canvas: HTMLCanvasElement;
  private tileStore: TileStore;
  private controller: Controller;
  private transform: Transform = { k: 1, x: 0, y: 0 };
  private renderId: number | null = null;
  
  private spec: RenderSpec = { x: 'x', y: 'y' };
  private specVersion: number = 0;
  private hoveredPoint: {tileKey: string, index: number} | null = null;
  private lockedPoint: {tileKey: string, index: number} | null = null;
  private baseK: number = 1.0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.style.position = 'relative';

    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.container.appendChild(this.canvas);
    
    // Initialize components
    this.renderer = new Renderer(this.canvas);
    this.tileStore = new TileStore();
    this.tileStore.onTileLoad = () => this.scheduleRender();

    // Initial resize
    this.resize();

    this.controller = new Controller(
      this.canvas,
      (t) => { // onUpdate
        this.transform = t;
        this.updateViewport();
        this.render();
      },
      (x, y) => { // onHover
        if (this.lockedPoint !== null) return;
        const result = this.pick(x, y);
        
        if (typeof result !== 'number') {
          const { tile, index } = result;
          if (!this.hoveredPoint || this.hoveredPoint.tileKey !== tile.key || this.hoveredPoint.index !== index) {
            this.hoveredPoint = {tileKey: tile.key, index};
            this.showInNavBar(result);
          }
        } else if (this.hoveredPoint !== null) {
          this.hoveredPoint = null;
          this.showInNavBar(-1);
        }
      },
      (x, y) => { // onClick
        const result = this.pick(x, y);
        
        if (typeof result !== 'number') {
          const { tile, index } = result;
          this.lockedPoint = {tileKey: tile.key, index};
          this.showInNavBar(result);
          
          if (tile.data) {
            const row = tile.data.get(index);
            if (row) {
              this.renderer.setHighlight(row.x, row.y);
            }
          }
        } else {
          this.lockedPoint = null;
          this.showInNavBar(-1);
          this.renderer.setHighlight(null, null);
        }
        this.render();
      }
    );

    window.addEventListener('resize', () => this.resize());
  }

  private pick(x: number, y: number): number | {tile: Tile, index: number} {
    const { width, height } = this.canvas;
    const baseScale = Math.min(width, height);
    const dpr = window.devicePixelRatio;
    const renderTransform = {
      k: this.transform.k * baseScale,
      x: this.transform.x * dpr,
      y: this.transform.y * dpr,
      k_min: this.baseK * baseScale
    };
    
    return this.renderer.pick(x * dpr, y * dpr, this.tileStore.getTiles(), width, height, renderTransform);
  }

  private showInNavBar(result: -1 | {tile: Tile, index: number}) {
    const navbar = document.getElementById('point-data');
    if (!navbar) return;

    if (result === -1) {
        navbar.innerHTML = '';
        return;
    }

    const { tile, index } = result;
    if (!tile.data) return;

    const row = tile.data.get(index);
    if (!row) {
        navbar.innerHTML = '';
        return;
    }

    const data = row.toJSON();
    const html = Object.entries(data).map(([k, v]) => `
      <div class="point-row">
        <span class="point-key">${k}</span>
        <span class="point-value">${v}</span>
      </div>
    `).join('');
    navbar.innerHTML = html;
  }

  private resize() {
    const { width, height } = this.container.getBoundingClientRect();
    this.canvas.width = width * window.devicePixelRatio;
    this.canvas.height = height * window.devicePixelRatio;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    
    if (this.renderer) {
      this.renderer.resize(this.canvas.width, this.canvas.height);
      this.updateViewport();
      this.render();
    }
  }

  private updateViewport() {
      const { width, height } = this.canvas;
      const { k, x, y } = this.transform;
      const dpr = window.devicePixelRatio;
      
      const baseScale = Math.min(width, height);
      const effectiveK = k * baseScale;
      
      // Transform x/y are in CSS pixels, scale to physical
      const tx = x * dpr;
      const ty = y * dpr;
      
      const x0 = (0 - tx) / effectiveK;
      const x1 = (width - tx) / effectiveK;
      const y0 = (0 - ty) / effectiveK;
      const y1 = (height - ty) / effectiveK;
      
      const viewport: BBox = {
          x: [Math.min(x0, x1), Math.max(x0, x1)],
          y: [Math.min(y0, y1), Math.max(y0, y1)]
      };
      
      console.log('Update Viewport:', viewport);
      this.tileStore.update(viewport);
  }

  public async load(url: string) {
    // console.log('Loading data from', url);
    await this.tileStore.init(url);
    
    const root = this.tileStore.getRoot();
    if (root && root.data) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        const xCol = root.data.getChild('x');
        const yCol = root.data.getChild('y');
        if (xCol && yCol) {
            const count = root.data.numRows;
            // Sample extent from root tile (checking all points is fast for <1M)
            for(let i=0; i<count; i++) {
                const xv = Number(xCol.get(i));
                const yv = Number(yCol.get(i));
                if (xv < minX) minX = xv;
                if (xv > maxX) maxX = xv;
                if (yv < minY) minY = yv;
                if (yv > maxY) maxY = yv;
            }
            this.fitToExtent(minX, maxX, minY, maxY);
        }
    } else {
        this.updateViewport();
        this.render();
    }
  }

  public loadData(data: any[], xField: string, yField: string) {
    const xData = new Float32Array(data.map(d => parseFloat(d[xField])));
    const yData = new Float32Array(data.map(d => parseFloat(d[yField])));
    const x = makeVector(xData);
    const y = makeVector(yData);
    
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i=0; i<xData.length; i++) {
        const xv = xData[i];
        const yv = yData[i];
        if (xv < minX) minX = xv;
        if (xv > maxX) maxX = xv;
        if (yv < minY) minY = yv;
        if (yv > maxY) maxY = yv;
    }

    const otherCols: {[key: string]: Vector} = Object.keys(data[0]).reduce((acc: {[key: string]: Vector}, key) => {
        if (key !== xField && key !== yField) {
            if (!isNaN(parseFloat(data[0][key]))) {
                const colData = new Float32Array(data.map(d => parseFloat(d[key])));
                acc[key] = makeVector(colData);
            } else {
                const colData = data.map(d => d[key]);
                acc[key] = makeVector(colData);
            }
        }
        return acc;
    }, {});


    const table = new Table({ x, y, ...otherCols });

    const tile = new Tile('imported', { x: [0, 1], y: [0, 1] });
    tile.data = table;
    tile.isLoaded = true;

    this.tileStore.setRoot('imported');
    this.tileStore.clear();
    this.tileStore.addTile(tile);
    
    this.fitToExtent(minX, maxX, minY, maxY);
  }

  private fitToExtent(minX: number, maxX: number, minY: number, maxY: number) {
      const dataW = maxX - minX;
      const dataH = maxY - minY;
      if (dataW <= 0 || dataH <= 0) return;

      const { width, height } = this.canvas.getBoundingClientRect();
      const minDimension = Math.min(width, height);
      
      const kx = width / (dataW * minDimension);
      const ky = height / (dataH * minDimension);
      let k = Math.min(kx, ky) * 0.9; // 0.9 padding
      
      this.baseK = k;

      const cx = minX + dataW / 2;
      const cy = minY + dataH / 2;
      
      const x = width / 2 - cx * k * minDimension;
      const y = height / 2 - cy * k * minDimension;
      
      this.controller.setTransform(k, x, y);
  }

  private scheduleRender() {
      if (this.renderId) return;
      this.renderId = requestAnimationFrame(() => {
          this.render();
          this.renderId = null;
      });
  }

  public render(spec?: RenderSpec) {
    if (spec) {
        this.spec = spec;
        this.specVersion++;
    }

    const tiles = this.tileStore.getTiles();
    
    for (const tile of tiles) {
        let initialized = this.renderer.isTileInitialized(tile);
        if (!initialized) {
            this.renderer.initTile(tile);
        }
        
        if (tile.data && tile.visualsVersion !== this.specVersion) {
            this.updateTileVisuals(tile);
        }
    }
    
    const { width, height } = this.canvas;
    const baseScale = Math.min(width, height);
    const dpr = window.devicePixelRatio;
    
    const renderTransform = {
        k: this.transform.k * baseScale,
        x: this.transform.x * dpr,
        y: this.transform.y * dpr,
        k_min: this.baseK * baseScale
    };

    this.renderer.render(tiles, width, height, renderTransform);
  }

  private updateTileVisuals(tile: Tile) {
      if (!tile.data) return;
      const count = tile.data.numRows;
      const colors = new Float32Array(count * 3);
      
      if (typeof this.spec.color === 'object' && this.spec.color.field) {
          const field = this.spec.color.field;
          const col = tile.data.getChild(field);
          if (col) {
              const domain = this.spec.color.domain || [0, 1];
              const scale = colorScale(domain);
              
              for (let i = 0; i < count; i++) {
                  const val = Number(col.get(i));
                  const c = scale(val);
                  colors[i * 3] = c[0];
                  colors[i * 3 + 1] = c[1];
                  colors[i * 3 + 2] = c[2];
              }
          } else {
              colors.fill(0.8); // Missing column -> Gray
          }
      } else {
          // Default colors
          if (!this.spec.color) {
               for (let i = 0; i < count; i++) {
                  colors[i * 3] = Math.random();
                  colors[i * 3 + 1] = Math.random();
                  colors[i * 3 + 2] = Math.random();
               }
          } else {
              colors.fill(1.0); // White
          }
      }

      this.renderer.updateAesthetics(tile, colors);
      tile.visualsVersion = this.specVersion;
  }
}
