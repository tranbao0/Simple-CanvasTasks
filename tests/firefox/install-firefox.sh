#!/usr/bin/env bash
# Downloads a pinned Firefox release and geckodriver for the local Firefox smoke test.
#
# Files go to ~/.cache/weekrow-test (or $WEEKROW_TEST_CACHE):
#   firefox/firefox   the Firefox binary
#   geckodriver       the driver
# Each download is checked against a pinned SHA-256 checksum before it is unpacked.
# Linux x86_64 and aarch64 only. CI uses the Firefox and geckodriver of the runner image instead.
# Firefox also needs the usual desktop libraries (GTK 3, ALSA and others) from the system.
set -euo pipefail

FIREFOX_VERSION=159.0
GECKODRIVER_VERSION=0.37.1

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)
    FIREFOX_PLATFORM=linux-x86_64
    FIREFOX_SHA256=54536fcd120af484d4c56272a5a1cf4af57b9c713d1a3b1e775da192dd541fcd
    GECKODRIVER_PLATFORM=linux64
    GECKODRIVER_SHA256=e815130ea95983e162ae91843b48d3a3ce991735635fce83a647afde21e09f7e
    ;;
  Linux-aarch64)
    FIREFOX_PLATFORM=linux-aarch64
    FIREFOX_SHA256=de7b16588bf3ab11774f6c1b1461dafde943c1cf0ea93dc15aa5f7bd99aa1191
    GECKODRIVER_PLATFORM=linux-aarch64
    GECKODRIVER_SHA256=8fd90b951422fbad5b56539fb344dff66eb3f986d615d8d6fde9f1f62dad610c
    ;;
  *)
    echo "This script supports Linux x86_64 and aarch64 only." >&2
    echo "Elsewhere, install Firefox and geckodriver yourself and set FIREFOX_BIN and GECKODRIVER_BIN." >&2
    exit 1
    ;;
esac

CACHE_DIR="${WEEKROW_TEST_CACHE:-$HOME/.cache/weekrow-test}"
FIREFOX_URL="https://ftp.mozilla.org/pub/firefox/releases/${FIREFOX_VERSION}/${FIREFOX_PLATFORM}/en-US/firefox-${FIREFOX_VERSION}.tar.xz"
GECKODRIVER_URL="https://github.com/mozilla/geckodriver/releases/download/v${GECKODRIVER_VERSION}/geckodriver-v${GECKODRIVER_VERSION}-${GECKODRIVER_PLATFORM}.tar.gz"
VERSION_FILE="$CACHE_DIR/versions.txt"
WANTED_VERSIONS="firefox=${FIREFOX_VERSION} geckodriver=${GECKODRIVER_VERSION} platform=${FIREFOX_PLATFORM}"

if [[ -f "$VERSION_FILE" && "$(cat "$VERSION_FILE")" == "$WANTED_VERSIONS" ]]; then
  echo "Firefox ${FIREFOX_VERSION} and geckodriver ${GECKODRIVER_VERSION} are already in $CACHE_DIR."
  exit 0
fi

mkdir -p "$CACHE_DIR"
WORK_DIR="$(mktemp -d "$CACHE_DIR/download.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

# download <url> <sha256> <file>
download() {
  echo "Downloading $1"
  curl --fail --location --silent --show-error --output "$3" "$1"
  echo "$2  $3" | sha256sum --check --quiet -
}

download "$FIREFOX_URL" "$FIREFOX_SHA256" "$WORK_DIR/firefox.tar.xz"
download "$GECKODRIVER_URL" "$GECKODRIVER_SHA256" "$WORK_DIR/geckodriver.tar.gz"

mkdir "$WORK_DIR/firefox-unpacked" "$WORK_DIR/geckodriver-unpacked"
tar -xJf "$WORK_DIR/firefox.tar.xz" -C "$WORK_DIR/firefox-unpacked"
tar -xzf "$WORK_DIR/geckodriver.tar.gz" -C "$WORK_DIR/geckodriver-unpacked"

rm -rf "$CACHE_DIR/firefox" "$CACHE_DIR/geckodriver"
mv "$WORK_DIR/firefox-unpacked/firefox" "$CACHE_DIR/firefox"
mv "$WORK_DIR/geckodriver-unpacked/geckodriver" "$CACHE_DIR/geckodriver"
chmod +x "$CACHE_DIR/geckodriver"
echo "$WANTED_VERSIONS" > "$VERSION_FILE"

echo "Installed Firefox ${FIREFOX_VERSION} in $CACHE_DIR/firefox and geckodriver ${GECKODRIVER_VERSION} in $CACHE_DIR."
