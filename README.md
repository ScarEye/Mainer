# Mainer

Upload any audio track — or paste a YouTube link — and practice drums with scrolling note visuals.

## Features

- 6 drum lanes: kick, snare, tom, hi-hat, crash, ride
- YouTube fetch via local **yt-dlp**
- **Split stems** (Demucs): drums / bass / vocals / other(guitar) with volume + mute/solo
- Slow-down, A/B loop, mic scoring, chart editor

## Run

Needs **yt-dlp**, **ffmpeg**, and for stem split: **Demucs** (+ PyTorch).

```bash
python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
python -m pip install demucs
npm install
npm run dev
```

- App → http://localhost:5173
- Helper → http://127.0.0.1:8787

After a track loads, click **Split stems**, then Solo/Mute drums to practice isolated.
