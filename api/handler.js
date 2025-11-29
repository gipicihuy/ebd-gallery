// api/handler.js - Vercel Serverless Function
// Simpan di: /api/handler.js

const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const os = require('os');

const app = express();

// Use /tmp untuk Vercel (temp storage)
const uploadDir = os.tmpdir();
const upload = multer({ 
  dest: uploadDir,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Database di memory (replace dengan DB nanti)
let imageDatabase = [];

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const QU_AX_URL = 'https://qu.ax/upload.php';
const WEBSITE_BASE_URL = process.env.WEBSITE_BASE_URL || 'https://gallery.eberardos.my.id';

// Helper: Generate short code
function generateShortCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Helper: Check short code unique
function isShortCodeUnique(code) {
  return !imageDatabase.some(img => img.short_code === code);
}

// Helper: Upload to qu.ax
async function uploadToQuax(filePath) {
  try {
    const form = new FormData();
    const fileStream = fs.createReadStream(filePath);
    form.append('files[]', fileStream);

    const response = await axios.post(QU_AX_URL, form, {
      headers: {
        ...form.getHeaders(),
        'Referer': 'https://qu.ax/'
      },
      timeout: 30000
    });

    if (response.data?.files?.[0]?.url) {
      return response.data.files[0].url;
    }
    throw new Error('No URL from qu.ax');
  } catch (error) {
    console.error('Qu.ax error:', error.message);
    throw error;
  }
}

// Helper: Sanitize filename
function sanitizeFilename(filename) {
  return filename
    .replace(/[^a-zA-Z0-9_\s.-]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100);
}

// Routes

// GET /api/images - Get all images
app.get('/api/images', (req, res) => {
  try {
    const sorted = [...imageDatabase].sort((a, b) => 
      new Date(b.uploaded_at) - new Date(a.uploaded_at)
    );
    res.json(sorted);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch images' });
  }
});

// GET /api/images/:shortCode - Get single image
app.get('/api/images/:shortCode', (req, res) => {
  try {
    const image = imageDatabase.find(img => img.short_code === req.params.shortCode);
    
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    res.json(image);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch image' });
  }
});

// POST /api/images/upload - Upload image
app.post('/api/images/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log(`[Upload] Processing: ${req.file.originalname}`);

    // Upload to qu.ax
    const quaxUrl = await uploadToQuax(req.file.path);

    // Generate unique short code
    let shortCode;
    let attempts = 0;
    do {
      shortCode = generateShortCode();
      attempts++;
    } while (!isShortCodeUnique(shortCode) && attempts < 10);

    if (!isShortCodeUnique(shortCode)) {
      return res.status(500).json({ error: 'Failed to generate unique code' });
    }

    // Create record
    const imageRecord = {
      id: imageDatabase.length + 1,
      original_name: sanitizeFilename(req.file.originalname),
      quax_url: quaxUrl,
      short_code: shortCode,
      uploaded_at: new Date().toISOString(),
      size: req.file.size
    };

    imageDatabase.push(imageRecord);

    // Cleanup
    try {
      fs.unlinkSync(req.file.path);
    } catch (e) {
      console.warn('Could not delete temp file:', e.message);
    }

    console.log(`[Upload] Success: ${imageRecord.short_code}`);

    res.json({
      success: true,
      image: imageRecord,
      shareUrl: `${WEBSITE_BASE_URL}/preview/${shortCode}`
    });

  } catch (error) {
    console.error('[Upload] Error:', error.message);

    // Cleanup
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        // Ignore
      }
    }

    res.status(500).json({
      error: 'Upload failed',
      message: error.message
    });
  }
});

// DELETE /api/images/:id - Delete image
app.delete('/api/images/:id', (req, res) => {
  try {
    const index = imageDatabase.findIndex(img => img.id === parseInt(req.params.id));
    
    if (index === -1) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const deleted = imageDatabase.splice(index, 1)[0];
    res.json({ success: true, deleted });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// POST /api/images/migrate - Batch import
app.post('/api/images/migrate', (req, res) => {
  try {
    const { images } = req.body;
    
    if (!Array.isArray(images)) {
      return res.status(400).json({ error: 'Invalid format' });
    }

    let imported = 0;
    const results = [];

    for (const image of images) {
      try {
        const record = {
          id: imageDatabase.length + 1,
          original_name: image.original_name,
          quax_url: image.quax_url,
          short_code: image.short_code,
          uploaded_at: image.uploaded_at,
          size: image.size || 0
        };
        
        imageDatabase.push(record);
        results.push({ ...record, status: 'imported' });
        imported++;
      } catch (err) {
        results.push({ 
          original_name: image.original_name, 
          status: 'failed', 
          error: err.message 
        });
      }
    }

    res.json({ success: true, imported, results });
  } catch (error) {
    res.status(500).json({ error: 'Migration failed', message: error.message });
  }
});

// GET /api/health - Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    images: imageDatabase.length,
    environment: process.env.NODE_ENV || 'development'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
