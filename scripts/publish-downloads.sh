#!/usr/bin/env bash
# Copy a release's installers from the private oovi repo to the PUBLIC downloads
# repo that the website's download buttons use. Only installer files are copied;
# the source code stays private.
#
#   npm run publish:downloads            # latest release
#   npm run publish:downloads -- v0.5.0  # a specific release
#
# Needs the GitHub CLI (gh), signed in with access to both repos.
set -euo pipefail

PRIVATE_REPO="${PRIVATE_REPO:-oussasz/oovi}"
PUBLIC_REPO="${PUBLIC_REPO:-oussasz/oovi-downloads}"
TAG="${1:-$(gh release view --repo "$PRIVATE_REPO" --json tagName --jq .tagName)}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "Downloading $TAG installers from $PRIVATE_REPO…"
gh release download "$TAG" --repo "$PRIVATE_REPO" --pattern "*.dmg" --pattern "*.exe" --dir "$WORK"
# Update files for the in-app updater (present from 0.7.0 on).
gh release download "$TAG" --repo "$PRIVATE_REPO" --pattern "latest*.yml" --pattern "*.blockmap" --dir "$WORK" 2>/dev/null || true
ls -lh "$WORK"

NOTES="oovi $TAG for Mac and Windows. Download from https://oovi.conuron.com/download.

The app isn't code-signed yet:
- Mac: right-click oovi in Applications, then Open, then Open.
- Windows: More info, then Run anyway."

if gh release view "$TAG" --repo "$PUBLIC_REPO" >/dev/null 2>&1; then
  echo "Updating existing release $TAG on $PUBLIC_REPO…"
  gh release upload "$TAG" "$WORK"/* --repo "$PUBLIC_REPO" --clobber
else
  echo "Creating release $TAG on $PUBLIC_REPO…"
  gh release create "$TAG" "$WORK"/* --repo "$PUBLIC_REPO" --title "oovi $TAG" --notes "$NOTES" --latest
fi
echo "Done: https://github.com/$PUBLIC_REPO/releases/tag/$TAG"
