/**
 * Visual rendering utilities
 * Handles chart generation and legend rendering
 */

import vegaEmbed from 'vega-embed';
import type { DataRange } from './types';

/**
 * Render a Vega chart in the specified container
 */
export function renderChart(
  containerId: string,
  data: any[],
  column: string,
  isNumeric: boolean,
  containerWidth: number,
  containerHeight: number
): void {
  // Convert to String to properly decode Arrow dictionary-encoded columns
  console.log(`[visuals] Creating chart for column: ${column}, data length: ${data.length}`);
  const chartData = data.map((d, idx) => {
    const rawValue = d[column];
    const stringValue = String(rawValue);
    if (idx < 3) {
      console.log(`[visuals] Row ${idx}, column ${column}: raw=`, rawValue, `type=${typeof rawValue}, string=`, stringValue);
    }
    return { [column]: stringValue };
  });
  console.log(`[visuals] Chart data sample:`, chartData.slice(0, 3));
  
  let spec: any;
  if (isNumeric) {
    spec = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      data: { values: chartData },
      mark: { type: 'bar', tooltip: true },
      encoding: {
        x: { field: column, type: 'quantitative', bin: true, title: column },
        y: { aggregate: 'count', type: 'quantitative', title: 'Count' }
      },
      width: containerWidth - 100,
      height: Math.max(300, containerHeight - 40)
    };
  } else {
    const uniqueValues = new Set(chartData.map(d => d[column]));
    spec = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      data: { values: chartData },
      mark: { type: 'bar', tooltip: true },
      encoding: {
        y: { field: column, type: 'nominal', sort: '-x', title: column },
        x: { aggregate: 'count', type: 'quantitative', title: 'Count' }
      },
      width: containerWidth - 80,
      height: uniqueValues.size * 25
    };
  }
  
  vegaEmbed(containerId, spec, { actions: false });
}

/**
 * Update the legend display based on the color encoding
 */
export function updateLegend(
  legendElement: HTMLElement,
  colorEncoding: any,
  globalMapping: any,
  dataRange: DataRange | null
): void {
  legendElement.innerHTML = '';
  
  const isNumericEncoding = colorEncoding.transform === 'log' || colorEncoding.transform === 'linear';
  
  if (isNumericEncoding) {
    // Create gradient for numeric data
    const gradientColors = colorEncoding.range.join(', ');
    
    let rangeLabels = '';
    if (dataRange) {
      const formatLabel = (value: number) => {
        const numValue = Number(value);
        if (!isFinite(numValue)) return '0';
        if (numValue === 0) return '0';
        
        const absValue = Math.abs(numValue);
        if (absValue < 0.01) return numValue.toExponential(2);
        if (absValue < 1) return numValue.toFixed(3);
        if (absValue < 100) return numValue.toFixed(2);
        if (absValue < 10000) return numValue.toFixed(1);
        return numValue.toFixed(0);
      };
      
      const minLabel = formatLabel(dataRange.min);
      const maxLabel = formatLabel(dataRange.max);
      
      rangeLabels = `
        <div style="display: flex; justify-content: space-between; font-size: 10px; margin-top: 2px; color: #666;">
          <span>${minLabel}</span>
          <span>${maxLabel}</span>
        </div>
      `;
    }
    
    legendElement.innerHTML = `
      <div style="display: flex; flex-direction: column;">
        <div style="width: 100%; height: 20px; background: linear-gradient(to right, ${gradientColors});"></div>
        ${rangeLabels}
      </div>
    `;
  } else if (globalMapping) {
    // Categorical legend - show up to the number of unique colors available
    const numUniqueColors = colorEncoding.range.length;
    const maxItemsToShow = numUniqueColors;
    
    // Get total count without creating full array
    const totalCategories = Object.keys(globalMapping).length;
    
    // Build legend HTML efficiently - only iterate what we need
    let legendHTML = '';
    let count = 0;
    
    for (const [value, index] of Object.entries(globalMapping)) {
      if (count >= maxItemsToShow) break;
      
      const color = colorEncoding.range[(index as number) % colorEncoding.range.length];
      legendHTML += `
        <div style="display: flex; align-items: center; margin-bottom: 5px;">
          <div style="width: 20px; height: 20px; background-color: ${color};"></div>
          <span style="margin-left: 5px;">${value}</span>
        </div>
      `;
      count++;
    }
    
    // Show "and X more" message if there are more categories
    if (totalCategories > maxItemsToShow) {
      const remaining = totalCategories - maxItemsToShow;
      legendHTML += `
        <div style="padding: 5px 0; color: #666; font-size: 11px; font-style: italic;">
          ...and ${remaining} more (${totalCategories} total)
        </div>
      `;
    }
    
    legendElement.innerHTML = legendHTML;
  }
}

/**
 * Format a number for display (e.g., 1000 -> 1k, 1000000 -> 1M)
 */
export function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return num.toString();
}
