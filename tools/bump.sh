#!/bin/sh
# Stamp one build number everywhere it must match: sw.js VERSION, index.html ASSET_V,
# every ?v= on the page's scripts and styles, and APP_BUILD in app.js.
# Usage: tools/bump.sh            (uses the current UTC time, YYYYMMDDHHMM)
#        tools/bump.sh 202611181400
set -e
cd "$(dirname "$0")/.."
V="${1:-$(date -u +%Y%m%d%H%M)}"
sed -i -E "s/const VERSION = '[0-9]+'/const VERSION = '$V'/" sw.js
sed -i -E "s/window\.ASSET_V=\"[0-9]+\"/window.ASSET_V=\"$V\"/; s/\?v=[0-9]+/?v=$V/g" index.html
sed -i -E "s/const APP_BUILD = '[0-9]+'/const APP_BUILD = '$V'/" app.js
grep -c "$V" sw.js index.html app.js
