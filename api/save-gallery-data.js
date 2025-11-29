import fetch from 'node-fetch';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Pastikan GITHUB_TOKEN ada di Vercel Secrets
    const githubToken = process.env.GITHUB_TOKEN;
    const { newEntry } = req.body;

    // Asumsi default untuk repository Anda
    const OWNER = 'gipicihuy'; 
    const REPO = 'ebd-gallery'; 
    const FILE_PATH = 'result-quax.json';
    const BRANCH = 'main'; // Atau 'master', tergantung branch utama Anda
    const COMMIT_MESSAGE = `Feat: Add new image ${newEntry.original_name}`;

    if (!githubToken || !newEntry) {
        return res.status(400).json({ error: 'Missing GITHUB_TOKEN or image data.' });
    }
    
    const githubApiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`;

    try {
        // --- STEP 1: GET current file content and SHA ---
        const getResponse = await fetch(githubApiUrl, {
            headers: {
                'Authorization': `token ${githubToken}`,
                'User-Agent': OWNER,
                'Accept': 'application/vnd.github.v3+json' // Untuk mendapatkan konten Base64 & SHA
            }
        });

        if (!getResponse.ok) {
            const errorText = await getResponse.text();
            throw new Error(`Gagal mengambil JSON lama dari GitHub. Detail: ${getResponse.status} - ${errorText}`);
        }

        const currentFile = await getResponse.json();
        const currentSha = currentFile.sha; // SHA ini wajib untuk update file
        
        // Decode existing content, strip newlines, parse JSON
        const currentContent = Buffer.from(currentFile.content, 'base64').toString('utf8').trim();
        const galleryData = JSON.parse(currentContent);
        
        // --- STEP 2: UPDATE content ---
        galleryData.unshift(newEntry); // Tambahkan entri baru ke awal
        const updatedContent = JSON.stringify(galleryData, null, 2); // Format JSON agar rapi
        const updatedContentBase64 = Buffer.from(updatedContent).toString('base64'); // Encode kembali ke Base64

        // --- STEP 3: PUT (Commit) updated file ---
        const putResponse = await fetch(githubApiUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${githubToken}`,
                'User-Agent': OWNER,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: COMMIT_MESSAGE,
                content: updatedContentBase64,
                sha: currentSha, // SHA lama
                branch: BRANCH
            })
        });

        if (!putResponse.ok) {
            const errorText = await putResponse.text();
            throw new Error(`Gagal melakukan commit ke GitHub. Detail: ${putResponse.status} - ${errorText}`);
        }

        res.status(200).json({ 
            success: true, 
            message: 'Gallery data saved to GitHub successfully.' 
        });

    } catch (error) {
        console.error('GitHub Persistence Error:', error);
        res.status(500).json({ 
            error: 'Failed to save data to GitHub.', 
            details: error.message 
        });
    }
}
