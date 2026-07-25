"""Report Demucs device + tuned settings for this machine."""
import json
import os

import torch

# htdemucs max segment is ~7.8s; CLI --segment only accepts ints → use 7.
HTDEMUCS_MAX_SEGMENT_INT = 7

force = os.environ.get('MAINER_DEMUCS_DEVICE', '').strip().lower()
cuda_ok = torch.cuda.is_available()
use_cuda = cuda_ok if force not in ('cpu', 'cuda') else force == 'cuda'

device = 'cuda' if use_cuda else 'cpu'
name = torch.cuda.get_device_name(0) if use_cuda else 'CPU'
vram_mb = 0
if use_cuda:
    vram_mb = int(torch.cuda.get_device_properties(0).total_memory / (1024 * 1024))

env_seg = os.environ.get('MAINER_DEMUCS_SEGMENT', '').strip()
if env_seg:
    segment = int(float(env_seg))
else:
    # Smaller chunk on very low VRAM
    segment = 6 if (use_cuda and vram_mb and vram_mb < 5000) else HTDEMUCS_MAX_SEGMENT_INT

segment = max(1, min(segment, HTDEMUCS_MAX_SEGMENT_INT))

overlap = float(os.environ.get('MAINER_DEMUCS_OVERLAP', '0.1'))
shifts = int(os.environ.get('MAINER_DEMUCS_SHIFTS', '0'))

print(
    json.dumps(
        {
            'device': device,
            'cuda': use_cuda,
            'gpuName': name if use_cuda else None,
            'vramMb': vram_mb,
            'segment': segment,
            'overlap': overlap,
            'shifts': shifts,
        }
    )
)
