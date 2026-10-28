"""Run spike or smoke profiles in order and report each result honestly.

python spike/run_all.py --mode spike --fixture-set all
python spike/run_all.py --mode smoke --fixture-set plain

smoke: one SAM concept/point pair, one identify/instruction pair, one high
paint edit, reusing cached passes. spike: also the parts queue and every
fixture case. Opt-in profiles: --with compose,grounded,files,asr.
A skipped or blocked profile is never counted as passed.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

SPIKE = Path(__file__).resolve().parent
LABELS = {0: "passed", 1: "FAILED", 2: "blocked: config/fixtures/rights",
          3: "blocked: budget/accounting", 4: "FAILED: upstream", 5: "skipped (optional)"}
# Worst first; the overall exit code is the most severe one seen.
SEVERITY = [1, 4, 3, 2, 5, 0]


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--mode", choices=["spike", "smoke"], required=True)
    p.add_argument("--fixture-set", choices=["plain", "all"], default="plain")
    p.add_argument("--with", dest="extras", default="",
                   help="Comma list of opt-in profiles: compose, grounded, files, asr")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--force", action="store_true")
    p.add_argument("--ticket", default="T0")
    args = p.parse_args()
    extras = {e.strip() for e in args.extras.split(",") if e.strip()}
    fs = args.fixture_set if args.mode == "spike" else "plain"

    steps = [["local_images.py", "--fixture-set", fs],
             ["responses_sam.py", "--mode", "concept"],
             ["responses_sam.py", "--mode", "points"]]
    if args.mode == "spike":
        steps.append(["responses_sam.py", "--mode", "parts", "--fixture-set", fs])
    steps += [["responses_spark.py", "--mode", "identify"],
              ["responses_spark.py", "--mode", "instruction"],
              ["images_edits.py", "--mode", "edit"]]
    if "compose" in extras:
        steps.append(["images_edits.py", "--mode", "compose"])
    if "grounded" in extras:
        steps.append(["responses_spark.py", "--mode", "grounded"])
    if "files" in extras:
        steps.append(["files.py"])
    if "asr" in extras:
        steps.append(["asr_transcribe.py"])

    passthrough = (["--dry-run"] if args.dry_run else []) + (["--force"] if args.force else [])
    results = []
    for step in steps:
        cmd = [sys.executable, str(SPIKE / step[0]), *step[1:]]
        if step[0] not in ("local_images.py",):
            cmd += ["--ticket", args.ticket] + passthrough
        print(f"\n=== {' '.join(step)}", flush=True)
        code = subprocess.call(cmd)
        results.append((" ".join(step), code))

    print("\nSummary" + (" (dry run: request shapes only, no HTTP)" if args.dry_run else ""))
    for name, code in results:
        label = LABELS.get(code, f"exit {code}")
        if args.dry_run and code == 0 and name.split()[0] != "local_images.py":
            label = "shape ok (no HTTP)"
        print(f"  {label:32s} {name}")
    codes = {c for _, c in results}
    return next(c for c in SEVERITY if c in codes) if codes else 0


if __name__ == "__main__":
    sys.exit(main())
