import fetch from 'node-fetch';

export const config = {
    api: {
        // Atur batas body request
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

  // --- KONFIGURASI REPO ANDA ---
  const OWNER = 'gipicihuy'; // GANTI JIKA BEDA
  const REPO = 'ebd-gallery'; // GANTI JIKA BEDA
  const BRANCH = 'main'; // GANTI JIKA BEDA ('master' atau yang lain)
  // -----------------------------

  try {
    const { file, custom_name } = req.body;
    
    // --- 1. Validasi dan Persiapan File ---
    const matches = file.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return res.status(400).json({ error: 'Invalid file format.' });
    }

    const fileBuffer = Buffer.from(matches[2], 'base64');
    const MAX_FILE_SIZE = 4.5 * 1024 * 1024;
    if (fileBuffer.length > MAX_FILE_SIZE) {
        return res.status(400).json({ 
            error: `Ukuran file melebihi batas 4.5MB (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB).`
        });
    }
    
    const contentType = matches[1];
    const extension = contentType.split('/').pop().replace('jpeg', 'jpg');
    const shortCode = Date.now().toString(); 
    const fileName = `${shortCode}.${extension}`; 
    const githubPath = `uploads/${fileName}`; // Path gambar
    const contentBase64 = matches[2]; 
    const originalName = custom_name || fileName;
    const COMMIT_MESSAGE_IMAGE = `Upload: ${originalName}`;
    
    const githubApiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${githubPath}`;

    // --- 2. COMMIT FILE GAMBAR KE FOLDER UPLOADS/ ---
    const commitResponse = await fetch(githubApiUrl, {
        method: 'PUT',
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'User-Agent': OWNER,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            message: COMMIT_MESSAGE_IMAGE,
            content: contentBase64,
            branch: BRANCH 
        })
    });

    if (!commitResponse.ok) {
        const errorDetails = await commitResponse.json();
        throw new Error(`GitHub Commit Failed (${commitResponse.status}): ${errorDetails.message || commitResponse.statusText}`);
    }
    
    const rawUrl = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${githubPath}`;
    
    // Objek metadata yang akan disimpan dan dikembalikan
    const newEntry = {
        id: shortCode,
        name: fileName,
        download_url: rawUrl,
        original_name: originalName,
        uploaded_at: new Date().toISOString(),
        short_code: shortCode,
        source: 'github_upload'
    };

    // --- 3. UPDATE DAN COMMIT FILE INDEX METADATA (gallery-index.json) ---
    const INDEX_FILE_PATH = 'gallery-index.json';
    const indexApiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${INDEX_FILE_PATH}`;
    
    let currentSha;
    let galleryIndexData = [];
    
    // A. GET konten index saat ini
    const getIndexResponse = await fetch(indexApiUrl, {
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'User-Agent': OWNER,
            'Accept': 'application/vnd.github.v3+json'
        }
    });
    
    if (getIndexResponse.ok) {
        const currentFile = await getIndexResponse.json();
        currentSha = currentFile.sha;
        const currentContent = Buffer.from(currentFile.content, 'base64').toString('utf8').trim();
        try {
            // Pastikan data yang diambil adalah array
            galleryIndexData = JSON.parse(currentContent) || [];
            if (!Array.isArray(galleryIndexData)) {
                galleryIndexData = [];
            }
        } catch (e) {
            console.warn(`Error parsing existing ${INDEX_FILE_PATH}. Starting with empty array.`, e.message);
            galleryIndexData = [];
        }
    } else if (getIndexResponse.status !== 404) {
         // Jika ada error selain 404 (File Not Found), kita anggap gagal
         throw new Error(`Gagal mengambil ${INDEX_FILE_PATH}. Status: ${getIndexResponse.status}`);
    }

    // B. UPDATE konten
    galleryIndexData.unshift(newEntry);
    const updatedContent = JSON.stringify(galleryIndexData, null, 2);
    const updatedContentBase64 = Buffer.from(updatedContent).toString('base64');

    // C. PUT (Commit) updated index file
    const putIndexResponse = await fetch(indexApiUrl, {
        method: 'PUT',
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'User-Agent': OWNER,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            message: `Index: Add metadata for ${originalName}`,
            content: updatedContentBase64,
            sha: currentSha, // SHA hanya disertakan jika file sudah ada (bukan 404)
            branch: BRANCH
        })
    });

    if (!putIndexResponse.ok) {
        const errorDetails = await putIndexResponse.json();
        console.warn(`WARNING: Gambar diunggah, tapi GAGAL menyimpan metadata indeks. Status: ${putIndexResponse.status}. Detail: ${errorDetails.message}`);
    }

    // 4. Kembalikan data lengkap ke klien
    res.status(200).json({
        success: true,
        url: rawUrl, 
        ...newEntry
    });

  } catch (error) {
    console.error('GitHub Upload Error:', error);
    res.status(500).json({ 
      error: 'Upload failed', 
      details: error.message 
    });
  }
}
