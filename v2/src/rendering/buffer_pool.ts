export class BufferPool {
  private gl: WebGL2RenderingContext;
  private buffers: Map<string, WebGLBuffer>;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.buffers = new Map();
  }

  public createBuffer(name: string, data: Float32Array, usage: number = WebGL2RenderingContext.STATIC_DRAW): WebGLBuffer {
    if (this.buffers.has(name)) {
      this.deleteBuffer(name);
    }
    const buffer = this.gl.createBuffer();
    if (!buffer) throw new Error('Failed to create buffer');
    
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, data, usage);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);

    this.buffers.set(name, buffer);
    return buffer;
  }

  public getBuffer(name: string): WebGLBuffer | undefined {
    return this.buffers.get(name);
  }

  public deleteBuffer(name: string) {
    const buffer = this.buffers.get(name);
    if (buffer) {
      this.gl.deleteBuffer(buffer);
      this.buffers.delete(name);
    }
  }

  public clear() {
    for (const name of this.buffers.keys()) {
      this.deleteBuffer(name);
    }
  }
}
