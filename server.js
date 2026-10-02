import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = join(__dirname, 'sync_data.json');

// In-memory sync store backed by JSON file
let syncStore = {};
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    syncStore = JSON.parse(raw);
  }
} catch (err) {
  console.error('Error reading sync_data.json:', err);
  syncStore = {};
}

let saveTimer = null;
function persistSyncStore() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(syncStore, null, 2), 'utf8');
    } catch (err) {
      console.error('Error writing sync_data.json:', err);
    }
  }, 500);
}

function generateCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let rand = '';
  for (let i = 0; i < 4; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `OX-${rand}`;
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));

// API: Generate new sync code
app.get('/api/sync/new-code', (req, res) => {
  let code = generateCode();
  let tries = 0;
  while (syncStore[code] && tries < 50) {
    code = generateCode();
    tries++;
  }
  res.json({ code });
});

// API: Save sync data
app.post('/api/sync/save', (req, res) => {
  const { code, marks, starred, lastIndex } = req.body || {};
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ success: false, error: 'Geçersiz eşitleme kodu.' });
  }

  const cleanCode = code.trim().toUpperCase();
  syncStore[cleanCode] = {
    marks: marks || {},
    starred: starred || {},
    lastIndex: typeof lastIndex === 'number' ? lastIndex : 0,
    updatedAt: Date.now()
  };

  persistSyncStore();
  res.json({ success: true, code: cleanCode, updatedAt: syncStore[cleanCode].updatedAt });
});

// API: Load sync data
app.get('/api/sync/load/:code', (req, res) => {
  const code = (req.params.code || '').trim().toUpperCase();
  const entry = syncStore[code];
  if (!entry) {
    return res.json({ success: true, found: false });
  }
  res.json({ success: true, found: true, data: entry });
});

// API: Generate QR Code SVG
app.get('/api/sync/qr/:code', async (req, res) => {
  try {
    const code = (req.params.code || '').trim().toUpperCase();
    const host = req.get('host') || 'localhost:3000';
    const isHttps = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
    const protocol = isHttps ? 'https' : 'http';
    const syncUrl = `${protocol}://${host}/?sync=${code}`;

    const svg = await QRCode.toString(syncUrl, {
      type: 'svg',
      margin: 1,
      width: 220,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(svg);
  } catch (err) {
    console.error('QR generation error:', err);
    res.status(500).send('QR code generation failed');
  }
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
