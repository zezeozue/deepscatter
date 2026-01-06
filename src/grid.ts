import { Zoom } from './interaction';

export class Grid {
  private zoom: Zoom;
  private svg: SVGSVGElement;

  constructor(container: HTMLElement, zoom: Zoom) {
    this.zoom = zoom;

    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.style.position = 'absolute';
    this.svg.style.top = '0';
    this.svg.style.left = '0';
    this.svg.style.width = '100%';
    this.svg.style.height = '100%';
    this.svg.style.pointerEvents = 'none';

    // We still use the constructor argument 'container' here:
    container.appendChild(this.svg);

    this.zoom.scatterplot.on_zoom = this.render.bind(this);
    this.render();
  }

  private render() {
    const scales = this.zoom.scales();
    if (!scales) return;
    const { x_: x_scale, y_: y_scale } = scales;

    const x_ticks_d3 = x_scale.ticks(12);
    const y_ticks_d3 = y_scale.ticks(12);

    const get_extended_ticks = (scale, ticks) => {
      const domain = scale.domain();

      // If the domain is too small, d3.ticks() might return 0 or 1 ticks.
      if (ticks.length < 2) {
        // If domain is a single point, create a single tick.
        if (domain[0] === domain[1]) {
          return [domain[0]];
        }
        // Otherwise, create a few ticks manually to show something.
        const num_ticks = 5;
        const step = (domain[1] - domain[0]) / num_ticks;
        const manual_ticks = Array.from(
          { length: num_ticks + 1 },
          (_, i) => domain[0] + i * step,
        );
        return manual_ticks;
      }
      const step = ticks[1] - ticks[0];

      if (step <= 0) return ticks;

      const extended_ticks = [...ticks];

      // Add ticks to the beginning - extend well beyond domain start
      let first_tick = ticks[0] - step;
      while (first_tick > domain[0] - step * 3) {
        extended_ticks.unshift(first_tick);
        first_tick -= step;
      }

      // Add ticks to the end - extend well beyond domain end
      let last_tick = ticks[ticks.length - 1] + step;
      while (last_tick < domain[1] + step * 3) {
        extended_ticks.push(last_tick);
        last_tick += step;
      }
      return extended_ticks;
    };

    const x_ticks = get_extended_ticks(x_scale, x_ticks_d3);
    const y_ticks = get_extended_ticks(y_scale, y_ticks_d3);

    while (this.svg.firstChild) {
      this.svg.removeChild(this.svg.firstChild);
    }

    for (const tick of x_ticks) {
      const x_pos = x_scale(tick);
      const line = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'line',
      );
      line.setAttribute('x1', String(x_pos));
      line.setAttribute('y1', '0');
      line.setAttribute('x2', String(x_pos));
      line.setAttribute('y2', '100%');
      line.setAttribute('stroke', 'rgba(0,0,0,0.1)');
      line.setAttribute('stroke-width', '1');
      this.svg.appendChild(line);
    }

    for (const tick of y_ticks) {
      const y_pos = y_scale(tick);
      const line = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'line',
      );
      line.setAttribute('x1', '0');
      line.setAttribute('y1', String(y_pos));
      line.setAttribute('x2', '100%');
      line.setAttribute('y2', String(y_pos));
      line.setAttribute('stroke', 'rgba(0,0,0,0.1)');
      line.setAttribute('stroke-width', '1');
      this.svg.appendChild(line);
    }
  }
}
