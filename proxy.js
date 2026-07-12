const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const execPromise = util.promisify(exec);
const app = express();

app.use(cors({ origin: '*' }));

// Cookies exported from Brave via "Get cookies.txt LOCALLY" extension.
// Re-export periodically if YouTube starts rejecting requests again
// (cookies expire / get rotated over time).
const COOKIES_FILE = path.join(__dirname, 'cookies.txt');
const DENO_PATH = 'C:\\Users\\mtalh\\AppData\\Local\\Microsoft\\WinGet\\Packages\\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\\deno.exe';
const YT_DLP_FLAGS = `--cookies "${COOKIES_FILE}" --js-runtimes "deno:${DENO_PATH}" --remote-components ejs:github --no-check-certificate`;

async function downloadAndMerge(videoId, targetHeight, res, customFilename) {
    const outputFile = path.join(__dirname, `${videoId}_${targetHeight}p_merged.mp4`);
    const formatSelector = `bestvideo[height<=${targetHeight}]+bestaudio[ext=m4a]/bestaudio/best[height<=${targetHeight}]`;
    const command = `yt-dlp -f "${formatSelector}" ${YT_DLP_FLAGS} --merge-output-format mp4 -o "${outputFile}" "https://www.youtube.com/watch?v=${videoId}"`;
    console.log(`Running: ${command}`);
    try {
        const { stdout, stderr } = await execPromise(command);
        console.log('yt-dlp output:', stdout);
        if (stderr) console.error('yt-dlp stderr:', stderr);
        if (!fs.existsSync(outputFile)) throw new Error('Merged file not found');
        // Use the custom filename provided by the extension
        const finalFilename = customFilename || `${videoId}.mp4`;
        res.download(outputFile, finalFilename, (err) => {
            if (err) console.error('Download send error:', err);
            setTimeout(() => {
                fs.unlink(outputFile, (unlinkErr) => {
                    if (unlinkErr) console.error('Cleanup error:', unlinkErr);
                    else console.log(`Deleted temp file: ${outputFile}`);
                });
            }, 5000);
        });
    } catch (err) {
        console.error('Merge error:', err);
        res.status(500).json({ error: err.message });
    }
}

