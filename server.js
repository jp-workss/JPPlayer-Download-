const express = require('express');
const { spawn } = require('child_process');
const ytdlp = require('yt-dlp-exec'); // Uses the installed Node package automatically
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.static('public'));

const ytdlpArgs = {
    extractorArgs: 'youtube:player_client=mweb,android,web',
    noPlaylist: true
};

// Endpoint 1: Fetch Metadata
app.get('/api/info', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).json({ error: 'URL is required' });

    try {
        const output = await ytdlp(videoUrl, {
            ...ytdlpArgs,
            dumpJson: true
        });

        res.json({
            title: output.title,
            thumbnail: output.thumbnail,
            duration: output.duration_string
        });
    } catch (err) {
        console.error('yt-dlp error:', err);
        res.status(500).json({ error: 'Failed to fetch video metadata.' });
    }
});

// Endpoint 2: Stream Selected Format & Quality
app.get('/api/convert', (req, res) => {
    const { url, title, mode, quality } = req.query;
    if (!url) return res.status(400).send('URL is required');

    const safeTitle = (title ? title.replace(/[^a-zA-Z0-9 _-]/g, "") : "youtube_download").trim();

    if (mode === 'mp3') {
        const bitrate = quality || '192k';

        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}_${bitrate}.mp3"`);
        res.setHeader('Content-Type', 'audio/mpeg');

        const ytdlpStream = ytdlp.stream(url, {
            ...ytdlpArgs,
            output: '-',
            format: 'ba/b'
        });

        const ffmpeg = spawn('ffmpeg', [
            '-i', 'pipe:0',
            '-vn',
            '-acodec', 'libmp3lame',
            '-b:a', bitrate,
            '-f', 'mp3',
            'pipe:1'
        ]);

        ytdlpStream.pipe(ffmpeg.stdin);
        ffmpeg.stdout.pipe(res);

        req.on('close', () => {
            ytdlpStream.destroy();
            ffmpeg.kill();
        });
    } 
    else if (mode === 'mp4') {
        const height = quality ? quality.replace('p', '') : '1080';

        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}_${height}p.mp4"`);
        res.setHeader('Content-Type', 'video/mp4');

        const formatSpec = `bv*[height=${height}]+ba/bv*[height<=${height}]+ba/best`;

        const ytdlpStream = ytdlp.stream(url, {
            ...ytdlpArgs,
            output: '-',
            format: formatSpec
        });

        const ffmpeg = spawn('ffmpeg', [
            '-i', 'pipe:0',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-crf', '20',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-movflags', 'frag_keyframe+empty_moov',
            '-f', 'mp4',
            'pipe:1'
        ]);

        ytdlpStream.pipe(ffmpeg.stdin);
        ffmpeg.stdout.pipe(res);

        req.on('close', () => {
            ytdlpStream.destroy();
            ffmpeg.kill();
        });
    } else {
        res.status(400).send('Invalid mode specified.');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
