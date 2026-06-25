const express = require('express');
const cors = require('cors');
const { exec, spawn } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const execPromise = util.promisify(exec);
const app = express();

app.use(cors({ origin: '*' }));

// Cookies exported from Brave via "Get cookies.txt LOCALLY" extension.
const COOKIES_FILE = path.join(__dirname, 'cookies.txt');
const DENO_PATH = 'C:\\Users\\mtalh\\AppData\\Local\\Microsoft\\WinGet\\Packages\\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\\deno.exe';
const YT_DLP_FLAGS = `--cookies "${COOKIES_FILE}" --js-runtimes "deno:${DENO_PATH}" --remote-components ejs:github --no-check-certificate`;

const YT_DLP_BASE_ARGS = [
    '--cookies', COOKIES_FILE,
    '--js-runtimes', `deno:${DENO_PATH}`,
    '--remote-components', 'ejs:github',
    '--no-check-certificate',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    '--concurrent-fragments', '5',
    '--newline'
];

const jobs = new Map();

function createJob(filename) {
    const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
    const job = {
        id,
        status: 'starting',
        percent: 0,
        downloadedSize: '',
        totalSize: '',
        speed: '',
        eta: '',
        fragment: '',
        statusText: 'Starting download...',
        outputFile: null,
        filename: filename || 'video.mp4',
        error: null
    };
    jobs.set(id, job);
    return job;
}

function runYtDlpJob(job, customArgs, outputFile) {
    job.outputFile = outputFile;
    job.status = 'downloading';

    const args = [...YT_DLP_BASE_ARGS, ...customArgs];
    console.log(`[Job ${job.id}] Spawning: yt-dlp ${args.join(' ')}`);

    const child = spawn('yt-dlp', args);

    let stderrData = '';

    child.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed.includes('[Merger]') || trimmed.includes('[ffmpeg]') || trimmed.includes('Merging')) {
                job.status = 'merging';
                job.statusText = 'Merging video & audio...';
                job.percent = 99;
                continue;
            }

            const percentMatch = trimmed.match(/(\d+(?:\.\d+)?)%/);
            if (percentMatch) {
                job.percent = Math.min(99, parseFloat(percentMatch[1]));
            }

            const sizeMatch = trimmed.match(/([\d\.]+\s*[kMgGtT]i?B)\s+of\s+(~?\s*[\d\.]+\s*[kMgGtT]i?B)/i);
            if (sizeMatch) {
                job.downloadedSize = sizeMatch[1].trim();
                job.totalSize = sizeMatch[2].trim();
            }

            const fragMatch = trimmed.match(/\(frag\s+(\d+\/\d+)\)/i) || trimmed.match(/(\d+)\s+of\s+(\d+)\s+fragments/i);
            if (fragMatch) {
                if (fragMatch[1] && fragMatch[2]) job.fragment = `frag ${fragMatch[1]}/${fragMatch[2]}`;
                else if (fragMatch[1]) job.fragment = `frag ${fragMatch[1]}`;
            }

            const speedMatch = trimmed.match(/at\s+([0-9\.\sA-Za-z\/]+s)/i);
            if (speedMatch) {
                job.speed = speedMatch[1].trim();
            }

            const etaMatch = trimmed.match(/ETA\s+([0-9:]+)/i);
            if (etaMatch) {
                job.eta = etaMatch[1].trim();
            }

            if (job.status === 'downloading') {
                const parts = [`${job.percent.toFixed(1)}%`];
                if (job.downloadedSize && job.totalSize) {
                    parts.push(`${job.downloadedSize} / ${job.totalSize}`);
                } else if (job.fragment) {
                    parts.push(job.fragment);
                }
                if (job.speed) parts.push(job.speed);
                if (job.eta) parts.push(`ETA ${job.eta}`);

                job.statusText = parts.join(' • ');
            }
        }
    });

    child.stderr.on('data', (data) => {
        stderrData += data.toString();
    });

    child.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputFile)) {
            job.status = 'completed';
            job.percent = 100;
            job.statusText = 'Completed!';
            console.log(`[Job ${job.id}] Download complete: ${outputFile}`);
        } else {
            job.status = 'error';
            job.error = stderrData.trim() || `yt-dlp process exited with code ${code}`;
            job.statusText = `Failed`;
            console.error(`[Job ${job.id}] Failed:`, job.error);
        }
    });
}

