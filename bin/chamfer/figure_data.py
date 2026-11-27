#!/usr/bin/env python3
"""Load the exported data for the Chamfer page's Figures 11 and 12 into the site.

The two figures are the interactive distance plots drawn by
_includes/chamfer/fidelity-density.liquid. This script reads the export
described in ~/Desktop/Chamfer/Blog/FIGURE_DATA_SPEC.md and writes what the
plots draw. Re-run it whenever the export changes; never edit the outputs by hand.

    python3 bin/chamfer/figure_data.py ~/Downloads/chamfer-figure-data

Reads:
  fig11/fig11.csv   model,file,distance
  fig11/curves.csv  model,x,percent
  fig11/<model>/    the generated images
  fig12/fig12.csv   model,real_file,generated_file,distance
  fig12/curves.csv  model,x,percent
  fig12/real/       the real images
  fig12/<model>/    the generated images
  fig10/fig10.csv   class,model,file,distance (if the export has it; see
                    ~/Desktop/Chamfer/Blog/FIGURE10_DATA_SPEC.md)
  fig10/curves.csv  class,model,x,percent
  fig10/<class>/<model>/  the generated images

Writes:
  assets/img/chamfer/fidelity/<model>/<name>.webp   Figure 11's images
  assets/img/chamfer/coverage/<model>/<name>.webp   Figure 12's generated images
  assets/img/chamfer/coverage/real/<name>.webp      Figure 12's real images
  assets/img/chamfer/class/<class>/<model>/<name>.webp  Figure 10's images
  _data/chamfer/fidelity_density.json           Figure 11's curves and samples
  _data/chamfer/coverage_density.json           Figure 12's curves and samples
  _data/chamfer/class_density.json              Figure 10's curves and samples, per class

The two image folders are emptied first. Images become WebP (quality 82), no
larger than 256 px. Everything the charts draw comes from the export: the
curves, the samples, each model's mean (the curve's centre of mass, which
matches the mean over all samples to within 0.0005) and the length of the
distance axis (the curves' range, rounded up to 0.1). Labels, model names and
colours stay as they are in the JSON files.

Figure 10's means are the README's (its checks list each class and model's mean
over all 1,000 samples). Its curves are wider and cut at 1.3, so their centre of
mass falls short of the true mean by up to 0.001; the curve is used only for a
class and model the README does not list.

Needs Pillow (pip install Pillow).
"""

import argparse
import csv
import json
import math
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SIZE = 256  # the longest side of a stored image, in px
QUALITY = 82  # WebP quality
CURVE_STEP = 2  # keep every n-th point of a curve; 1000 points become 500


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def to_webp(src, dest):
    """Convert one image to WebP at dest, no larger than SIZE; return dest's name."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as im:
        im = im.convert("RGB")
        if max(im.size) > SIZE:
            im.thumbnail((SIZE, SIZE), Image.Resampling.LANCZOS)
        im.save(dest, "WEBP", quality=QUALITY, method=6)
    return dest.name


def curve_mean(pts):
    """The mean distance under a curve (its centre of mass)."""
    area = sum(y for _, y in pts)
    return sum(x * y for x, y in pts) / area


def curves(rows):
    """Each model's curve, thinned to every CURVE_STEP-th point, with its mean and range."""
    by_model = defaultdict(list)
    for row in rows:
        by_model[row["model"]].append((float(row["x"]), float(row["percent"])))
    out = {}
    for model, pts in by_model.items():
        pts.sort()
        kept = pts[::CURVE_STEP]
        if kept[-1] != pts[-1]:
            kept.append(pts[-1])
        out[model] = {
            "curve": [[round(x, 4), round(y, 3)] for x, y in kept],
            "mean": curve_mean(pts),  # from every point, before thinning
            "x_end": pts[-1][0],
        }
    return out


def webp_name(name):
    return re.sub(r"\.[^.]+$", "", name) + ".webp"


def load(json_path, curve_path, samples_by_model, note):
    """Replace the curves and samples in a data file, keeping everything else."""
    data = json.loads(json_path.read_text())
    new_curves = curves(read_csv(curve_path))
    for m in data["models"]:
        mid = m["id"]
        if mid not in new_curves or mid not in samples_by_model:
            sys.exit(f"{json_path.name}: no curve or samples for model {mid!r} in the export")
        m["curve"] = new_curves[mid]["curve"]
        m["mean"] = round(new_curves[mid]["mean"], 3)
        m["samples"] = sorted(samples_by_model[mid], key=lambda s: s["d"])
        print(f"  {m['name']:<12} {len(m['samples']):>3} samples, mean {m['mean']}")
    # The distance axis runs to the end of the curves, rounded up to 0.1.
    data["x_max"] = math.ceil(max(c["x_end"] for c in new_curves.values()) * 10 - 1e-9) / 10
    data.pop("y_ticks", None)  # the y axis now fits the curves (see the script)
    print(f"  distance axis 0 to {data['x_max']}")
    data["source"] = (
        f"{data['source'].split(';')[0].split(' (')[0]}; curves and samples from the paper's export "
        "(sample_interpret/export_figure_data.py), loaded by bin/chamfer/figure_data.py"
    )
    data["samples_note"] = note
    json_path.write_text(json.dumps(data, indent=2) + "\n")


