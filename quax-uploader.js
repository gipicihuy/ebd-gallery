// quax-uploader.js - Updated handler untuk qu.ax
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

class QuaxUploader {
    constructor() {
        this.baseUrl = 'https://qu.ax';
        this.uploadEndpoint = `${this.baseUrl}/upload.php`;
    }

    async uploadFile(filePath) {
        try {
            const form = new FormData();
            const fileStream = fs.createReadStream(filePath);
            
            form.append('files[]', fileStream);

            const response = await axios.post(this.uploadEndpoint, form, {
                headers: {
                    ...form.getHeaders(),
                    'Referer': 'https://qu.ax/'
                },
                timeout: 30000
            });

            if (response.data && response.data.files && response.data.files.length > 0) {
                return {
                    success: true,
                    url: response.data.files[0].url,
                    name: response.data.files[0].name,
                    size: response.data.files[0].size,
                    fullResponse: response.data
                };
            }
            
            throw new Error('No files returned from qu.ax');
        } catch (error) {
            console.error('Upload to qu.ax failed:', error.message);
            throw error;
        }
    }

    async uploadMultiple(filePaths) {
        const results = [];
        for (const filePath of filePaths) {
            try {
                const result = await this.uploadFile(filePath);
                results.push(result);
            } catch (error) {
                results.push({
                    success: false,
                    file: filePath,
                    error: error.message
                });
            }
        }
        return results;
    }

    // Migrasi dari JSON records Supabase ke format qu.ax
    async migrateFromSupabase(jsonFilePath, downloadDir = './downloads') {
        try {
            // Baca JSON dari Supabase export
            const jsonData = JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'));
            const migrationResults = [];

            // Buat direktori untuk download jika belum ada
            if (!fs.existsSync(downloadDir)) {
                fs.mkdirSync(downloadDir, { recursive: true });
            }

            console.log(`🔄 Mulai migrasi ${jsonData.length} file dari Supabase...`);

            for (const [index, image] of jsonData.entries()) {
                try {
                    console.log(`[${index + 1}/${jsonData.length}] Processing: ${image.original_name}`);

                    // Download dari Supabase
                    const downloadResponse = await axios.get(image.url, {
                        responseType: 'arraybuffer',
                        timeout: 15000
                    });

                    // Sanitize filename
                    const sanitizedName = this.sanitizeFilename(image.original_name);
                    const localPath = path.join(downloadDir, sanitizedName);

                    // Simpan file lokal
                    fs.writeFileSync(localPath, downloadResponse.data);

                    // Upload ke qu.ax
                    const uploadResult = await this.uploadFile(localPath);

                    migrationResults.push({
                        id: image.id,
                        original_name: image.original_name,
                        supabase_url: image.url,
                        quax_url: uploadResult.url,
                        uploaded_at: image.uploaded_at,
                        short_code: image.short_code,
                        status: 'migrated'
                    });

                    // Hapus file lokal setelah upload
                    fs.unlinkSync(localPath);

                    console.log(`✅ Berhasil: ${uploadResult.url}`);

                } catch (error) {
                    console.error(`❌ Gagal: ${image.original_name} - ${error.message}`);
                    migrationResults.push({
                        id: image.id,
                        original_name: image.original_name,
                        supabase_url: image.url,
                        status: 'failed',
                        error: error.message
                    });
                }

                // Rate limiting - tunggu 1 detik antar upload
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Simpan hasil migrasi
            const resultPath = path.join(downloadDir, 'migration-results.json');
            fs.writeFileSync(resultPath, JSON.stringify(migrationResults, null, 2));

            console.log(`\n📊 Migrasi selesai! Hasil tersimpan di: ${resultPath}`);
            
            const successful = migrationResults.filter(r => r.status === 'migrated').length;
            console.log(`✅ Berhasil: ${successful}/${jsonData.length}`);

            return migrationResults;

        } catch (error) {
            console.error('Migration failed:', error);
            throw error;
        }
    }

    sanitizeFilename(filename) {
        return filename
            .replace(/[^a-zA-Z0-9_\u0600-\u06FF\u4e00-\u9fa5\u00C0-\u017F\s.-]/g, '_')
            .replace(/\s+/g, '_')
            .substring(0, 100);
    }
}

// Export untuk digunakan
module.exports = QuaxUploader;

// Contoh penggunaan:
/*
const QuaxUploader = require('./quax-uploader.js');
const uploader = new QuaxUploader();

// Migrasi dari JSON Supabase
uploader.migrateFromSupabase('./images_rows.json')
    .then(results => {
        console.log('Migration completed!');
        // Simpan mapping untuk update database nantinya
    })
    .catch(err => console.error('Error:', err));
*/
