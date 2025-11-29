// api/handler.js - Vercel Serverless Function
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();

// Multer config
const upload = multer({ 
  dest: os.tmpdir(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Database (in-memory)
let imageDatabase = [];

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serve static files dari public folder
app.use(express.static(path.join(__dirname, '../public')));

const QU_AX_URL = 'https://qu.ax/upload.php';
const WEBSITE_BASE_URL = process.env.WEBSITE_BASE_URL || 'https://ebd-gallery.vercel.app';

// Helpers
function generateShortCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function isShortCodeUnique(code) {
  return !imageDatabase.some(img => img.short_code === code);
}

async function uploadToQuax(filePath) {
  try {
    const form = new FormData();
    form.append('files[]', fs.createReadStream(filePath));

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

function sanitizeFilename(filename) {
  return filename
    .replace(/[^a-zA-Z0-9_\s.-]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100);
}

// API Routes

// GET /api/images
app.get('/api/images', (req, res) => {
  try {
    const sorted = [...imageDatabase].sort((a, b) => 
      new Date(b.uploaded_at) - new Date(a.uploaded_at)
    );
    res.json(sorted);
  } catch (error) {
    console.error('Error fetching images:', error);
    res.status(500).json({ error: 'Failed to fetch images' });
  }
});

// GET /api/images/:shortCode
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

// POST /api/images/upload
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
      // Ignore
    }

    console.log(`[Upload] Success: ${shortCode}`);

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

// DELETE /api/images/:id
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

// POST /api/images/migrate
app.post('/api/images/migrate', (req, res) => {
  try {
    const { images } = req.body;
    
    if (!Array.isArray(images)) {
      return res.status(400).json({ error: 'Invalid format' });
    }

    let imported = 0;

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
        imported++;
      } catch (err) {
        console.error('Import error:', err.message);
      }
    }

    res.json({ success: true, imported });
  } catch (error) {
    res.status(500).json({ error: 'Migration failed' });
  }
});

// GET /api/health
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    images: imageDatabase.length,
    environment: process.env.NODE_ENV || 'production',
    timestamp: new Date().toISOString()
  });
});

// Serve index.html untuk SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
