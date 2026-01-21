export interface Scale<T> {
  (value: number): T;
}

export function linearScale(domain: [number, number], range: [number, number]): Scale<number> {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const rangeSpan = r1 - r0;
  const domainSpan = d1 - d0 || 1; // Avoid divide by zero
  
  return (x: number) => {
      const t = (x - d0) / domainSpan;
      return r0 + t * rangeSpan;
  };
}

export function colorScale(domain: [number, number]): Scale<[number, number, number]> {
    const min = domain[0];
    const max = domain[1];
    const span = max - min || 1;

    return (x: number) => {
        let t = (x - min) / span;
        t = Math.max(0, Math.min(1, t)); // Clamp
        
        // Simple Viridis-like approximation or just Blue-Red
        // Let's do a simple Blue -> Cyan -> Green -> Yellow -> Red
        // 0.0: 0,0,1
        // 0.25: 0,1,1
        // 0.5: 0,1,0
        // 0.75: 1,1,0
        // 1.0: 1,0,0
        
        const r = Math.max(0, Math.min(1, Math.abs(t - 0.75) * 4 - 1)); // Red? No this is tricky manually.
        
        // Simpler: Turbo-like (rainbow)
        // Or just mix
        // Blue (0,0,1) -> Red (1,0,0)
        return [t, 0, 1 - t];
    };
}
