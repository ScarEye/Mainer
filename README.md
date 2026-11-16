# Mainer

Upload any audio track — or paste a YouTube link — and practice drums with scrolling note visuals.

## Features

- 6 drum lanes: kick, snare, tom, hi-hat, crash, ride
- YouTube fetch via local **yt-dlp**
- **Split stems**: pick a Demucs model, Fast / Balanced / Best, CPU or GPU, and the full song or the current loop. 6-stem models add guitar and piano.
- **GPU or CPU** stem split. First launch installs a CUDA build when `nvidia-smi` works.
- Slow-down, A/B loop, mic scoring, chart editor

## Run

Needs [Node.js](https://nodejs.org/). Python, PyTorch, Demucs, yt-dlp, and ffmpeg are installed into `.venv` on first launch. You do not install those yourself.

**Windows:** double-click [`start.bat`](start.bat)

Or from a terminal:

```bash
npm start
```

The first start downloads PyTorch (a few GB when an NVIDIA driver is present) and can take a while. Later starts skip that. If Python 3.10+ is missing on Windows, the script downloads it into `.tools` and does not change your system PATH.

- App → http://localhost:5173
- Helper → http://127.0.0.1:8787

After a track loads, pick a model, quality, CPU or GPU, and full song or the current loop, then **Split stems**. Solo the drum stem to practice.

## License

[MIT](LICENSE) © 2026 Zaid Wajid
