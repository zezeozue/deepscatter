// Web Worker for parsing CSV/TSV/JSON data
// This runs in a separate thread to avoid blocking the UI

self.onmessage = function(e) {
  const { text, fileName } = e.data;
  
  try {
    let data;
    let i = 0;
    
    self.postMessage({ type: 'progress', progress: 10, text: 'Parsing file...' });
    
    if (fileName.endsWith('.json')) {
      // Parse JSON
      const jsonData = JSON.parse(text);
      const arrayData = Array.isArray(jsonData) ? jsonData : (jsonData.data || jsonData);
      
      if (!Array.isArray(arrayData)) {
        self.postMessage({ type: 'error', message: 'JSON must be an array of objects or contain a "data" array' });
        return;
      }
      
      self.postMessage({ type: 'progress', progress: 30, text: `Processing ${arrayData.length} rows...` });
      
      // Process in chunks to allow progress updates
      const chunkSize = 1000;
      const result = [];
      
      for (let start = 0; start < arrayData.length; start += chunkSize) {
        const end = Math.min(start + chunkSize, arrayData.length);
        const chunk = arrayData.slice(start, end);
        
        for (const d of chunk) {
          const row = { ...d };
          // Coerce numeric types
          for (const key in row) {
            if (!isNaN(row[key]) && row[key] !== '' && row[key] !== null) {
              row[key] = +row[key];
            }
          }
          row.ix = i++;
          result.push(row);
        }
        
        // Update progress
        const progress = 30 + (start / arrayData.length) * 60;
        self.postMessage({ 
          type: 'progress', 
          progress: Math.round(progress), 
          text: `Processed ${end} / ${arrayData.length} rows...` 
        });
      }
      
      data = result;
      data.columns = Object.keys(data[0] || {}).filter(k => k !== 'ix');
      
    } else {
      // More robust CSV parsing with type detection and error handling
      const guessDelimiter = (header) => {
        const delimiters = [',', '\t', ';', '|'];
        return delimiters.sort((a, b) => header.split(b).length - header.split(a).length)[0];
      };

      // Parses a CSV string, handling quoted fields and newlines.
      const parseCsv = (csvText) => {
        const rows = [];
        let inQuote = false;
        let currentField = '';
        let currentRow = [];
        let line = 1;

        const delimiter = guessDelimiter(csvText.substring(0, csvText.indexOf('\n')));

        for (let i = 0; i < csvText.length; i++) {
          const char = csvText[i];
          const nextChar = i < csvText.length - 1 ? csvText[i + 1] : null;

          if (inQuote) {
            // Handle escaped quotes
            if (char === '"' && nextChar === '"') {
              currentField += '"';
              i++; // Skip the next quote
            } else if (char === '"') {
              inQuote = false;
            } else {
              currentField += char;
            }
          } else {
            if (char === '"') {
              inQuote = true;
            } else if (char === delimiter) {
              currentRow.push(currentField.trim());
              currentField = '';
            } else if (char === '\n') {
              currentRow.push(currentField.trim());
              rows.push({ data: currentRow, line });
              currentRow = [];
              currentField = '';
              line++;
            } else {
              currentField += char;
            }
          }
        }
        if (currentRow.length > 0 || currentField) {
            currentRow.push(currentField.trim());
            rows.push({ data: currentRow, line });
        }
        return rows;
      };

      const parsedRows = parseCsv(text);
      if (parsedRows.length < 2) {
          self.postMessage({ type: 'error', message: 'CSV file must have a header and at least one data row.' });
          return;
      }
      
      const headers = parsedRows[0].data.map(h => h.replace(/^"|"$/g, ''));
      const rawData = parsedRows.slice(1);

      // 3. Type Detection
      const column_types = {};
      const sample = rawData.slice(0, Math.min(100, rawData.length));
      for (const header of headers) {
        column_types[header] = 'numeric';
      }

      for (const row of sample) {
        const values = row.data;
        for (let i = 0; i < headers.length; i++) {
          const value = values[i];
          if (value !== '' && isNaN(value)) {
            column_types[headers[i]] = 'categorical';
          }
        }
      }
      self.postMessage({ type: 'progress', progress: 30, text: 'Detected column types...' });
      
      // 4. Full Parse with Error Handling
      const result = [];
      const parsing_errors = [];
      
      for(const rawRow of rawData) {
        const values = rawRow.data;
        if (values.length !== headers.length) {
            parsing_errors.push({ line: rawRow.line, error: `Expected ${headers.length} columns, but found ${values.length}` });
            continue;
        }

        const row = { ix: i++ };
        for (let k = 0; k < headers.length; k++) {
            const header = headers[k];
            const value = values[k];

            if (column_types[header] === 'numeric') {
              if (value === '' || value === null) {
                row[header] = null;
              } else if (!isNaN(value)) {
                row[header] = +value;
              } else {
                row[header] = null; // Set to null on parsing error
                parsing_errors.push({ line: rawRow.line, column: header, value: value });
              }
            } else {
              row[header] = value;
            }
        }
        result.push(row);

        if (i % 1000 === 0) {
            const progress = 30 + (i / rawData.length) * 60;
            self.postMessage({ type: 'progress', progress: Math.round(progress), text: `Processed ${i}/${rawData.length} rows...` });
        }
      }
      
      if (parsing_errors.length > 0) {
        const error_summary = `Dropped ${parsing_errors.length} non-numeric values from numeric columns.`;
        console.warn(`[Worker] ${error_summary}`);
        self.postMessage({ type: 'warning', message: error_summary, details: parsing_errors });
      }

      data = result;
      data.columns = headers;
    }
    
    self.postMessage({ type: 'progress', progress: 95, text: 'Finalizing...' });
    
    // Invert y-axis
    let y_min = Infinity;
    let y_max = -Infinity;

    // First pass: find min and max 'y'
    for (const row of data) {
      if (row.y !== undefined) {
        if (row.y < y_min) y_min = row.y;
        if (row.y > y_max) y_max = row.y;
      }
    }

    // Second pass: invert 'y' values
    if (y_min !== Infinity) {
      for (const row of data) {
        if (row.y !== undefined) {
          row.y = y_max - (row.y - y_min);
        }
      }
    }

    // Send the parsed data back
    self.postMessage({ type: 'complete', data: data });
    
  } catch (error) {
    console.error('[Worker] Error during parsing:', error);
    self.postMessage({ type: 'error', message: error.message });
  }
};

console.log('[Worker] Worker script loaded and ready');