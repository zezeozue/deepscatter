import { zoom, ZoomBehavior, D3ZoomEvent, zoomIdentity } from 'd3-zoom';
import { select, pointer } from 'd3-selection';

export interface Transform {
  k: number;
  x: number;
  y: number;
}

export class Controller {
  private element: HTMLElement;
  private zoomBehavior: ZoomBehavior<HTMLElement, unknown>;
  private onUpdate: (transform: Transform) => void;
  private onHover: (x: number, y: number) => void;
  private onClick: (x: number, y: number) => void;
  private isZooming: boolean = false;

  constructor(
    element: HTMLElement,
    onUpdate: (transform: Transform) => void,
    onHover: (x: number, y: number) => void,
    onClick: (x: number, y: number) => void
  ) {
    this.element = element;
    this.onUpdate = onUpdate;
    this.onHover = onHover;
    this.onClick = onClick;

    this.zoomBehavior = zoom<HTMLElement, unknown>()
      .scaleExtent([0.1, 1000000]) // Allow deep zoom
      .on('start', () => {
        this.isZooming = true;
      })
      .on('zoom', (event: D3ZoomEvent<HTMLElement, unknown>) => {
        this.onUpdate({
            k: event.transform.k,
            x: event.transform.x,
            y: event.transform.y
        });
      })
      .on('end', () => {
        this.isZooming = false;
      });
    
    const s = select(element);
    s.call(this.zoomBehavior);
    s.on('mousemove', (event) => {
      // Don't hover while dragging/zooming
      if (this.isZooming || event.buttons > 0) return;
      const [x, y] = pointer(event);
      // console.log('Controller: mousemove', x, y);
      this.onHover(x, y);
    });
    s.on('click', (event) => {
      if (event.defaultPrevented) return; // Ignore if zoom handled it (e.g. drag end)
      const [x, y] = pointer(event);
      // console.log('Controller: click', x, y);
      this.onClick(x, y);
    });
  }

  public setTransform(k: number, x: number, y: number) {
      // Update extent to accommodate the new k
      // Allow zooming out 10x from fit, and in 1M x
      this.zoomBehavior.scaleExtent([k * 0.1, k * 1000000]);
      select(this.element).call(this.zoomBehavior); // Apply new extent

      const t = zoomIdentity.translate(x, y).scale(k);
      select(this.element).call(this.zoomBehavior.transform, t);
      
      this.onUpdate({ k: t.k, x: t.x, y: t.y });
  }

  public disable() {
    select(this.element).on('.zoom', null);
  }

  public enable() {
    select(this.element).call(this.zoomBehavior);
  }

  public get transform(): Transform {
    const t = zoomIdentity;
    return { k: t.k, x: t.x, y: t.y };
  }
}
