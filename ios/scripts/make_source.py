#!/usr/bin/env python3
"""Write an AltStore-format source (which Feather reads) for one release.

Usage: make_source.py <ipa> <tag> <version> <build> <out.json>
The feed URL users add is .../releases/latest/download/source.json, so each
release carries its own source.json pointing at its own IPA.
"""
import datetime
import json
import os
import sys

# The repo building it (a build-only copy publishes its own releases)
REPO = os.environ.get("GITHUB_REPOSITORY", "elabx-org/agent-os")

ipa, tag, version, build, out = sys.argv[1:6]
download = f"https://github.com/{REPO}/releases/download/{tag}/AgentOS.ipa"
icon = f"https://raw.githubusercontent.com/{REPO}/main/ios/App/Assets.xcassets/AppIcon.appiconset/icon-1024.png"
size = os.path.getsize(ipa)
date = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
notes = f"Build {build} from {os.environ.get('GITHUB_SHA', '')[:7]}".strip()

source = {
    "name": "Agent-OS",
    "identifier": "org.elabx.agentos.source",
    "subtitle": "Agent-OS for iPhone and iPhone Duo",
    "sourceURL": f"https://github.com/{REPO}/releases/latest/download/source.json",
    "iconURL": icon,
    "website": f"https://github.com/{REPO}",
    "apps": [
        {
            "name": "Agent-OS",
            "bundleIdentifier": "org.elabx.agentos",
            "developerName": "elabx",
            "subtitle": "Your AI coding sessions, native on iPhone Duo",
            "localizedDescription": "Agent-OS in a native shell: navigation in the system bar and terminal keys on the keyboard.",
            "iconURL": icon,
            "tintColor": "E6E7EA",
            "versions": [
                {
                    "version": version,
                    "buildVersion": build,
                    "date": date,
                    "localizedDescription": notes,
                    "downloadURL": download,
                    "size": size,
                    "minOSVersion": "26.0",
                }
            ],
            # Legacy single-version fields, for older AltStore-format readers.
            "version": version,
            "versionDate": date,
            "versionDescription": notes,
            "downloadURL": download,
            "size": size,
            "appPermissions": {"entitlements": [], "privacy": {}},
        }
    ],
    "news": [],
}

with open(out, "w") as f:
    json.dump(source, f, indent=2)
print(f"wrote {out}: {version} ({build}), {size} bytes -> {download}")
