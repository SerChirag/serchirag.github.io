#!/usr/bin/env python3
"""Load each model's best and worst samples into the ranking chart's panel.

Hovering a model in the ranking chart (_includes/chamfer/ranking-chart.liquid)
shows its generated samples closest to and farthest from the real images. This
script copies those samples from the export into the folders the chart reads.
Re-run it whenever the export changes; never edit the outputs by hand.

    python3 bin/chamfer_samples.py ~/Downloads/cosine_k1_selected

Reads one folder per model, named as in FOLDERS below, holding
  best_<rank>_idx<n>.webp    the samples closest to the real images
  worst_<rank>_idx<n>.webp   the samples farthest from them
where a lower rank is closer (best) or farther (worst).

Writes, in rank order:
  assets/chamfer-samples/<model id>/closest-01.webp, closest-02.webp, ...
  assets/chamfer-samples/<model id>/farthest-01.webp, farthest-02.webp, ...

assets/chamfer-samples/ is emptied first. The images are copied as they are.
Model ids are those in _data/chamfer_models.json; a folder not listed in
FOLDERS is skipped, and a model with no folder shows "coming soon".
"""

import argparse
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "chamfer-samples"
FILE = re.compile(r"^(best|worst)_(\d+)_idx\d+\.webp$")
SIDES = {"best": "closest", "worst": "farthest"}
# The export's folder for each model in the paper's table.
FOLDERS = {
    "BigGAN": "biggan",
    "StyleGAN-XL": "stylegan-xl",
    "DiT-XL_2_50-step": "dit-xl-2-50-steps",
    "DiT-XL_2_125-step": "dit-xl-2-125-steps",
    "DiT-XL_2": "dit-xl-2-250-steps",
    "SiT-XL_2": "sit-xl-2",
    "REPA_SiT-XL_2": "sit-xl-2-repa",
    "JiT-H_16": "jit-h-16",
    "IMM_1-step": "imm-1-step",
    "IMM_2-step": "imm-2-steps",
    "IMM_4-step": "imm-4-steps",
    "IMM_8-step": "imm-8-steps",
    "iMF-B_2": "imf-b-2",
    "iMF-M_2": "imf-m-2",
    "iMF-L_2": "imf-l-2",
    "iMF-XL_2": "imf-xl-2",
    "pMF-H_16": "pmf-h-16",
    "Drift-B": "drift-b",
    "Drift-L": "drift-l",
    "Priming-L": "priming-l",
    "VAR_d20": "var-d20",
    "VAR_d24": "var-d24",
    "VAR_d30": "var-d30",
    "LlamaGen-L": "llamagen-l",
    "Open-MAGVIT2-XL": "open-magvit2-xl",
    "RAR-XL": "rar-xl",
    "RandAR-XL": "randar-xl",
    "TiTok-L32": "titok-l32",
    "FD-Loss_pMF-H_Inception": "pmf-h-fd-loss-inception",
    "FD-Loss_pMF-H_SIM": "pmf-h-fd-loss-sim",
    "FD-Loss_JiT-H_Inception": "jit-h-fd-loss-inception",
    "FD-Loss_JiT-H_SIM": "jit-h-fd-loss-sim",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("export", type=Path, help="the folder holding one folder per model")
    src = parser.parse_args().export

    ids = {m["id"] for m in json.loads((ROOT / "_data" / "chamfer_models.json").read_text())["models"]}
    unknown = sorted(set(FOLDERS.values()) - ids)
    if unknown:
        raise SystemExit(f"Not in _data/chamfer_models.json: {', '.join(unknown)}")

    if OUT.exists():
        shutil.rmtree(OUT)
    done = set()
    for folder in sorted(p for p in src.iterdir() if p.is_dir()):
        mid = FOLDERS.get(folder.name)
        if not mid:
            print(f"skipped {folder.name}: not a model in the table")
            continue
        found = {"best": [], "worst": []}
        for f in folder.iterdir():
            match = FILE.match(f.name)
            if match:
                found[match[1]].append((int(match[2]), f))
        dest = OUT / mid
        dest.mkdir(parents=True)
        for kind, files in found.items():
            for i, (_, f) in enumerate(sorted(files), 1):
                shutil.copyfile(f, dest / f"{SIDES[kind]}-{i:02d}.webp")
        print(f"{mid}: {len(found['best'])} closest, {len(found['worst'])} farthest")
        done.add(mid)

    missing = sorted(ids - done)
    if missing:
        print(f"no samples for: {', '.join(missing)}")


if __name__ == "__main__":
    main()
