export interface RenderSpec {
  x: string;
  y: string;
  color?: string | AestheticSpec;
  size?: number | string | AestheticSpec;
  transition?: number;
}

export interface AestheticSpec {
  field: string;
  scale?: string;
  domain?: [number, number];
  range?: any[];
}

export interface ScatterGLOptions {
  onClick?: (datum: any) => void;
  onHover?: (datum: any) => void;
}
