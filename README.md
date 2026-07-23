# Mainer

Upload any audio track — or paste a YouTube link — and practice drums with scrolling note visuals.

## Features

- 6 drum lanes: kick, snare, tom, hi-hat, crash, ride
- YouTube fetch via local **yt-dlp**
- **Split stems** (Demucs): drums / bass / vocals / other with volume + mute/solo
- **GPU-accelerated** stem split when CUDA PyTorch is installed
- Slow-down, A/B loop, mic scoring, chart editor

## Run

Needs **yt-dlp**, **ffmpeg**, and for stem split: **Demucs** + **PyTorch**.

### GPU stem split (recommended — RTX etc.)

```bash
python -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
python -m pip install demucs
npm install
npm run dev
```

### CPU-only fallback

```bash
python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
python -m pip install demucs
npm run dev
```

- App → http://localhost:5173
- Helper → http://127.0.0.1:8787

Check GPU status: `GET http://127.0.0.1:8787/api/separate/health`

Optional env overrides: `MAINER_DEMUCS_DEVICE=cuda|cpu`, `MAINER_DEMUCS_SEGMENT=8`

After a track loads, click **Split stems**, then Solo/Mute drums to practice isolated.
