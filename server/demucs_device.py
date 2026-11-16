"""Report whether this PyTorch build can see an NVIDIA GPU."""
import json

import torch

cuda = torch.cuda.is_available()
name = torch.cuda.get_device_name(0) if cuda else None
vram_mb = 0
if cuda:
    vram_mb = int(torch.cuda.get_device_properties(0).total_memory / (1024 * 1024))

print(json.dumps({"cuda": bool(cuda), "gpuName": name, "vramMb": vram_mb}))
