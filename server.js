// server.js - Backend untuk Qu.ax Integration
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const upload = multer({ dest: 'uploads/', limits: { fileSize: 5 * 1024 * 1024 } });

// Database sederhana (bisa diganti dengan MongoDB, SQLite, dll)
const imageDatabase = [];

// Middleware
app.use(cors());
app.use(express.json());

const QU_AX_URL = 'https://qu.ax/upload.php';
const WEBSITE_BASE_URL = process.env.WEBSITE_BASE_URL || 'https://gallery.eberardos.my.id';

// Helper untuk generate short code
function generateShortCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Helper untuk check short code unik
function isShortCodeUnique(code) {
    return !imageDatabase.some(img => img.short_code === code);
}

// Helper untuk upload ke qu.ax
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

        if (response.data && response.data.files && response.data.files.length > 0) {
            return response.data.files[0].url;
        }
        throw new Error('No files returned from qu.ax');
    } catch (error) {
        console.error('Qu.ax upload error:', error.message);
        throw error;
    }
}

// Helper untuk sanitize filename
function sanitizeFilename(filename) {
    return filename
        .replace(/[^a-zA-Z0-9_\u0600-\u06FF\u4e00-\u9fa5\u00C0-\u017F\s.-]/g, '_')
        .replace(/\s+/g, '_')
        .substring(0, 100);
}

// Endpoint: Upload image
app.post('/api/images/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Upload ke qu.ax
        console.log(`Uploading ${req.file.originalname} to qu.ax...`);
        const quaxUrl = await uploadToQuax(req.file.path);

        // Generate short code unik
        let shortCode;
        let attempts = 0;
        do {
            shortCode = generateShortCode();
            attempts++;
        } while (!isShortCodeUnique(shortCode) && attempts < 10);

        if (!isShortCodeUnique(shortCode)) {
            throw new Error('Failed to generate unique short code');
        }

        // Simpan ke database
        const imageRecord = {
            id: imageDatabase.length + 1,
            name: req.file.filename,
            original_name: sanitizeFilename(req.file.originalname),
            url: quaxUrl,
            quax_url: quaxUrl,
            short_code: shortCode,
            uploaded_at: new Date().toISOString(),
            size: req.file.size
        };

        imageDatabase.push(imageRecord);

        // Hapus file lokal
        fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            image: imageRecord,
            shareUrl: `${WEBSITE_BASE_URL}/preview/${shortCode}`
        });

    } catch (error) {
        console.error('Upload error:', error);
        
        // Cleanup
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.status(500).json({
            error: 'Upload failed',
            message: error.message
        });
    }
});

// Endpoint: Get all images
app.get('/api/images', (req, res) => {
    try {
        // Sort by upload date, terbaru dulu
        const sorted = [...imageDatabase].sort((a, b) => 
            new Date(b.uploaded_at) - new Date(a.uploaded_at)
        );
        res.json(sorted);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch images' });
    }
});

// Endpoint: Get image by short code
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

// Endpoint: Delete image
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

// Endpoint: Batch upload dari JSON (untuk migrasi)
app.post('/api/images/migrate', express.json({ limit: '50mb' }), async (req, res) => {
    try {
        const { images } = req.body;
        
        if (!Array.isArray(images)) {
            return res.status(400).json({ error: 'Invalid format' });
        }

        const results = [];
        
        for (const image of images) {
            try {
                // Tambah ke database
                const record = {
                    id: imageDatabase.length + 1,
                    original_name: image.original_name,
                    quax_url: image.quax_url,
                    short_code: image.short_code,
                    uploaded_at: image.uploaded_at,
                    size: image.size || 0
                };
                
                imageDatabase.push(record);
                results.push({ ...record, status: 'migrated' });
                
            } catch (err) {
                results.push({ 
                    original_name: image.original_name, 
                    status: 'failed', 
                    error: err.message 
                });
            }
        }

        res.json({ success: true, migrated: results.length, results });
    } catch (error) {
        res.status(500).json({ error: 'Migration failed', message: error.message });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        images: imageDatabase.length,
        qu_ax: 'connected'
    });
});

// Static files
app.use(express.static('./public'));

// 404 fallback untuk SPA routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`📁 Database: ${imageDatabase.length} images`);
});
