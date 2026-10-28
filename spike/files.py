"""Optional Files endpoint profile: POST /v1/files, then DELETE (SPEC.md 6.5).

python spike/files.py --image fixtures/plain-wall-right.jpg

The app never calls Files. This profile stays blocked while budget/prices.json
lists Files pricing as unknown (null): unknown pricing stops paid calls.
"""

from __future__ import annotations

import json
from pathlib import Path

import requests

import common


def main() -> int:
    parser = common.base_parser(__doc__.splitlines()[0])
    parser.add_argument("--image", type=Path, default=Path("fixtures/plain-wall-right.jpg"))
    parser.add_argument("--delete", action="store_true", help="Also test DELETE /files/{id}.")
    args = parser.parse_args()
    if common.load_prices()["prices"].get("files") is None:
        raise common.SpikeExit(common.EXIT_BUDGET, "Files pricing is unknown in "
                               "budget/prices.json; Files profile blocked (optional, not MVP).")
    name = args.image.name
    if not args.dry_run:
        common.require_rights(name)
    n, _, placeholder = common.fixture_image(name, allow_placeholder=args.dry_run)
    if args.dry_run:
        print(json.dumps({"placeholderImage": placeholder, "multipart": {
            "purpose": "user_data", "file": f"<normalized webp, {len(n.data)} bytes>"}}, indent=2))
        return common.EXIT_PASSED
    config = common.Config.load()
    budget = common.Budget(config, args.ticket)
    amount = common.load_prices()["prices"]["files"]["perUploadMicroUsd"]
    result = common.paid_call(
        budget, profile="files_upload", route="/files", model="files", amount=amount,
        body_for_fingerprint=n.data, deadline_s=40,
        dispatch=lambda: common.meta_post(config, "/files", data={"purpose": "user_data"},
                                          files={"file": ("photo.webp", n.data, "image/webp")}),
        charge=lambda r: amount)
    summary = {"upload": common.response_summary(result)}
    ok = result.status == 200
    if ok:
        response = json.loads(result.body)
        summary["uploadStructure"] = common.structure(response)
        file_id = response.get("id")
        ok = bool(file_id)
        if ok and args.delete:
            headers = {"Authorization": f"Bearer {config.api_key}"}
            d = requests.delete(f"{common.META_BASE}/files/{file_id}", headers=headers, timeout=20)
            g = requests.get(f"{common.META_BASE}/files/{file_id}", headers=headers, timeout=20)
            summary["delete"] = {"deleteStatus": d.status_code, "getAfterDeleteStatus": g.status_code}
    common.write_result("files", name, "passed" if ok else "failed",
                        common.sha256_hex(n.data), summary)
    print(f"files: {'passed' if ok else 'failed'}")
    return common.EXIT_PASSED if ok else common.EXIT_ASSERTION


if __name__ == "__main__":
    common.run_main(main)
