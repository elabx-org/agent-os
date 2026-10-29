#!/usr/bin/env bash
#
# Release main: tags v<major>.<minor>.<n> (the next patch for the
# major.minor in package.json; edit that to start a new minor), writes a
# GitHub Release from the merged PRs and publishes the npm package the
# agent-os launcher installs from. Run after merging, before deploying, so
# the deployed build reports its version. Needs gh signed in with
# write:packages. (Actions is off for this repo, so this isn't a workflow.)
#
set -euo pipefail
cd "$(dirname "$0")/.."

git fetch -q origin main --tags
SHA=$(git rev-parse origin/main)
if git tag --points-at "$SHA" | grep -q '^v'; then
    echo "main ($(git rev-parse --short "$SHA")) is already $(git tag --points-at "$SHA" | grep '^v' | head -1)"
    exit 0
fi

BASE=$(git show "$SHA:package.json" | node -p 'JSON.parse(require("fs").readFileSync(0)).version.split(".").slice(0,2).join(".")')
LAST=$(git tag -l "v$BASE.*" | sed "s/^v$BASE\.//" | grep -E '^[0-9]+$' | sort -n | tail -1 || true)
VERSION="$BASE.$(( ${LAST:--1} + 1 ))"
echo "Releasing $(git rev-parse --short "$SHA") as v$VERSION"

git tag "v$VERSION" "$SHA"
git push -q origin "v$VERSION"
gh release create "v$VERSION" -R elabx-org/agent-os --verify-tag \
    --title "AgentOS v$VERSION" --generate-notes --latest >/dev/null

# The package from the tagged tree, at that version
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT
git archive "$SHA" | tar -x -C "$DIR"
(
    cd "$DIR"
    npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null
    printf '@elabx-org:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=%s\n' "$(gh auth token)" > .npmrc
    npm publish --ignore-scripts --userconfig .npmrc >/dev/null
)
echo "Released v$VERSION: https://github.com/elabx-org/agent-os/releases/tag/v$VERSION"
