#!/usr/bin/env python3
"""Load the paper's nearest-neighbour examples (Figures 6 and 7) into the site.

The two explorers drawn by _includes/chamfer/nn-explorer.liquid show, for a
query image, its three nearest neighbours in the other set. This script reads
the images the paper's figures were made from and writes what the explorers
show. Re-run it whenever those figures change; never edit the outputs by hand.

    python3 bin/chamfer/nn_examples.py ~/Desktop/Chamfer/Chamfer-Overleaf/figures

Reads, for each direction, class and level (1 closest, 3 farthest):
  precision_figure/<class>/<level>/   Figure 6: a generated query, its nearest real images
  recall_figure/<class>/<level>/      Figure 7: a real query, its nearest generated images
each holding query.png, nn1.png, nn2.png, nn3.png and distances.log.

Writes:
  assets/img/chamfer/nn/<direction>/<class>/<level>-<name>.webp
  _data/chamfer/nn_examples.json

The image folder is emptied first. Images become WebP (quality 82). The words
the explorers show live in _data/chamfer/nn_text.yml, which this script does
not touch.

Needs Pillow (pip install Pillow).
"""

import argparse
import json
import re
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
QUALITY = 82
DIRECTIONS = {"fidelity": "precision_figure", "coverage": "recall_figure"}
# The classes in the paper's column order, with the names the explorers show.
CLASSES = [
    ("butterfly", "Butterfly", "butterflies"),
    ("lizard", "Lizard", "lizards"),
    ("planes", "Warplane", "warplanes"),
]
LEVELS = ["1", "2", "3"]
NEIGHBOURS = ["nn1", "nn2", "nn3"]


def distances(log):
    """The distance of each neighbour, from a distances.log."""
    out = {}
    for line in log.read_text().splitlines():
        m = re.match(r"(nn\d+):\s*\S+\s+dist=([\d.]+)", line)
        if m:
            out[m.group(1)] = float(m.group(2))
    return out


def to_webp(src, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as im:
        im.convert("RGB").save(dest, "WEBP", quality=QUALITY, method=6)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("figures", type=Path, help="the paper's figures folder")
    args = parser.parse_args()
    src = args.figures.expanduser().resolve()

    out = ROOT / "assets" / "img" / "chamfer" / "nn"
    shutil.rmtree(out, ignore_errors=True)
    data = {}
    top = 0.0
    for direction, folder in DIRECTIONS.items():
        classes = []
        for cid, name, plural in CLASSES:
            levels = []
            for level in LEVELS:
                here = src / folder / cid / level
                dist = distances(here / "distances.log")
                rel = f"{direction}/{cid}/{level}"
                to_webp(here / "query.png", out / f"{rel}-query.webp")
                neighbours = []
                for nn in NEIGHBOURS:
                    to_webp(here / f"{nn}.png", out / f"{rel}-{nn}.webp")
                    neighbours.append({"file": f"{rel}-{nn}.webp", "d": round(dist[nn], 2)})
                    top = max(top, dist[nn])
                levels.append({"query": f"{rel}-query.webp", "neighbours": neighbours})
            classes.append({"id": cid, "name": name, "plural": plural, "levels": levels})
            print(f"{direction:<9} {name:<10} " + "  ".join(f"{lv['neighbours'][0]['d']:5.2f}" for lv in levels))
        data[direction] = {"classes": classes}
    # Both explorers share one distance axis, so their numbers can be compared.
    data["x_max"] = 2 * int(top / 2 + 1)
    data["source"] = (
        "Figures 6 and 7 of the paper (Chamfer-Overleaf/figures/{precision,recall}_figure): "
        "IMM-XL (8 steps) against ImageNet-1K, distances in Inception-v3 feature space; "
        "loaded by bin/chamfer/nn_examples.py"
    )
    path = ROOT / "_data" / "chamfer" / "nn_examples.json"
    path.write_text(json.dumps(data, indent=2) + "\n")
    files = list(out.rglob("*.webp"))
    print(f"distance axis 0 to {data['x_max']}")
    print(f"{out.relative_to(ROOT)}: {len(files)} images, {sum(f.stat().st_size for f in files) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
