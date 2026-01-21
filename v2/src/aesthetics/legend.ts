import { ColorScale } from './color_manager';

export class LegendRenderer {
  private container: HTMLElement;

  constructor(containerId: string) {
    const element = document.getElementById(containerId);
    if (!element) {
      throw new Error(`Legend container '${containerId}' not found`);
    }
    this.container = element;
  }

  /**
   * Render legend for the current color scale
   */
  render(scale: ColorScale | null): void {
    this.container.innerHTML = '';

    if (!scale) {
      return;
    }

    if (scale.type === 'numeric' && scale.domain) {
      this.renderNumericLegend(scale);
    } else if (scale.type === 'categorical' && scale.mapping) {
      this.renderCategoricalLegend(scale);
    }
  }

  /**
   * Render numeric legend with gradient
   */
  private renderNumericLegend(scale: ColorScale): void {
    if (!scale.domain) return;

    // Use original domain if available (for log-scaled data)
    const originalDomain = (scale as any).originalDomain;
    const [min, max] = originalDomain || scale.domain;
    
    // Create gradient from colors
    const gradientStops = scale.colors.map((color, idx) => {
      const percent = (idx / (scale.colors.length - 1)) * 100;
      const rgb = `rgb(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)})`;
      return `${rgb} ${percent}%`;
    }).join(', ');

    const minLabel = this.formatNumber(min);
    const maxLabel = this.formatNumber(max);

    this.container.innerHTML = `
      <div style="padding: 10px;">
        <div style="font-weight: bold; margin-bottom: 5px; font-size: 12px;">${scale.field}</div>
        <div style="width: 100%; height: 20px; background: linear-gradient(to right, ${gradientStops}); border-radius: 3px;"></div>
        <div style="display: flex; justify-content: space-between; font-size: 10px; margin-top: 3px; color: #666;">
          <span>${minLabel}</span>
          <span>${maxLabel}</span>
        </div>
      </div>
    `;
  }

  /**
   * Render categorical legend with color swatches
   */
  private renderCategoricalLegend(scale: ColorScale): void {
    if (!scale.mapping) return;

    const totalItems = scale.mapping.size;
    const maxDisplay = 30;
    
    let html = `<div style="padding: 10px;">
      <div style="font-weight: bold; margin-bottom: 8px; font-size: 12px;">${scale.field}</div>
    `;

    // Show up to maxDisplay categories
    let count = 0;
    for (const [value, idx] of scale.mapping) {
      if (count >= maxDisplay) break;
      
      const color = scale.colors[idx % scale.colors.length];
      const rgb = `rgb(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)})`;

      html += `
        <div style="display: flex; align-items: center; margin-bottom: 6px;">
          <div style="width: 18px; height: 18px; background-color: ${rgb}; border-radius: 3px; margin-right: 8px; flex-shrink: 0;"></div>
          <span style="font-size: 12px; word-break: break-word;">${this.escapeHtml(String(value))}</span>
        </div>
      `;
      count++;
    }

    if (totalItems > maxDisplay) {
      html += `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(0,0,0,0.1); color: #666; font-size: 10px;">Showing ${maxDisplay} of ${totalItems} categories</div>`;
    } else {
      html += `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(0,0,0,0.1); color: #666; font-size: 10px;">${totalItems} categories</div>`;
    }
    html += '</div>';
    this.container.innerHTML = html;
  }

  /**
   * Format number for display
   */
  private formatNumber(value: number): string {
    if (!isFinite(value)) return '0';
    if (value === 0) return '0';

    const absValue = Math.abs(value);
    if (absValue < 0.01) return value.toExponential(2);
    if (absValue < 1) return value.toFixed(3);
    if (absValue < 100) return value.toFixed(2);
    if (absValue < 10000) return value.toFixed(1);
    return value.toFixed(0);
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Clear legend
   */
  clear(): void {
    this.container.innerHTML = '';
  }
}
