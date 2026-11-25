#!/usr/bin/env python3
"""Turn the paper's model benchmark table into the Chamfer chart's data.

Reads the LaTeX table (by default the one labelled tab:100k-combined) and
writes _data/chamfer_models.json, which the ranking chart on the Chamfer page
draws from. Re-run it whenever the table changes; never edit the JSON by hand.

    python3 bin/chamfer_table_to_json.py ~/Desktop/Chamfer/Chamfer-Overleaf/sections/experiments.tex

What it takes from the table:
  - each row's mean (the first argument of \\meanstd{mean}{std}, or a plain
    number); a cell with "?" in it becomes null
  - the model name, with citations, struts and "cfg = 1.5" removed; rows that
    end up with the same name (DiT-XL/2 at 50, 125 and 250 steps) get their
    NFE added, as "(250 steps)"
  - the family, from the italic heading above the rows (\\multicolumn{...}{\\textit{GANs}})

The id of a model (used for its samples folder, assets/chamfer-samples/<id>/,
and in _data/chamfer_chart.yml) is its name in lowercase with every run of
other characters turned into "-": "DiT-XL/2 (250 steps)" -> "dit-xl-2-250-steps".

The columns are read in the order of COLUMNS below; change it if the table's
columns change. Only the standard library is used.
"""

import argparse
import json
import re
import sys
from pathlib import Path

# Table columns after the model name, in order, and whether each is a whole number.
COLUMNS = [
    ("params", True),  # millions
    ("nfe", True),
    ("fd_dinov2", False),
    ("precision", False),
    ("recall", False),
    ("chamfer_fid", False),
    ("chamfer_cov", False),
    ("fid", False),
]

OUT = Path(__file__).resolve().parent.parent / "_data" / "chamfer_models.json"


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def strip_comment(line):
    """Drop a LaTeX comment: everything from the first % that is not escaped."""
    match = re.search(r"(?<!\\)%", line)
    return line[: match.start()] if match else line


def table_body(tex, label):
    """The lines of the tabular holding \\label{label}, between \\toprule and \\bottomrule."""
    at = tex.find(f"\\label{{{label}}}")
    if at < 0:
        sys.exit(f"No \\label{{{label}}} found.")
    start = tex.find("\\begin{tabular}", at)
    end = tex.find("\\end{tabular}", start)
    if start < 0 or end < 0:
        sys.exit(f"No tabular found after \\label{{{label}}}.")
    lines = [strip_comment(line) for line in tex[start:end].splitlines()]
    top = next(i for i, line in enumerate(lines) if "\\midrule" in line)  # rows start after the header's rule
    return lines[top + 1 :]


def rows(lines):
    """Join lines into table rows (each ending in \\\\), skipping rules."""
    row = ""
    for line in lines:
        if "\\bottomrule" in line:
            break
        if re.match(r"\s*\\(mid|top|bottom|c)rule", line):
            continue
        row += " " + line.strip()
        if "\\\\" in row:
            yield row.split("\\\\")[0].strip()
            row = ""


def number(cell, whole):
    if "?" in cell:
        return None
    match = re.search(r"\\meanstd\{([^}]*)\}", cell)
    text = match.group(1) if match else re.sub(r"[{}\s]", "", cell)
    try:
        value = float(text)
    except ValueError:
        sys.exit(f"Cannot read a number from {cell!r}.")
    return int(value) if whole and value.is_integer() else value


def model_name(cell):
    name = re.sub(r"~?\\cite[pt]?\{[^}]*\}", "", cell)
    name = re.sub(r"\\[TB]strut", "", name)
    name = re.sub(r",?\s*cfg\s*\$\s*=\s*[\d.]+\s*\$", "", name)
    name = re.sub(r"\(\s*\)", "", name)
    name = re.sub(r"\$([^$]*)\$", r"\1", name)
    return re.sub(r"\s+", " ", name).strip()


def parse(tex, label):
    models = []
    family = None
    for row in rows(table_body(tex, label)):
        cells = [c.strip() for c in row.split("&")]
        heading = re.search(r"\\multicolumn\{[^}]*\}\{[^}]*\}\{\\textit\{([^}]*)\}\}", cells[0])
        if heading:
            family = heading.group(1).strip()
            continue
        if len(cells) != len(COLUMNS) + 1:
            sys.exit(f"Expected {len(COLUMNS) + 1} cells, found {len(cells)}: {row[:80]}...")
        if family is None:
            sys.exit("A model row comes before any family heading.")
        model = {"name": model_name(cells[0]), "family": slug(family), "family_name": family}
        for (key, whole), cell in zip(COLUMNS, cells[1:]):
            model[key] = number(cell, whole)
        models.append(model)

    # Rows that share a name are told apart by their NFE.
    names = [m["name"] for m in models]
    for m in models:
        if names.count(m["name"]) > 1 and m["nfe"] is not None:
            m["name"] = f"{m['name']} ({m['nfe']} {'step' if m['nfe'] == 1 else 'steps'})"
    for m in models:
        m["id"] = slug(m["name"])
    ids = [m["id"] for m in models]
    clashes = sorted({i for i in ids if ids.count(i) > 1})
    if clashes:
        sys.exit(f"Two models would share an id: {', '.join(clashes)}.")
    return [{"id": m.pop("id"), **m} for m in models]


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("tex", type=Path, help="the .tex file with the table")
    parser.add_argument("--label", default="tab:100k-combined", help="the table's \\label (default: %(default)s)")
    parser.add_argument("--out", type=Path, default=OUT, help="where to write the JSON (default: _data/chamfer_models.json)")
    args = parser.parse_args()

    models = parse(args.tex.read_text(encoding="utf-8"), args.label)
    data = {"source": f"{args.tex.name}, table {args.label}", "models": models}
    args.out.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    families = {}
    for m in models:
        families.setdefault(m["family_name"], []).append(m["name"])
    print(f"Wrote {len(models)} models to {args.out}")
    for name, members in families.items():
        print(f"  {name} ({slug(name)}): {', '.join(members)}")
    missing = [m["name"] for m in models for k, _ in COLUMNS if m[k] is None]
    if missing:
        print(f"  Missing values (null) for: {', '.join(sorted(set(missing)))}")


if __name__ == "__main__":
    main()
