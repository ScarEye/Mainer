# Mainer

Upload any audio track — or paste a YouTube link — and practice drums with scrolling note visuals.

## Features

- 6 drum lanes: kick, snare, tom, hi-hat, crash, ride
- YouTube fetch via local **yt-dlp**
- **Split stems** (Demucs): drums / bass / vocals / other with volume + mute/solo
- **GPU-accelerated** stem split when CUDA PyTorch is installed
- Slow-down, A/B loop, mic scoring, chart editor

## Run

**Easiest (Windows):** double-click [`start.bat`](start.bat)

That will:
1. Stop anything already using ports **5173** / **8787**
2. Install npm deps if needed
3. Start the web app + YouTube/Demucs API together

Or from a terminal:

```bash
npm start
```

Same clean restart behavior.

Needs **yt-dlp**, **ffmpeg**, and for stem split: **Demucs** + **PyTorch**.

### GPU stem split (recommended — RTX etc.)

```bash
python -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
python -m pip install demucs
```

### CPU-only fallback

```bash
python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
python -m pip install demucs
```

- App → http://localhost:5173
- Helper → http://127.0.0.1:8787

Optional env: `MAINER_DEMUCS_DEVICE=cuda|cpu`, `MAINER_DEMUCS_SEGMENT=7`

After a track loads, click **Split stems**, then Solo/Mute drums to practice isolated.

## License

[MIT](LICENSE) © 2026 Zaid Wajid
