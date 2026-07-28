@echo off
title YouTube Downloader Proxy Server
echo =======================================
echo   YouTube Downloader Proxy Server
echo =======================================
echo.

REM Change to the script's directory
cd /d "%~dp0"

REM 1. Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please download and install Node.js from https://nodejs.org/
    echo Then run this script again.
    pause
    exit /b 1
)
echo [OK] Node.js found.

REM 2. Check for npm and install dependencies if needed
if not exist "node_modules" (
    echo [INFO] Installing dependencies (express, cors)...
    call npm install express cors
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
) else (
    echo [OK] Dependencies already installed.
)

REM 3. Check for ffmpeg
where ffmpeg >nul 2>nul
if %errorlevel% neq 0 (
    echo [WARNING] ffmpeg not found in PATH.
    echo Attempting to download ffmpeg...
    powershell -Command "Invoke-WebRequest -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile 'ffmpeg.zip'"
    powershell -Command "Expand-Archive -Path 'ffmpeg.zip' -DestinationPath '.' -Force"
    for /d %%i in ("ffmpeg-*") do (
        move "%%i\bin\ffmpeg.exe" "ffmpeg.exe" >nul
        rmdir /s /q "%%i"
    )
    del ffmpeg.zip
    echo [OK] ffmpeg downloaded to current folder.
) else (
    echo [OK] ffmpeg found.
)

REM 4. Check for yt-dlp
where yt-dlp >nul 2>nul
if %errorlevel% neq 0 (
    echo [WARNING] yt-dlp not found in PATH.
    echo Downloading yt-dlp...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile 'yt-dlp.exe'"
    echo [OK] yt-dlp downloaded to current folder.
) else (
    echo [OK] yt-dlp found.
)

REM 5. Create proxy.js if missing
if not exist "proxy.js" (
    echo [WARNING] proxy.js not found. Creating a default one...
    (
        echo const express = require('express'^);
        echo const cors = require('cors'^);
        echo const { exec } = require('child_process'^);
        echo const util = require('util'^);
        echo const fs = require('fs'^);
        echo const path = require('path'^);
        echo const execPromise = util.promisify(exec^);
        echo const app = express(^);
        echo app.use(cors({ origin: '*' }^)^);
        echo async function downloadAndMerge(videoId, targetHeight, res^) {
        echo   const outputFile = path.join(__dirname, `${videoId}_${targetHeight}p_merged.mp4`^);
        echo   const formatSelector = `bestvideo[height<=${targetHeight}]+bestaudio[ext=m4a]/bestaudio/best[height<=${targetHeight}]`;
        echo   const command = `yt-dlp -f "${formatSelector}" --merge-output-format mp4 -o "${outputFile}" "https://www.youtube.com/watch?v=${videoId}"`;
        echo   console.log(`Running: ${command}`^);
        echo   try {
        echo     await execPromise(command^);
        echo     if (!fs.existsSync(outputFile^)^) throw new Error('Merged file not found'^);
        echo     res.download(outputFile, `${videoId}.mp4`, (err^) => {
        echo       setTimeout(() => fs.unlink(outputFile, (^) => {}^), 5000^);
        echo     }^);
        echo   } catch (err^) {
        echo     res.status(500^).json({ error: err.message }^);
        echo   }
        echo }
        echo app.get('/formats', async (req, res^) => {
        echo   const videoId = req.query.id;
        echo   if (!videoId^) return res.status(400^).json({ error: 'Missing video id' }^);
        echo   try {
        echo     const { stdout } = await execPromise(`yt-dlp -j "https://www.youtube.com/watch?v=${videoId}"`^);
        echo     const data = JSON.parse(stdout^);
        echo     const formats = [];
        echo     const seen = new Set(^);
        echo     data.formats.forEach(f => {
        echo       if (f.vcodec !== 'none' && f.acodec !== 'none' && !seen.has(f.height^)^) {
        echo         seen.add(f.height^);
        echo         formats.push({ type: 'video', label: `${f.height}p (combined)`, height: f.height, url: f.url, extension: f.ext || 'mp4' }^);
        echo       } else if (f.vcodec !== 'none' && f.acodec === 'none' && !seen.has(f.height^)^) {
        echo         seen.add(f.height^);
        echo         formats.push({ type: 'video', label: `${f.height}p (video only, will merge with AAC audio)`, height: f.height, url: f.url, extension: f.ext || 'mp4', requiresMerge: true }^);
        echo       } else if (f.vcodec === 'none' && f.acodec !== 'none'^) {
        echo         formats.push({ type: 'audio', label: `${f.abr || '?'}kbps ${f.acodec.toUpperCase(^)} (${f.ext})`, url: f.url, extension: f.ext || 'm4a' }^);
        echo       }
        echo     }^);
        echo     formats.sort((a,b^) => (b.height || 0^) - (a.height || 0^)^);
        echo     res.json({ formats, title: data.title, thumbnail: data.thumbnail }^);
        echo   } catch (err^) {
        echo     res.status(500^).json({ error: err.message }^);
        echo   }
        echo }^);
        echo app.get('/download', async (req, res^) => {
        echo   const { videoId, quality } = req.query;
        echo   if (!videoId || !quality^) return res.status(400^).json({ error: 'Missing parameters' }^);
        echo   const height = parseInt(quality.match(/(\d+)p/)[1]^);
        echo   await downloadAndMerge(videoId, height, res^);
        echo }^);
        echo app.listen(3000, (^) => console.log('yt-dlp+ffmpeg server on http://localhost:3000'^)^);
    ) > proxy.js
    echo [OK] proxy.js created.
) else (
    echo [OK] proxy.js found.
)

REM 6. Start the server
echo.
echo Starting proxy server on http://localhost:3000
echo Press Ctrl+C to stop the server.
echo.
node proxy.js

pause