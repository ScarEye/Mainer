"""Run Demucs. Keeps checkpoint loading working on current PyTorch."""
import torch

_load = torch.load


def _load_checkpoint(*args, **kwargs):
    kwargs.setdefault("weights_only", False)
    return _load(*args, **kwargs)


torch.load = _load_checkpoint

from demucs.separate import main

if __name__ == "__main__":
    main()
