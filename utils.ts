// Utility functions extracted from main.js

import { NUMBER_FORMAT, DURATION, URL_TEMPLATES } from './constants';

/**
 * Format a number with D3-style suffixes (k, M, etc.)
 */
export function formatNumber(num: number): string {
  if (num >= NUMBER_FORMAT.LARGE_NUMBER_THRESHOLD) {
    return (num / NUMBER_FORMAT.LARGE_NUMBER_THRESHOLD).toFixed(1).replace(/\.0$/, '') + 'M';
  } else if (num >= NUMBER_FORMAT.THOUSAND_THRESHOLD) {
    return (num / NUMBER_FORMAT.THOUSAND_THRESHOLD).toFixed(1).replace(/\.0$/, '') + 'k';
  } else {
    return num.toString();
  }
}

/**
 * Format a duration value (convert nanoseconds to milliseconds)
 */
export function formatDuration(value: number): string {
  return `${(value / DURATION.NS_TO_MS).toFixed(2)}ms`;
}

/**
 * Format a large number with locale string
 */
export function formatLargeNumber(value: number): string {
  if (value > NUMBER_FORMAT.LARGE_NUMBER_THRESHOLD) {
    return value.toLocaleString();
  }
  return value.toString();
}

/**
 * Check if a field name is duration-related
 */
export function isDurationField(key: string): boolean {
  return key === 'dur' || key.includes('duration');
}

/**
 * Check if a field is a URL-like field
 */
export function isUrlField(key: string): boolean {
  return key.includes('uuid') || key.includes('trace');
}

/**
 * Generate a Perfetto trace URL
 */
export function getPerfettoUrl(uuid: string): string {
  return URL_TEMPLATES.PERFETTO_TRACE(uuid);
}

/**
 * Show a toast notification
 */
export function showToast(message: string): void {
  const toast = document.getElementById('notification-toast');
  if (toast) {
    toast.textContent = message;
    toast.className = 'toast show';
    setTimeout(() => {
      toast.className = toast.className.replace('show', '');
    }, 3000);
  }
}

/**
 * Format a value for display based on its type and field name
 */
export function formatValue(key: string, value: any): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'number') {
    if (isDurationField(key)) {
      return formatDuration(value);
    } else if (value > NUMBER_FORMAT.LARGE_NUMBER_THRESHOLD) {
      return formatLargeNumber(value);
    }
  }

  return String(value);
}

/**
 * Create a link element for URL fields
 */
export function createLink(key: string, value: string, displayValue: string): string {
  if (isUrlField(key)) {
    const url = getPerfettoUrl(value);
    return `<a href="${url}" target="_blank">${displayValue}</a>`;
  }
  return displayValue;
}
