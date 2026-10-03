#!/usr/bin/env bash
# Build BriefMe for Chrome and Firefox. Safari is built by CI on release (needs Xcode).
#
# Usage: ./build.sh [chrome|firefox|all] [--zip] [--skip-checks]
#   chrome | firefox | all   target browser (default: all)
#   --zip                    also create store-ready zip files in dist/
#   --skip-checks            skip typecheck, lint and tests
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

target="all"
zip=false
checks=true
for arg in "$@"; do
  case "$arg" in
    chrome | firefox | all) target="$arg" ;;
    --zip) zip=true ;;
    --skip-checks) checks=false ;;
    -h | --help)
      sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

if ! command -v node > /dev/null 2>&1 || ! command -v npm > /dev/null 2>&1; then
  echo "node and npm are required (Node 20 or newer)." >&2
  exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 20 ]; then
  echo "Node 20 or newer is required, found $(node -v)." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "==> Installing dependencies"
  npm ci
fi

if [ "$checks" = true ]; then
  echo "==> Typecheck"
  npm run --silent typecheck
  echo "==> Lint"
  npm run --silent lint
  echo "==> Tests"
  npm run --silent test
fi

build() {
  local browser="$1"
  echo "==> Building $browser"
  if [ "$browser" = "chrome" ]; then
    npx wxt build
  else
    npx wxt build -b "$browser"
  fi
  if [ "$zip" = true ]; then
    echo "==> Zipping $browser"
    if [ "$browser" = "chrome" ]; then
      npx wxt zip
    else
      npx wxt zip -b "$browser"
    fi
  fi
}

case "$target" in
  chrome) build chrome ;;
  firefox) build firefox ;;
  all)
    build chrome
    build firefox
    ;;
esac

echo
echo "Done. Output:"
ls -d dist/chrome-mv3 dist/firefox-mv3 2> /dev/null || true
if [ "$zip" = true ]; then
  ls dist/*.zip 2> /dev/null || true
fi
echo
echo "Chrome:  open chrome://extensions, enable Developer mode, Load unpacked, pick dist/chrome-mv3"
echo "Firefox: open about:debugging#/runtime/this-firefox, Load Temporary Add-on, pick dist/firefox-mv3/manifest.json"
