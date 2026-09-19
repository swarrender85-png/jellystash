#!/bin/sh
# Usage: scripts/bump-version.sh 1.2.0
# Sets the version in index.html, sw.js and version.json together.
# Installed copies see the new version.json and update themselves.
set -e
V="$1"
echo "$V" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "Usage: $0 X.Y.Z"; exit 1; }
cd "$(dirname "$0")/.."
sed -i.bak -E "s/const VERSION=\"[0-9.]+\";/const VERSION=\"$V\";/" index.html
sed -i.bak -E "s/const VERSION = '[0-9.]+';/const VERSION = '$V';/" sw.js
printf '{ "version": "%s" }\n' "$V" > version.json
rm -f index.html.bak sw.js.bak
grep -o 'const VERSION="[0-9.]*"' index.html; grep -o "const VERSION = '[0-9.]*'" sw.js; cat version.json
