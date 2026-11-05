#!/usr/bin/env bash
# ffmpeg for the render: skip if already there. Ubuntu's own packages, reused from the Actions cache when
# a past run saved them (Ubuntu's mirror sometimes stalls for minutes), else downloaded with time-limited
# retries and saved for next time. Extras are skipped (--no-install-recommends): far fewer packages to fetch.
set -uo pipefail
command -v ffmpeg >/dev/null && { ffmpeg -version | head -1; exit 0; }
cache="$HOME/.cache/ffmpeg-debs"
if ls "$cache"/*.deb >/dev/null 2>&1 && sudo dpkg -i "$cache"/*.deb >/dev/null 2>&1 && command -v ffmpeg >/dev/null; then
  echo "ffmpeg from cached packages"
else
  for i in 1 2 3; do
    timeout 240 sudo apt-get update -q && timeout 300 sudo apt-get install -y -q --no-install-recommends ffmpeg && break
    echo "ffmpeg install try $i stalled; retrying"; sleep 10
  done
  if command -v ffmpeg >/dev/null; then mkdir -p "$cache" && cp /var/cache/apt/archives/*.deb "$cache"/ 2>/dev/null || true; fi
fi
command -v ffmpeg >/dev/null && ffmpeg -version | head -1