def readme_means(path):
    """Figure 10's mean over all samples, per (class, model), from the README's checks:
    lines like "- macaw / imeanflow: 21 images ...; mean over all 0.4089 (PDF 0.409) PASS"."""
    if not path.exists():
        return {}
    means = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*-\s*([\w-]+) / ([\w-]+):.*?mean over all ([\d.]+)", line)
        if m:
            means[(m[1], m[2])] = float(m[3])
    return means


def load_classes(json_path, src10, out10, means):
    """Replace each class's curves and samples in Figure 10's data file, keeping names and colours."""
    data = json.loads(json_path.read_text())
    shutil.rmtree(out10, ignore_errors=True)
    samples = defaultdict(list)
    for row in read_csv(src10 / "fig10.csv"):
        cls, model = row["class"], row["model"]
        name = to_webp(src10 / cls / model / row["file"], out10 / cls / model / webp_name(row["file"]))
        samples[(cls, model)].append({"file": f"{cls}/{model}/{name}", "d": round(float(row["distance"]), 5)})
    rows_by_class = defaultdict(list)
    for row in read_csv(src10 / "curves.csv"):
        rows_by_class[row["class"]].append(row)
    x_end = 0
    for c in data["classes"]:
        new_curves = curves(rows_by_class.get(c["id"], []))
        for m in c["models"]:
            key = (c["id"], m["id"])
            if m["id"] not in new_curves or key not in samples:
                sys.exit(f"{json_path.name}: no curve or samples for {c['id']!r} / {m['id']!r} in the export")
            m["curve"] = new_curves[m["id"]]["curve"]
            m["mean"] = round(means.get(key, new_curves[m["id"]]["mean"]), 3)
            m["samples"] = sorted(samples[key], key=lambda s: s["d"])
            x_end = max(x_end, new_curves[m["id"]]["x_end"])
            source = "" if key in means else " (from the curve: not in the README)"
            print(f"  {c['name']:<16} {m['name']:<11} {len(m['samples']):>3} samples, mean {m['mean']}{source}")
    data["x_max"] = math.ceil(x_end * 10 - 1e-9) / 10
    data["source"] = (
        "Figure 10 of the paper; curves and samples from the paper's export "
        "(sample_interpret/export_figure_data.py), loaded by bin/chamfer/figure_data.py"
    )
    data["samples_note"] = (
        "One generated sample drawn at random (seed 0) from each of 25 equal bins of distance in [0, 1.3), "
        "per class and model; "
        "file is relative to the images folder."
    )
    json_path.write_text(json.dumps(data, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("export", type=Path, help="the chamfer-figure-data folder")
    args = parser.parse_args()
    src = args.export.expanduser().resolve()

    # Figure 11: one generated image per sample.
    out11 = ROOT / "assets" / "img" / "chamfer" / "fidelity"
    shutil.rmtree(out11, ignore_errors=True)
    samples11 = defaultdict(list)
    for row in read_csv(src / "fig11" / "fig11.csv"):
        model = row["model"]
        name = to_webp(src / "fig11" / model / row["file"], out11 / model / webp_name(row["file"]))
        samples11[model].append({"file": f"{model}/{name}", "d": round(float(row["distance"]), 5)})
    print("Figure 11:")
    load(
        ROOT / "_data" / "chamfer" / "fidelity_density.json",
        src / "fig11" / "curves.csv",
        samples11,
        "One generated sample drawn at random (seed 0) from each 0.01-wide bin of distance in [0, 0.8); "
        "file is relative to the images folder.",
    )

    # Figure 12: a real image and the model's generated sample nearest to it.
    out12 = ROOT / "assets" / "img" / "chamfer" / "coverage"
    shutil.rmtree(out12, ignore_errors=True)
    samples12 = defaultdict(list)
    done_real = {}
    for row in read_csv(src / "fig12" / "fig12.csv"):
        model = row["model"]
        real = row["real_file"]
        if real not in done_real:
            done_real[real] = to_webp(src / "fig12" / "real" / real, out12 / "real" / webp_name(real))
        gen = to_webp(src / "fig12" / model / row["generated_file"], out12 / model / webp_name(row["generated_file"]))
        samples12[model].append(
            {"file": f"{model}/{gen}", "real": f"real/{done_real[real]}", "d": round(float(row["distance"]), 5)}
        )
    print("Figure 12:")
    load(
        ROOT / "_data" / "chamfer" / "coverage_density.json",
        src / "fig12" / "curves.csv",
        samples12,
        "One real image drawn at random (seed 0) from each 0.01-wide bin of distance in [0, 0.8), "
        "with the model's generated sample nearest to it; real and file are relative to the images folder.",
    )

    # Figure 10: per class, one generated image per sample. Optional: older exports lack it,
    # and the page then keeps the stand-in read from the paper's PDFs.
    out10 = ROOT / "assets" / "img" / "chamfer" / "class"
    if (src / "fig10" / "fig10.csv").exists():
        print("Figure 10:")
        load_classes(ROOT / "_data" / "chamfer" / "class_density.json", src / "fig10", out10, readme_means(src / "README.md"))
    else:
        print("Figure 10: not in this export; left as it is")

    for folder in (out11, out12, out10):
        if not folder.exists():
            continue
        files = list(folder.rglob("*.webp"))
        size = sum(f.stat().st_size for f in files)
        print(f"{folder.relative_to(ROOT)}: {len(files)} images, {size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
