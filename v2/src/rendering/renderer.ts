import { BufferPool } from './buffer_pool';
import pointVert from './shaders/point.vert';
import pointFrag from './shaders/point.frag';
import gridVert from './shaders/grid.vert';
import gridFrag from './shaders/grid.frag';
import pickingVert from './shaders/picking.vert';
import pickingFrag from './shaders/picking.frag';
import highlightVert from './shaders/highlight.vert';
import highlightFrag from './shaders/highlight.frag';
import { Tile } from '../data/tile';

interface TileRenderState {
  vao: WebGLVertexArrayObject;
  pickingVao: WebGLVertexArrayObject;
  count: number;
}

export class Renderer {
  private gl: WebGL2RenderingContext;
  private bufferPool: BufferPool;
  private program: WebGLProgram | null = null;
  private pickingProgram: WebGLProgram | null = null;
  private tileStates: Map<string, TileRenderState> = new Map();

  // Picking framebuffer
  private pickingFramebuffer: WebGLFramebuffer | null = null;
  private pickingTexture: WebGLTexture | null = null;
  private pickingTextureWidth = 0;
  private pickingTextureHeight = 0;

  // Highlight state
  private highlightProgram: WebGLProgram | null = null;
  private highlightVao: WebGLVertexArrayObject | null = null;
  private highlightBuffer: WebGLBuffer | null = null;
  private highlightPos: {x: number, y: number} | null = null;
  private uHighlightK: WebGLUniformLocation | null = null;
  private uHighlightT: WebGLUniformLocation | null = null;
  private uHighlightRes: WebGLUniformLocation | null = null;
  private uHighlightColor: WebGLUniformLocation | null = null;
  private uHighlightKMinLoc: WebGLUniformLocation | null = null;

  // Grid rendering state
  private gridProgram: WebGLProgram | null = null;
  private gridVao: WebGLVertexArrayObject | null = null;
  private gridBuffer: WebGLBuffer | null = null;
  private gridCount: number = 0;

  // Uniform locations
  private uGridColorLoc: WebGLUniformLocation | null = null;
  private uGridScaleLoc: WebGLUniformLocation | null = null;
  private uGridOffsetLoc: WebGLUniformLocation | null = null;
  private uTransformScaleLoc: WebGLUniformLocation | null = null;
  private uGridResolutionLoc: WebGLUniformLocation | null = null;
  private uResolutionLoc: WebGLUniformLocation | null = null;
  private uKLoc: WebGLUniformLocation | null = null;
  private uTLoc: WebGLUniformLocation | null = null;
  private uKMinLoc: WebGLUniformLocation | null = null;

  // Picking uniform locations
  private uPickingKLoc: WebGLUniformLocation | null = null;
  private uPickingTLoc: WebGLUniformLocation | null = null;
  private uPickingResolutionLoc: WebGLUniformLocation | null = null;
  private uPickingKMinLoc: WebGLUniformLocation | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2');
    if (!gl) {
      throw new Error('WebGL2 not supported');
    }
    this.gl = gl;
    this.bufferPool = new BufferPool(this.gl);

