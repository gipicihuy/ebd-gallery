import fetch from 'node-fetch';

export const config = {
    api: {
        // Atur batas body request (Base64 string) sedikit lebih tinggi dari batas file
        bodyParser: {
            sizeLimit: '5mb', 
        },
    },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Ambil token dari Environment Variables Vercel
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN; 
  if (!GITHUB_TOKEN) {
      return res.status(500).json({ error: 'Server misconfigured: GITHUB_TOKEN is missing.' });
  }

  try {
    const { file, custom_name } = req.body;
    
    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // 1. Validasi dan Ekstraksi Base64
    const matches = file.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return res.status(400).json({ error: 'Invalid file format.' });
    }

    const fileBuffer = Buffer.from(matches[2], 'base64');
    const MAX_FILE_SIZE = 4.5 * 1024 * 1024; // Batas baru 4.5MB

    if (fileBuffer.length > MAX_FILE_SIZE) {
        return res.status(400).json({ 
            error: `Ukuran file melebihi batas 4.5MB (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB).`
        });
    }
    
    const contentType = matches[1];
    const extension = contentType.split('/').pop().replace('jpeg', 'jpg');
    const shortCode = Date.now().toString(); // Gunakan timestamp sebagai ID unik
    const fileName = `${shortCode}.${extension}`; 
    const githubPath = `uploads/${fileName}`; // Folder baru: uploads/
    
    // Konten yang dikirim ke GitHub API harus Base64 murni tanpa prefix 'data:...'
    const contentBase64 = matches[2]; 
    
    // 2. Konfigurasi GitHub dan Commit
    const OWNER = 'gipicihuy'; 
    const REPO = 'ebd-gallery'; 
    const BRANCH = 'main'; // Sesuaikan jika Anda menggunakan branch lain
    const originalName = custom_name || fileName;
    const COMMIT_MESSAGE = `Upload: ${originalName}`;
    
    const githubApiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${githubPath}`;

    const commitResponse = await fetch(githubApiUrl, {
        method: 'PUT',
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'User-Agent': OWNER,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            message: COMMIT_MESSAGE,
            content: contentBase64,
            branch: BRANCH 
        })
    });

    if (!commitResponse.ok) {
        const errorDetails = await commitResponse.json();
        throw new Error(`GitHub Commit Failed (${commitResponse.status}): ${errorDetails.message || commitResponse.statusText}`);
    }
    
    // 3. Konstruksi URL GitHub Raw dan Kirim Respons
    // Ini adalah URL permanen file di GitHub
    const rawUrl = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${githubPath}`;

    res.status(200).json({
        success: true,
        url: rawUrl, // Ini URL yang akan digunakan di galeri
        short_code: shortCode,
        uploaded_at: new Date().toISOString(),
        original_name: originalName
    });

  } catch (error) {
    console.error('GitHub Upload Error:', error);
    res.status(500).json({ 
      error: 'Upload failed', 
      details: error.message 
    });
  }
}