app.get('/formats', async (req, res) => {
    const videoId = req.query.id;
    if (!videoId) return res.status(400).json({ error: 'Missing video id' });

    console.log(`Fetching formats for ${videoId} via yt-dlp`);
    try {
        const { stdout } = await execPromise(`yt-dlp -j ${YT_DLP_FLAGS} "https://www.youtube.com/watch?v=${videoId}"`);
        const data = JSON.parse(stdout);

        const formats = [];
        const seenResolutions = new Set();

        if (data.formats) {
            const videoFormats = [];
            const audioFormats = [];

            data.formats.forEach(f => {
                if (f.vcodec !== 'none' && f.acodec !== 'none') {
                    if (!seenResolutions.has(f.height)) {
                        seenResolutions.add(f.height);
                        videoFormats.push({
                            type: 'video',
                            label: `${f.height}p (combined)`,
                            height: f.height,
                            url: f.url,
                            extension: f.ext || 'mp4'
                        });
                    }
                } else if (f.vcodec !== 'none' && f.acodec === 'none') {
                    if (!seenResolutions.has(f.height)) {
                        seenResolutions.add(f.height);
                        videoFormats.push({
                            type: 'video',
                            label: `${f.height}p (video only, will merge with AAC audio)`,
                            height: f.height,
                            url: f.url,
                            extension: f.ext || 'mp4',
                            requiresMerge: true
                        });
                    }
                } else if (f.vcodec === 'none' && f.acodec !== 'none') {
                    audioFormats.push({
                        type: 'audio',
                        label: `${f.abr || '?'}kbps ${f.acodec?.toUpperCase() || ''} (${f.ext})`,
                        url: f.url,
                        extension: f.ext || 'm4a'
                    });
                }
            });

            videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
            formats.push(...videoFormats);
            formats.push(...audioFormats);
        }

        if (formats.length === 0) throw new Error('No formats found');

        res.json({
            formats,
            title: data.title,
            thumbnail: data.thumbnail
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/download', async (req, res) => {
    const { videoId, quality, filename } = req.query;
    if (!videoId || !quality) {
        return res.status(400).json({ error: 'Missing videoId or quality' });
    }
    const heightMatch = quality.match(/(\d+)p/);
    if (!heightMatch) {
        return res.status(400).json({ error: 'Invalid quality format' });
    }
    const height = parseInt(heightMatch[1]);
    await downloadAndMerge(videoId, height, res, filename);
});

app.get('/formats-url', async (req, res) => {
    const pageUrl = req.query.url;
    if (!pageUrl) return res.status(400).json({ error: 'Missing url' });

    console.log(`Fetching formats for arbitrary URL: ${pageUrl}`);
    try {
        const { stdout } = await execPromise(`yt-dlp -j ${YT_DLP_FLAGS} "${pageUrl}"`);
        const data = JSON.parse(stdout);

        const formats = [];
        const seenResolutions = new Set();

        if (data.formats) {
            data.formats.forEach(f => {
                if (f.vcodec !== 'none' && f.acodec !== 'none') {
                    if (!seenResolutions.has(f.height)) {
                        seenResolutions.add(f.height);
                        formats.push({
                            type: 'video',
                            label: `${f.height || '?'}p (combined)`,
                            height: f.height,
                            url: f.url,
                            extension: f.ext || 'mp4'
                        });
                    }
                } else if (f.vcodec === 'none' && f.acodec !== 'none') {
                    formats.push({
                        type: 'audio',
                        label: `${f.abr || '?'}kbps ${f.acodec?.toUpperCase() || ''} (${f.ext})`,
                        url: f.url,
                        extension: f.ext || 'm4a'
                    });
                }
            });
        } else if (data.url) {
            // Single-format extraction (common for generic extractor)
            formats.push({
                type: 'video',
                label: `${data.height || 'source'}p`,
                height: data.height,
                url: data.url,
                extension: data.ext || 'mp4'
            });
        }

        formats.sort((a, b) => (b.height || 0) - (a.height || 0));

        if (formats.length === 0) throw new Error('No formats found');

        res.json({ formats, title: data.title, thumbnail: data.thumbnail });
    } catch (err) {
        const cleanErr = err.stderr ? err.stderr.trim() : err.message;
        console.warn(`[formats-url] yt-dlp generic extraction warning for ${pageUrl}:\n  ${cleanErr}`);
        res.status(422).json({ error: 'Unsupported URL', details: cleanErr });
    }
});

// Direct download+merge for a sniffed media URL (e.g. .m3u8 caught by the
// extension's network listener). yt-dlp handles HLS/DASH segment merging.
app.get('/download-url', async (req, res) => {
    const { mediaUrl, pageUrl, filename } = req.query;
    if (!mediaUrl) return res.status(400).json({ error: 'Missing mediaUrl' });

    const safeName = (filename || 'video').replace(/[^\w\-. ]/g, '_');
    const outputFile = path.join(__dirname, `${Date.now()}_${safeName}`);
    const refererFlag = pageUrl ? `--referer "${pageUrl}"` : '';
    const command = `yt-dlp ${YT_DLP_FLAGS} ${refererFlag} --merge-output-format mp4 -o "${outputFile}" "${mediaUrl}"`;
    console.log(`Running: ${command}`);

    try {
        const { stdout, stderr } = await execPromise(command);
        console.log('yt-dlp output:', stdout);
        if (stderr) console.error('yt-dlp stderr:', stderr);
        if (!fs.existsSync(outputFile)) throw new Error('Downloaded file not found');

        res.download(outputFile, filename || 'video.mp4', (err) => {
            if (err) console.error('Download send error:', err);
            setTimeout(() => {
                fs.unlink(outputFile, () => {});
            }, 5000);
        });
    } catch (err) {
        console.error('Download-url error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(3000, () => console.log('yt-dlp+ffmpeg server on http://localhost:3000'));