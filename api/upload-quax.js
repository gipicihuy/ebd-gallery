import fetch from 'node-fetch';
import FormData from 'form-data';

export const config = {
    api: {
        // PENTING: Untuk menangani payload Base64 yang besar
        bodyParser: {
            sizeLimit: '5mb', 
        },
    },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { file } = req.body;
    
    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // 1. Validasi dan Ekstraksi Base64
    const matches = file.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return res.status(400).json({ error: 'Invalid file format' });
    }

    const fileBuffer = Buffer.from(matches[2], 'base64');
    
    if (fileBuffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'File size exceeds 5MB limit' });
    }
    
    const contentType = matches[1];
    const extension = contentType.split('/').pop().replace('jpeg', 'jpg');
    const fileName = `upload_${Date.now()}.${extension}`; 

    // 2. Persiapan FormData dan Upload ke Qu.ax
    const formData = new FormData();
    formData.append('files[]', fileBuffer, {
      filename: fileName,
      contentType: contentType
    });

    const response = await fetch('https://qu.ax/upload.php', {
      method: 'POST',
      body: formData,
      headers: {
        'Referer': 'https://qu.ax/',
        ...formData.getHeaders()
      }
    });

    // --- PERUBAHAN KRUSIAL DIMULAI DI SINI ---
    
    let quaxResult;
    try {
        // Coba baca respons sebagai JSON
        quaxResult = await response.json();
    } catch (e) {
        // Jika gagal membaca sebagai JSON, ambil teks mentah untuk debugging
        const rawText = await response.text();
        throw new Error(`Qu.ax responded with non-JSON format: ${rawText.substring(0, 100)}...`);
    }

    // 3. Ekstraksi URL dari JSON
    if (quaxResult.success && quaxResult.files && quaxResult.files.length > 0) {
      const quaxUrl = quaxResult.files[0].url;

      if (quaxUrl && quaxUrl.startsWith('http')) {
        // SUCCESS: Ditemukan URL yang valid di dalam JSON
        res.status(200).json({
          success: true,
          url: quaxUrl // Kirim URL Qu.ax kembali ke client
        });
      } else {
        throw new Error(`Qu.ax upload failed: URL not found in JSON result.`);
      }
    } else {
      // Jika respons sukses: false atau tidak ada array files
      throw new Error(`Qu.ax upload failed: ${JSON.stringify(quaxResult).substring(0, 100)}...`);
    }

  } catch (error) {
    // Tangkap semua error lain dan kirim respons 500 JSON yang bersih
    console.error('Upload error:', error);
    res.status(500).json({ 
      error: 'Upload failed', 
      details: error.message 
    });
  }
}