app.get('/start-download-url', (req, res) => {
    const { mediaUrl, pageUrl, filename } = req.query;
    if (!mediaUrl) return res.status(400).json({ error: 'Missing mediaUrl' });

    const safeName = (filename || 'video').replace(/[^\w\-. ]/g, '_');
    const outputFile = path.join(__dirname, `${Date.now()}_${safeName}`);
    const job = createJob(filename || safeName);

    const customArgs = [];
    if (pageUrl) {
        customArgs.push('--referer', pageUrl);
    }
    customArgs.push('--merge-output-format', 'mp4', '-o', outputFile, mediaUrl);

    runYtDlpJob(job, customArgs, outputFile);

    res.json({ success: true, jobId: job.id });
});

app.get('/start-download-video', (req, res) => {
    const { videoId, quality, filename } = req.query;
    if (!videoId || !quality) return res.status(400).json({ error: 'Missing parameters' });

    const heightMatch = quality.match(/(\d+)p/);
    const targetHeight = heightMatch ? parseInt(heightMatch[1]) : 720;
    const formatSelector = `bestvideo[height<=${targetHeight}]+bestaudio[ext=m4a]/bestaudio/best[height<=${targetHeight}]`;

    const outputFile = path.join(__dirname, `${videoId}_${targetHeight}p_merged.mp4`);
    const job = createJob(filename || `${videoId}.mp4`);

    const customArgs = [
        '-f', formatSelector,
        '--merge-output-format', 'mp4',
        '-o', outputFile,
        `https://www.youtube.com/watch?v=${videoId}`
    ];

    runYtDlpJob(job, customArgs, outputFile);

    res.json({ success: true, jobId: job.id });
});

app.get('/job-status', (req, res) => {
    const jobId = req.query.id;
    const job = jobs.get(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
});

app.get('/get-job-file', (req, res) => {
    const jobId = req.query.id;
    const job = jobs.get(jobId);
    if (!job || !job.outputFile || !fs.existsSync(job.outputFile)) {
        return res.status(404).json({ error: 'File not ready or found' });
    }

    res.download(job.outputFile, job.filename, (err) => {
        if (err) console.error('File send error:', err);
        setTimeout(() => {
            fs.unlink(job.outputFile, (uErr) => {
                if (!uErr) console.log(`Cleaned up temp file: ${job.outputFile}`);
            });
            jobs.delete(jobId);
        }, 5000);
    });
});

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
    const outputFile = path.join(__dirname, `${videoId}_${height}p_merged.mp4`);
    const formatSelector = `bestvideo[height<=${height}]+bestaudio[ext=m4a]/bestaudio/best[height<=${height}]`;
    const command = `yt-dlp -f "${formatSelector}" ${YT_DLP_FLAGS} --merge-output-format mp4 -o "${outputFile}" "https://www.youtube.com/watch?v=${videoId}"`;
    try {
        const { stdout, stderr } = await execPromise(command);
        if (!fs.existsSync(outputFile)) throw new Error('Merged file not found');
        res.download(outputFile, filename || `${videoId}.mp4`, () => {
            setTimeout(() => fs.unlink(outputFile, () => {}), 5000);
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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

app.get('/download-url', async (req, res) => {
    const { mediaUrl, pageUrl, filename } = req.query;
    if (!mediaUrl) return res.status(400).json({ error: 'Missing mediaUrl' });

    const safeName = (filename || 'video').replace(/[^\w\-. ]/g, '_');
    const outputFile = path.join(__dirname, `${Date.now()}_${safeName}`);
    const refererFlag = pageUrl ? `--referer "${pageUrl}"` : '';
    const command = `yt-dlp ${YT_DLP_FLAGS} ${refererFlag} --merge-output-format mp4 -o "${outputFile}" "${mediaUrl}"`;

    try {
        const { stdout, stderr } = await execPromise(command);
        if (!fs.existsSync(outputFile)) throw new Error('Downloaded file not found');
        res.download(outputFile, filename || 'video.mp4', () => {
            setTimeout(() => fs.unlink(outputFile, () => {}), 5000);
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(3000, () => console.log('yt-dlp+ffmpeg server on http://localhost:3000'));