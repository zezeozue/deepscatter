import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Serve tiles directory
app.use('/tiles', express.static(path.join(__dirname, 'tiles')));

export default app;
