"""Report Demucs device + tuned settings for this machine."""
import json
import os
import sys

import torch

force = os.environ.get('MAINER_DEMUCS_DEVICE', '').strip().lower()
cuda_ok = torch.cuda.is_available()
use_cuda = cuda_ok if force not in ('cpu', 'cuda') else force == 'cuda'

device = 'cuda' if use_cuda else 'cpu'
name = torch.cuda.get_device_name(0) if use_cuda else 'CPU'
vram_mb = 0
if use_cuda:
    vram_mb = int(torch.cuda.get_device_properties(0).total_memory / (1024 * 1024))

# Speed-tuned defaults (6 GB laptop GPUs need smaller segments)
segment = int(os.environ.get('MAINER_DEMUCS_SEGMENT', '0') or '0')
if segment <= 0:
    if use_cuda and vram_mb and vram_mb < 8000:
        segment = 8
    elif use_cuda:
        segment = 12
    else:
        segment = 10

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
