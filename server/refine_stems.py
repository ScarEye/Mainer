"""Pull sub-bass back onto the bass stem, then keep each stem's own bins.

Demucs leaves a copy of the loudest instrument in the quieter stems. A power
mask gives each frequency bin to the stem that already owns it, which is what
raises the split from the raw network output.
"""
import sys
from pathlib import Path

import torch
import torchaudio

STEMS = ("drums", "bass", "vocals", "guitar", "piano", "other")
# Cutoffs sit below the instrument's lowest note so guitar and piano keep their body.
TAKE_HZ = {"guitar": 70.0, "other": 100.0, "vocals": 75.0, "piano": 45.0}
N_FFT = 2048
HOP = 1024


def low_band(wave: torch.Tensor, rate: int, hz: float) -> torch.Tensor:
    spec = torch.fft.rfft(wave, dim=-1)
    freqs = torch.fft.rfftfreq(wave.shape[-1], 1.0 / rate)
    fade = (hz * 1.2 - freqs) / max(hz * 0.45, 1.0)
    spec = spec * fade.clamp(0, 1)
    return torch.fft.irfft(spec, n=wave.shape[-1], dim=-1)


def move_sub_bass(stems: dict[str, torch.Tensor], rate: int) -> None:
    bass = stems.get("bass")
    if bass is None:
        return
    for name, hz in TAKE_HZ.items():
        stem = stems.get(name)
        if stem is None or stem.shape[-1] != bass.shape[-1] or stem.shape[0] != bass.shape[0]:
            continue
        low = low_band(stem, rate, hz)
        stem.sub_(low)
        bass.add_(low)


def sharpen(stems: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    names = [name for name in STEMS if name in stems]
    if len(names) < 2:
        return stems
    waves = [stems[name] for name in names]
    channels = min(int(wave.shape[0]) for wave in waves)
    frames = min(int(wave.shape[-1]) for wave in waves)
    if frames < N_FFT:
        return stems
    window = torch.hann_window(N_FFT)
    rendered = [torch.zeros(channels, frames) for _ in names]
    for channel in range(channels):
        specs = []
        for wave in waves:
            spec = torch.stft(
                wave[channel, :frames].contiguous(),
                n_fft=N_FFT,
                hop_length=HOP,
                win_length=N_FFT,
                window=window,
                center=True,
                return_complex=True,
            )
            specs.append(spec)
        power = torch.stack([spec.abs().square() for spec in specs], dim=0)
        masks = power / power.sum(dim=0, keepdim=True).clamp_min(1e-8)
        for index, spec in enumerate(specs):
            y = torch.istft(
                spec * masks[index],
                n_fft=N_FFT,
                hop_length=HOP,
                win_length=N_FFT,
                window=window,
                center=True,
                length=frames,
            )
            n = min(frames, int(y.shape[-1]))
            rendered[index][channel, :n] = y[:n]
    out = dict(stems)
    for name, wave in zip(names, rendered):
        out[name] = wave
    return out


def load_stems(folder: Path):
    found = {}
    rate = None
    for name in STEMS:
        path = folder / f"{name}.wav"
        if not path.is_file():
            continue
        wave, file_rate = torchaudio.load(str(path))
        if rate is None:
            rate = int(file_rate)
        elif int(file_rate) != rate:
            continue
        found[name] = wave.float()
    return found, rate


def save_stem(folder: Path, name: str, wave: torch.Tensor, rate: int) -> None:
    peak = float(wave.detach().abs().max())
    if peak > 1:
        wave = wave / peak
    path = str(folder / f"{name}.wav")
    try:
        torchaudio.save(path, wave, rate, encoding="PCM_S", bits_per_sample=16)
    except TypeError:
        torchaudio.save(path, wave, rate)


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: refine_stems.py <folder>", file=sys.stderr)
        return 1
    folder = Path(sys.argv[1])
    stems, rate = load_stems(folder)
    if rate is None or len(stems) < 2:
        return 0
    move_sub_bass(stems, rate)
    sharpened = sharpen(stems)
    for name, wave in sharpened.items():
        if name in stems:
            save_stem(folder, name, wave, rate)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
