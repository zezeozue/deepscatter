import type { Table } from 'apache-arrow';

// Global application state
export const appState = {
  // Store the original Arrow table for accessing all columns (including strings)
  // This is needed because subdivided tiles lose string columns
  originalTable: null as Table | null,
};
