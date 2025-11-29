// migrate.js - Script untuk migrasi dari Supabase ke Qu.ax
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

class SupabaseToQuaxMigration {
    constructor(options = {}) {
        this.quaxUrl = 'https://qu.ax/upload.php';
        this.backendUrl = options.backendUrl || 'http://localhost:3000';
        this.downloadDir = options.downloadDir || './migration-temp';
        this.resultsFile = options.resultsFile || './migration-results.json';
    }

    async downloadFile(url, filename) {
        const filepath = path.join(this.downloadDir, filename);
        
        try {
            const response = await axios.get(url, { 
                responseType: 'arraybuffer',
                timeout: 15000 
            });
            
            fs.writeFileSync(filepath, response.data);
            return filepath;
        } catch (error) {
            console.error(`❌ Download failed: ${filename}`, error.message);
            throw error;
        }
    }

    async uploadToQuax(filePath) {
        try {
            const form = new FormData();
            form.append('files[]', fs.createReadStream(filePath));

            const response = await axios.post(this.quaxUrl, form, {
                headers: {
                    ...form.getHeaders(),
                    'Referer': 'https://qu.ax/'
                },
                timeout: 30000
            });

            if (response.data?.files?.[0]?.url) {
                return response.data.files[0].url;
            }
            throw new Error('No URL returned');
        } catch (error) {
            console.error(`❌ Qu.ax upload failed: ${path.basename(filePath)}`, error.message);
            throw error;
        }
    }

    async migrateImage(image, index, total) {
        try {
            console.log(`[${index}/${total}] Processing: ${image.original_name}`);

            // Download dari Supabase
            const filename = `${Date.now()}_${path.basename(image.url)}`;
            const localPath = await this.downloadFile(image.url, filename);
            console.log(`   ✓ Downloaded`);

            // Upload ke Qu.ax
            const quaxUrl = await this.uploadToQuax(localPath);
            console.log(`   ✓ Uploaded to Qu.ax`);

            // Bersihkan file lokal
            fs.unlinkSync(localPath);

            return {
                id: image.id,
                original_name: image.original_name,
                supabase_url: image.url,
                quax_url: quaxUrl,
                short_code: image.short_code,
                uploaded_at: image.uploaded_at,
                status: 'success'
            };

        } catch (error) {
            console.error(`   ❌ Failed: ${error.message}`);
            return {
                id: image.id,
                original_name: image.original_name,
                supabase_url: image.url,
                short_code: image.short_code,
                status: 'failed',
                error: error.message
            };
        }
    }

    async run(jsonFilePath) {
        try {
            console.log('🚀 Starting migration...\n');

            // Prepare
            if (!fs.existsSync(this.downloadDir)) {
                fs.mkdirSync(this.downloadDir, { recursive: true });
            }

            // Read JSON
            console.log(`📂 Reading: ${jsonFilePath}`);
            const images = JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'));
            console.log(`📊 Found ${images.length} images\n`);

            const results = [];
            let successful = 0;

            // Process each image
            for (let i = 0; i < images.length; i++) {
                const result = await this.migrateImage(images[i], i + 1, images.length);
                results.push(result);

                if (result.status === 'success') {
                    successful++;
                }

                // Rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Save results
            fs.writeFileSync(this.resultsFile, JSON.stringify(results, null, 2));
            console.log(`\n✅ Migration complete!`);
            console.log(`📊 Success: ${successful}/${images.length}`);
            console.log(`📁 Results: ${this.resultsFile}`);

            // Cleanup temp dir
            if (fs.existsSync(this.downloadDir)) {
                fs.rmSync(this.downloadDir, { recursive: true, force: true });
            }

            return results;

        } catch (error) {
            console.error('\n❌ Migration failed:', error);
            throw error;
        }
    }

    // Save migration results ke backend database
    async saveToBackend(resultsFile) {
        try {
            console.log('\n📡 Sending to backend...');
            
            const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
            
            // Filter hanya yang berhasil
            const successImages = results.filter(r => r.status === 'success').map(r => ({
                original_name: r.original_name,
                quax_url: r.quax_url,
                short_code: r.short_code,
                uploaded_at: r.uploaded_at
            }));

            if (successImages.length === 0) {
                console.log('⚠️ No successful migrations to save');
                return;
            }

            const response = await axios.post(`${this.backendUrl}/api/images/migrate`, {
                images: successImages
            });

            console.log(`✅ Saved ${response.data.migrated} images to backend`);
            return response.data;

        } catch (error) {
            console.error('❌ Failed to save to backend:', error.message);
            throw error;
        }
    }
}

// CLI Usage
async function main() {
    const jsonFile = process.argv[2] || './images_rows.json';
    const backendUrl = process.argv[3] || 'http://localhost:3000';

    if (!fs.existsSync(jsonFile)) {
        console.error(`❌ File not found: ${jsonFile}`);
        process.exit(1);
    }

    const migrator = new SupabaseToQuaxMigration({ 
        backendUrl,
        resultsFile: './migration-results.json'
    });

    try {
        const results = await migrator.run(jsonFile);
        
        // Ask to save to backend
        console.log('\n🤔 Save to backend database? (Uncomment line below)');
        // await migrator.saveToBackend('./migration-results.json');
        
    } catch (error) {
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = SupabaseToQuaxMigration;

// Usage:
// node migrate.js ./images_rows.json http://localhost:3000
