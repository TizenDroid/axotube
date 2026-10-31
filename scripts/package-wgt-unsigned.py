#!/usr/bin/env python3
"""Package freshly built standalone assets for signing by Apps2Samsung.

This .wgt is deliberately unsigned: Apps2Samsung signs a WGT for each TV
when installing it. Tizen Studio users must sign it with their own profile.
"""

import argparse
import json
from pathlib import Path
import re
import sys
from xml.etree import ElementTree
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
STANDALONE = ROOT / "standalone"
FILES = (
    "config.xml",
    "icon.png",
    "icon_16b9.png",
    "index.html",
    "service/dist/index.js",
    "userscript/early.js",
    "userscript/userScript.js",
    "userscript/version.json",
)


def build(output: Path) -> None:
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    config = ElementTree.parse(STANDALONE / "config.xml").getroot()
    bundle_version = json.loads(
        (STANDALONE / "userscript/version.json").read_text(encoding="utf-8")
    )["version"]
    if config.get("version") != version or bundle_version != version:
        raise ValueError(
            "WGT version mismatch: root %s, config %s, bundle %s"
            % (version, config.get("version"), bundle_version)
        )

    for name in FILES:
        file = STANDALONE / name
        if not file.is_file() or file.stat().st_size == 0:
            raise FileNotFoundError("Standalone build missing %s; run npm run build:standalone" % name)

    for name in ("userscript/early.js", "userscript/userScript.js"):
        data = (STANDALONE / name).read_bytes()
        if not 1_000 <= len(data) <= 5 * 1024 * 1024 or b"AxoTube" not in data:
            raise ValueError("Invalid generated script: %s" % name)

    # The Samsung widget contains no node_modules. If npm dependencies were not
    # installed before Rollup runs, it may silently leave require('node-fetch')
    # in the service and produce a WGT that installs but cannot start.
    service = (STANDALONE / "service/dist/index.js").read_text(encoding="utf-8")
    if len(service) < 200_000 or re.search(
        r"require\(['\"](?:node-fetch|express|cors|@patrickkfkan/peer-dial)['\"]\)",
        service,
    ):
        raise ValueError("Standalone service has unresolved dependencies; run npm ci --prefix service first")

    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for name in FILES:
            archive.write(STANDALONE / name, arcname=name)

    with ZipFile(output) as archive:
        if set(archive.namelist()) != set(FILES) or archive.testzip() is not None:
            raise ValueError("WGT archive failed verification")
    print("Packaged unsigned WGT %s (%s, %d bytes)" % (output, version, output.stat().st_size))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "release/axotube.wgt")
    args = parser.parse_args()
    try:
        build(args.output.resolve())
    except (OSError, ValueError, ElementTree.ParseError) as exc:
        print("WGT packaging error: %s" % exc, file=sys.stderr)
        sys.exit(1)
