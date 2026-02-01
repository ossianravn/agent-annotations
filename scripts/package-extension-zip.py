#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import zipfile


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    chrome_dir = repo_root / "chrome-extension"
    manifest_path = chrome_dir / "manifest.json"

    parser = argparse.ArgumentParser(description="Package the unpacked Chrome extension as a zip.")
    parser.add_argument(
        "--out",
        default="",
        help="Output zip path (default: dist/agent-annotations-chrome-extension-v<VERSION>.zip)",
    )
    parser.add_argument("--version", default="", help="Override version (default: manifest.json version).")
    parser.add_argument(
        "--prefix",
        default="agent-annotations-chrome-extension",
        help="Top-level folder name inside the zip (default: agent-annotations-chrome-extension).",
    )
    args = parser.parse_args()

    if not chrome_dir.exists():
        raise SystemExit(f"Missing directory: {chrome_dir}")
    if not manifest_path.exists():
        raise SystemExit(f"Missing file: {manifest_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    version = (args.version or manifest.get("version") or "").strip()
    if not version:
        raise SystemExit("Could not determine version (manifest.json missing 'version').")

    gh_ref = os.environ.get("GITHUB_REF_NAME", "").strip()
    if gh_ref.startswith("v") and gh_ref != f"v{version}":
        raise SystemExit(f"Tag/version mismatch: tag={gh_ref} manifest={version}")

    out_path = Path(args.out) if args.out else (repo_root / "dist" / f"agent-annotations-chrome-extension-v{version}.zip")
    out_path = out_path.resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        out_path.unlink()

    zip_root_prefix = args.prefix.strip().strip("/\\")
    if not zip_root_prefix:
        raise SystemExit("--prefix cannot be empty.")

    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(chrome_dir.rglob("*")):
            if path.is_dir():
                continue
            rel = path.relative_to(chrome_dir).as_posix()
            if rel.endswith(".DS_Store"):
                continue
            arcname = f"{zip_root_prefix}/{rel}"
            zf.write(path, arcname)

    digest = sha256_file(out_path)
    sha_path = out_path.with_suffix(out_path.suffix + ".sha256")
    sha_path.write_text(f"{digest}  {out_path.name}\n", encoding="utf-8")

    print(out_path)
    print(sha_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

