import fetch from 'node-fetch';
import FormData from 'form-data';

export const config = {
    api: {
        // Penting: Mengizinkan Vercel menerima payload Base64 hingga 5MB
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
    const { file } = req.body; // Menerima data Base64
    
    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // 1. Ekstraksi Base64 dan Content Type
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

    // 2. Persiapan FormData untuk Qu.ax
    const formData = new FormData();
    formData.append('files[]', fileBuffer, {
      filename: fileName,
      contentType: contentType
    });

    // 3. Upload ke Qu.ax
    const response = await fetch('https://qu.ax/upload.php', {
      method: 'POST',
      body: formData,
      headers: {
        'Referer': 'https://qu.ax/', // Seringkali diperlukan oleh layanan hosting gambar
        ...formData.getHeaders()
      }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${response.status} - ${errorText}`);
    }

    // Qu.ax mengembalikan URL publik sebagai teks
    const quaxUrl = (await response.text()).trim();

    if (quaxUrl && quaxUrl.startsWith('http')) {
      res.status(200).json({
        success: true,
        url: quaxUrl // Kirim URL Qu.ax kembali ke client
      });
    } else {
      throw new Error(`Qu.ax upload failed: ${quaxUrl}`);
    }

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      error: 'Upload failed', 
      details: error.message 
    });
  }
}