    this.initGL();
  }

  private initGL() {
    this.gl.clearColor(0, 0, 0, 1);
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
    
    this.program = this.createProgram(pointVert, pointFrag);
    if (this.program) {
        this.uResolutionLoc = this.gl.getUniformLocation(this.program, 'u_resolution');
        this.uKLoc = this.gl.getUniformLocation(this.program, 'u_k');
        this.uTLoc = this.gl.getUniformLocation(this.program, 'u_t');
        this.uKMinLoc = this.gl.getUniformLocation(this.program, 'u_k_min');
    }

    this.initGrid();
    this.initPicking();
    this.initHighlight();
  }

  public clear() {
    this.tileStates.clear();
    this.bufferPool.clear();
  }

  private initHighlight() {
      this.highlightProgram = this.createProgram(highlightVert, highlightFrag);
      if (!this.highlightProgram) return;

      this.uHighlightK = this.gl.getUniformLocation(this.highlightProgram, 'u_k');
      this.uHighlightT = this.gl.getUniformLocation(this.highlightProgram, 'u_t');
      this.uHighlightRes = this.gl.getUniformLocation(this.highlightProgram, 'u_resolution');
      this.uHighlightColor = this.gl.getUniformLocation(this.highlightProgram, 'u_color');
      this.uHighlightKMinLoc = this.gl.getUniformLocation(this.highlightProgram, 'u_k_min');
      
      this.highlightVao = this.gl.createVertexArray();
      this.highlightBuffer = this.gl.createBuffer();
      
      if (this.highlightVao && this.highlightBuffer) {
          this.gl.bindVertexArray(this.highlightVao);
          this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.highlightBuffer);
          
          const posLoc = this.gl.getAttribLocation(this.highlightProgram, 'position');
          this.gl.enableVertexAttribArray(posLoc);
          this.gl.vertexAttribPointer(posLoc, 2, this.gl.FLOAT, false, 0, 0);
          
          this.gl.bindVertexArray(null);
      }
  }

  private initGrid() {
    this.gridProgram = this.createProgram(gridVert, gridFrag);
    if (!this.gridProgram) return;

    this.uGridColorLoc = this.gl.getUniformLocation(this.gridProgram, 'u_color');
    this.uGridScaleLoc = this.gl.getUniformLocation(this.gridProgram, 'u_grid_scale');
    this.uGridOffsetLoc = this.gl.getUniformLocation(this.gridProgram, 'u_grid_offset');
    this.uTransformScaleLoc = this.gl.getUniformLocation(this.gridProgram, 'u_transform_scale');
    this.uGridResolutionLoc = this.gl.getUniformLocation(this.gridProgram, 'u_resolution');

    this.gridVao = this.gl.createVertexArray();
    this.gl.bindVertexArray(this.gridVao);

    const quadVertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1,
    ]);
    this.gridCount = 4;

    this.gridBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.gridBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, quadVertices, this.gl.STATIC_DRAW);

    const posLoc = this.gl.getAttribLocation(this.gridProgram, 'a_position');
    this.gl.enableVertexAttribArray(posLoc);
    this.gl.vertexAttribPointer(posLoc, 2, this.gl.FLOAT, false, 0, 0);

    this.gl.bindVertexArray(null);
  }

  public resize(width: number, height: number) {
    this.gl.viewport(0, 0, width, height);
    this.resizePickingTexture(width, height);
  }

  public setClearColor(r: number, g: number, b: number, a: number) {
    this.gl.clearColor(r, g, b, a);
  }

  public setGridColor(r: number, g: number, b: number, a: number) {
    if (this.gridProgram && this.uGridColorLoc) {
      this.gl.useProgram(this.gridProgram);
      this.gl.uniform4f(this.uGridColorLoc, r, g, b, a);
    }
  }

  public initTile(tile: Tile) {
    if (this.tileStates.has(tile.key)) return;
    if (!tile.data || !this.program || !this.pickingProgram) return;

    const xCol = tile.data.getChild('x');
    const yCol = tile.data.getChild('y');
    
    if (!xCol || !yCol) {
        console.warn(`Tile ${tile.key} missing x/y columns`);
        return;
    }

    const count = tile.data.numRows;
    const positions = new Float32Array(count * 2);
    const ids = new Float32Array(count * 4); // 4 components for RGBA

    for (let i = 0; i < count; i++) {
        positions[i * 2] = Number(xCol.get(i));
        positions[i * 2 + 1] = Number(yCol.get(i));
        
        // Encode ID as RGBA
        const id = i + 1; // 0 is reserved for background
        ids[i * 4] = (id & 0xFF) / 255;
        ids[i * 4 + 1] = ((id >> 8) & 0xFF) / 255;
        ids[i * 4 + 2] = ((id >> 16) & 0xFF) / 255;
        ids[i * 4 + 3] = 1.0;
    }

    const vao = this.gl.createVertexArray();
    if (!vao) return;

    // Main VAO setup
    this.gl.bindVertexArray(vao);

    // Position buffer (shared)
    const posBuffer = this.bufferPool.createBuffer(`${tile.key}_pos`, positions);
    const posLoc = this.gl.getAttribLocation(this.program, 'position');
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, posBuffer);
    this.gl.enableVertexAttribArray(posLoc);
    this.gl.vertexAttribPointer(posLoc, 2, this.gl.FLOAT, false, 0, 0);

    // Color buffer (for main program)
    const colors = new Float32Array(count * 3);
    colors.fill(1.0);
    const colorBuffer = this.bufferPool.createBuffer(`${tile.key}_color`, colors);
    const colorLoc = this.gl.getAttribLocation(this.program, 'color');
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, colorBuffer);
    this.gl.enableVertexAttribArray(colorLoc);
    this.gl.vertexAttribPointer(colorLoc, 3, this.gl.FLOAT, false, 0, 0);

    this.gl.bindVertexArray(null);

    // Picking VAO setup
    const pickingVao = this.gl.createVertexArray();
    if (!pickingVao) {
        this.gl.deleteVertexArray(vao);
        return;
    }
    this.gl.bindVertexArray(pickingVao);

    // Bind existing position buffer to picking program attrib
    const pickingPosLoc = this.gl.getAttribLocation(this.pickingProgram, 'position');
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, posBuffer);
    this.gl.enableVertexAttribArray(pickingPosLoc);
    this.gl.vertexAttribPointer(pickingPosLoc, 2, this.gl.FLOAT, false, 0, 0);

    // ID buffer (for picking program)
    const idBuffer = this.bufferPool.createBuffer(`${tile.key}_id`, ids);
    const idLoc = this.gl.getAttribLocation(this.pickingProgram, 'v_color');
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, idBuffer);
    this.gl.enableVertexAttribArray(idLoc);
    this.gl.vertexAttribPointer(idLoc, 4, this.gl.FLOAT, false, 0, 0);

    this.gl.bindVertexArray(null);

    this.tileStates.set(tile.key, { vao, pickingVao, count });
  }

  public updateAesthetics(tile: Tile, colors: Float32Array) {
      if (!this.tileStates.has(tile.key) || !this.program) return;
      
      const state = this.tileStates.get(tile.key)!;
      
      // Detect if we have RGB (3) or RGBA (4) components
      const componentsPerPoint = colors.length / state.count;
      
      if (componentsPerPoint !== 3 && componentsPerPoint !== 4) {
          console.warn(`Color buffer size mismatch for tile ${tile.key}: expected 3 or 4 components, got ${componentsPerPoint}`);
          return;
      }

      const buffer = this.bufferPool.createBuffer(`${tile.key}_color`, colors);
      
      this.gl.bindVertexArray(state.vao);
      const colorLoc = this.gl.getAttribLocation(this.program, 'color');
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
      this.gl.enableVertexAttribArray(colorLoc);
      this.gl.vertexAttribPointer(colorLoc, componentsPerPoint, this.gl.FLOAT, false, 0, 0);
      this.gl.bindVertexArray(null);
  }

  public render(tiles: Tile[], width: number, height: number, transform: {k: number, x: number, y: number, k_min?: number}) {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    this.drawGrid(width, height, transform);
    
    if (!this.program) return;
    this.gl.useProgram(this.program);

    if (this.uResolutionLoc) this.gl.uniform2f(this.uResolutionLoc, width, height);
    if (this.uKLoc) this.gl.uniform1f(this.uKLoc, transform.k);
    if (this.uTLoc) this.gl.uniform2f(this.uTLoc, transform.x, transform.y);
    if (this.uKMinLoc && transform.k_min !== undefined) this.gl.uniform1f(this.uKMinLoc, transform.k_min);

    for (const tile of tiles) {
        const state = this.tileStates.get(tile.key);
        if (state) {
            this.gl.bindVertexArray(state.vao);
            this.gl.drawArrays(this.gl.POINTS, 0, state.count);
        }
    }
    this.drawHighlight(width, height, transform);
    this.gl.bindVertexArray(null);
  }

  public setHighlight(x: number | null, y: number | null) {
      if (x === null || y === null) {
          this.highlightPos = null;
      } else {
          this.highlightPos = { x, y };
      }
  }

  private drawHighlight(width: number, height: number, transform: {k: number, x: number, y: number, k_min?: number}) {
      if (!this.highlightPos || !this.highlightProgram || !this.highlightBuffer || !this.highlightVao) return;

      this.gl.useProgram(this.highlightProgram);

      if (this.uHighlightRes) this.gl.uniform2f(this.uHighlightRes, width, height);
      if (this.uHighlightK) this.gl.uniform1f(this.uHighlightK, transform.k);
      if (this.uHighlightT) this.gl.uniform2f(this.uHighlightT, transform.x, transform.y);
      if (this.uHighlightKMinLoc && transform.k_min !== undefined) this.gl.uniform1f(this.uHighlightKMinLoc, transform.k_min);

      // Set color based on theme
      const isDarkMode = document.getElementById('app-container')?.classList.contains('dark-mode');
      if (this.uHighlightColor) {
          if (isDarkMode) {
              this.gl.uniform4f(this.uHighlightColor, 1.0, 1.0, 1.0, 1.0); // White
          } else {
              this.gl.uniform4f(this.uHighlightColor, 0.0, 0.0, 0.0, 1.0); // Black
          }
      }

      // Update buffer with single point
      const data = new Float32Array([this.highlightPos.x, this.highlightPos.y]);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.highlightBuffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.DYNAMIC_DRAW);

      this.gl.bindVertexArray(this.highlightVao);
      this.gl.drawArrays(this.gl.POINTS, 0, 1);
      this.gl.bindVertexArray(null);
  }

  private drawGrid(width: number, height: number, transform: {k: number, x: number, y: number}) {
    if (!this.gridProgram || !this.gridVao) return;

    this.gl.useProgram(this.gridProgram);

    const sx = 2 / width * transform.k;
    const sy = -2 / height * transform.k;
    const tx = -1 + 2 * transform.x / width;
    const ty = 1 - 2 * transform.y / height;

    // Calculate grid precision values on CPU
    const zoom = transform.k; // This includes baseScale
    // Logic from original shader: pow(10.0, floor(log(zoom) / log(10.0))) / 100.0
    const logZoom = Math.log10(zoom);
    const scaleExp = Math.floor(logZoom);
    const gridScale = Math.pow(10, scaleExp) / 100.0;

    // Center in Data Space
    const centerX = -tx / sx;
    const centerY = -ty / sy;

    // Aspect ratio
    const aspect = width / height;

    // Offset: fract(center * aspect_correction * scale)
    const offsetX = (centerX * aspect * gridScale) % 1.0;
    const offsetY = (centerY * 1.0 * gridScale) % 1.0;

    // Scale-only matrix for vertex shader (no translation)
    const scaleMatrix = new Float32Array([ sx, 0, 0, 0, sy, 0, 0, 0, 1 ]);

    if (this.uTransformScaleLoc) this.gl.uniformMatrix3fv(this.uTransformScaleLoc, false, scaleMatrix);
    if (this.uGridScaleLoc) this.gl.uniform1f(this.uGridScaleLoc, gridScale);
    if (this.uGridOffsetLoc) this.gl.uniform2f(this.uGridOffsetLoc, offsetX, offsetY);
    if (this.uGridResolutionLoc) this.gl.uniform2f(this.uGridResolutionLoc, width, height);

    this.gl.bindVertexArray(this.gridVao);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, this.gridCount);
    this.gl.bindVertexArray(null);
  }
  
  public isTileInitialized(tile: Tile): boolean {
      return this.tileStates.has(tile.key);
  }

  public pick(x: number, y: number, tiles: Tile[], width: number, height: number, transform: {k: number, x: number, y: number, k_min?: number}): {tile: Tile, index: number} | -1 {
    if (!this.pickingProgram || !this.pickingFramebuffer) {
      // console.warn('Renderer: picking not initialized');
      return -1;
    }
  
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.pickingFramebuffer);
    
    // Check FBO status
    const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
    if (status !== this.gl.FRAMEBUFFER_COMPLETE) {
      console.error('Renderer: Framebuffer not complete', status);
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      return -1;
    }

    this.gl.clearColor(0, 0, 0, 0); // Clear to 0
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  
    this.gl.useProgram(this.pickingProgram);
  
    if (this.uPickingResolutionLoc) this.gl.uniform2f(this.uPickingResolutionLoc, width, height);
    if (this.uPickingKLoc) this.gl.uniform1f(this.uPickingKLoc, transform.k);
    if (this.uPickingTLoc) this.gl.uniform2f(this.uPickingTLoc, transform.x, transform.y);
    if (this.uPickingKMinLoc && transform.k_min !== undefined) this.gl.uniform1f(this.uPickingKMinLoc, transform.k_min);
  
    // Sort tiles for deterministic picking. Front-most tiles (higher zoom) first.
    const sortedTiles = [...tiles].sort((a, b) => b.key.length - a.key.length);

    for (const tile of sortedTiles) {
      const state = this.tileStates.get(tile.key);
      if (state) {
        this.gl.bindVertexArray(state.pickingVao);
        this.gl.drawArrays(this.gl.POINTS, 0, state.count);
        
        const pixel = new Uint8Array(4);
        const ix = Math.floor(x);
        const iy = Math.floor(this.pickingTextureHeight - y);
        this.gl.readPixels(ix, iy, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixel);
        
        // If we hit a point, return it immediately
        if (pixel[0] + pixel[1] + pixel[2] > 0) {
            const id = pixel[0] + (pixel[1] * 256) + (pixel[2] * 256 * 256) - 1;
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
            return { tile, index: id };
        }
      }
    }
  
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    return -1;
  }

  private initPicking() {
    this.pickingProgram = this.createProgram(pickingVert, pickingFrag);
    if (!this.pickingProgram) return;

    this.uPickingKLoc = this.gl.getUniformLocation(this.pickingProgram, 'u_k');
    this.uPickingTLoc = this.gl.getUniformLocation(this.pickingProgram, 'u_t');
    this.uPickingResolutionLoc = this.gl.getUniformLocation(this.pickingProgram, 'u_resolution');
    this.uPickingKMinLoc = this.gl.getUniformLocation(this.pickingProgram, 'u_k_min');

    this.pickingTexture = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.pickingTexture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

    this.pickingFramebuffer = this.gl.createFramebuffer();
  }

  private resizePickingTexture(width: number, height: number) {
    if (!this.pickingTexture || !this.pickingFramebuffer) return;
    this.pickingTextureWidth = width;
    this.pickingTextureHeight = height;

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.pickingTexture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, width, height, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.pickingFramebuffer);
    this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, this.pickingTexture, 0);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }

  private createProgram(vertSource: string, fragSource: string): WebGLProgram | null {
    const vertShader = this.createShader(this.gl.VERTEX_SHADER, vertSource);
    const fragShader = this.createShader(this.gl.FRAGMENT_SHADER, fragSource);
    
    if (!vertShader || !fragShader) return null;

    const program = this.gl.createProgram();
    if (!program) return null;

    this.gl.attachShader(program, vertShader);
    this.gl.attachShader(program, fragShader);
    this.gl.linkProgram(program);

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      console.error('Program link error:', this.gl.getProgramInfoLog(program));
      this.gl.deleteProgram(program);
      return null;
    }

    return program;
  }

  private createShader(type: number, source: string): WebGLShader | null {
    const shader = this.gl.createShader(type);
    if (!shader) return null;

    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', this.gl.getShaderInfoLog(shader));
      this.gl.deleteShader(shader);
      return null;
    }

    return shader;
  }
}
