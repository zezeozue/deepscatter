// CSV/TSV/JSON parser worker - runs in separate thread to avoid blocking UI

interface WorkerMsg {
  text: string;
  fileName: string;
}

type WorkerResponse =
  | { type: 'progress'; progress: number; text: string }
  | { type: 'complete'; data: ParsedData }
  | { type: 'warning'; message: string; details?: ParseError[] }
  | { type: 'error'; message: string };

type ParsedRow = {
  ix: number;
} & Record<string, string | number | null>;

interface ParsedData extends Array<ParsedRow> {
  columns: string[];
}

interface ParseError {
  line: number;
  column?: string;
  value?: string;
  error?: string;
}

self.onmessage = function(e: MessageEvent<WorkerMsg>) {
  const { text, fileName } = e.data;
  
  try {
    let data: ParsedData;
    let i = 0;
    
    self.postMessage({ type: 'progress', progress: 10, text: 'Parsing file...' });
    
    if (fileName.endsWith('.json')) {
      const jsonData = JSON.parse(text);
      const arrayData = Array.isArray(jsonData) ? jsonData : (jsonData.data || jsonData);
      
      if (!Array.isArray(arrayData)) {
        self.postMessage({ type: 'error', message: 'JSON must be array or contain "data" array' });
        return;
      }
      
      self.postMessage({ type: 'progress', progress: 30, text: `Processing ${arrayData.length} rows...` });
      
      const chunkSize = 1000;
      const result: ParsedRow[] = [];
      
      for (let start = 0; start < arrayData.length; start += chunkSize) {
        const end = Math.min(start + chunkSize, arrayData.length);
        const chunk = arrayData.slice(start, end);
        
        for (const d of chunk) {
          const row: ParsedRow = { ...d, ix: i++ };
          for (const key in row) {
            if (key !== 'ix') {
              const value = row[key];
              if (typeof value === 'string' && !isNaN(Number(value)) && value !== '') {
                row[key] = +value;
              }
            }
          }
          result.push(row);
        }
        
        const progress = 30 + (start / arrayData.length) * 60;
        self.postMessage({ type: 'progress', progress: Math.round(progress), text: `Processed ${end} / ${arrayData.length} rows...` });
      }
      
      data = result as ParsedData;
      data.columns = Object.keys(data[0] || {}).filter(k => k !== 'ix');
      
    } else {
      // CSV/TSV parsing
      const guessDelimiter = (header: string): string => {
        const delims = [',', '\t', ';', '|'];
        return delims.sort((a, b) => header.split(b).length - header.split(a).length)[0];
      };

      const parseCsv = (csvText: string) => {
        const rows: { data: string[]; line: number }[] = [];
        let inQuote = false;
        let field = '';
        let row: string[] = [];
        let line = 1;
        const delim = guessDelimiter(csvText.substring(0, csvText.indexOf('\n')));

        for (let i = 0; i < csvText.length; i++) {
          const char = csvText[i];
          const next = i < csvText.length - 1 ? csvText[i + 1] : null;

          if (inQuote) {
            if (char === '"' && next === '"') {
              field += '"';
              i++;
            } else if (char === '"') {
              inQuote = false;
            } else {
              field += char;
            }
          } else {
            if (char === '"') {
              inQuote = true;
            } else if (char === delim) {
              row.push(field.trim());
              field = '';
            } else if (char === '\n') {
              row.push(field.trim());
              rows.push({ data: row, line });
              row = [];
              field = '';
              line++;
            } else {
              field += char;
            }
          }
        }
        if (row.length > 0 || field) {
          row.push(field.trim());
          rows.push({ data: row, line });
        }
        return rows;
      };

      const parsed = parseCsv(text);
      if (parsed.length < 2) {
        self.postMessage({ type: 'error', message: 'CSV must have header and at least one data row' });
        return;
      }
      
      const headers = parsed[0].data.map(h => h.replace(/^"|"$/g, ''));
      const rawData = parsed.slice(1);

      // Detect column types
      const colTypes: Record<string, 'numeric' | 'categorical'> = {};
      const sample = rawData.slice(0, Math.min(100, rawData.length));
      
      for (const header of headers) {
        colTypes[header] = 'numeric';
      }

      for (const row of sample) {
        for (let i = 0; i < headers.length; i++) {
          if (row.data[i] !== '' && isNaN(Number(row.data[i]))) {
            colTypes[headers[i]] = 'categorical';
          }
        }
      }
      
      self.postMessage({ type: 'progress', progress: 30, text: 'Detected column types...' });
      
      // Parse with type coercion
      const result: ParsedRow[] = [];
      const errors: ParseError[] = [];
      
      for (const rawRow of rawData) {
        const values = rawRow.data;
        if (values.length !== headers.length) {
          errors.push({ line: rawRow.line, error: `Expected ${headers.length} columns, got ${values.length}` });
          continue;
        }

        const row: ParsedRow = { ix: i++ };
        for (let k = 0; k < headers.length; k++) {
          const header = headers[k];
          const value = values[k];

          if (colTypes[header] === 'numeric') {
            if (value === '' || value === null) {
              row[header] = null;
            } else if (!isNaN(Number(value))) {
              row[header] = +value;
            } else {
              row[header] = null;
              errors.push({ line: rawRow.line, column: header, value });
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
      
      if (errors.length > 0) {
        console.warn(`[Worker] Dropped ${errors.length} non-numeric values`);
        self.postMessage({ type: 'warning', message: `Dropped ${errors.length} non-numeric values`, details: errors });
      }

      data = result as ParsedData;
      data.columns = headers;
    }
    
    self.postMessage({ type: 'progress', progress: 95, text: 'Finalizing...' });
    
    // Invert y-axis
    let yMin = Infinity;
    let yMax = -Infinity;

    for (const row of data) {
      if (typeof row.y === 'number') {
        if (row.y < yMin) yMin = row.y;
        if (row.y > yMax) yMax = row.y;
      }
    }

    if (yMin !== Infinity) {
      for (const row of data) {
        if (typeof row.y === 'number') {
          row.y = yMax - (row.y - yMin);
        }
      }
    }

    self.postMessage({ type: 'complete', data });
    
  } catch (error) {
    console.error('[Worker] Parse error:', error);
    const msg = error instanceof Error ? error.message : String(error);
    self.postMessage({ type: 'error', message: msg });
  }
};

console.log('[Worker] Ready');
