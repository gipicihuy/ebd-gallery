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
  // Pastikan hanya metode POST yang diizinkan
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

    // Ambil respons sebagai teks (Qu.ax tidak mengirim JSON)
    const quaxResponseText = (await response.text()).trim();

    if (!response.ok) {
        // Jika Qu.ax memberikan status non-200 (error dari Qu.ax)
        throw new Error(`Qu.ax upload failed (Status ${response.status}): ${quaxResponseText || 'No response body'}`);
    }

    if (quaxResponseText && quaxResponseText.startsWith('http')) {
      // SUCCESS: Respons adalah URL
      res.status(200).json({
        success: true,
        url: quaxResponseText // URL Qu.ax
      });
    } else {
      // FAILURE: Respons 200 OK tapi bodynya bukan URL (misal: pesan error Qu.ax)
      throw new Error(`Qu.ax upload failed: Response was not a valid URL. Response body: "${quaxResponseText.substring(0, 100)}..."`);
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
