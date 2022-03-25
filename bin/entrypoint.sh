#!/usr/bin/env bash

function run_probe() {
  NODE_ENV=development node /app/dist/index.js
  return
}

response=$(curl -XGET "https://api.github.com/repos/jsdelivr/globalping-probe/releases/latest")
latestVersion=$(jq -r ".tag_name" <<<"${response}" | sed 's/v//')
latestTarball=$(jq -r ".assets[] .browser_download_url" <<<"${response}")

currentVersion=$(jq -r ".version" "package.json") || "foo"

if [ "$latestVersion" != "$currentVersion" ]; then
  loadedTarball="globalping-probe-${latestVersion}"

  curl -Ls -XGET "${latestTarball}" -o "/tmp/${loadedTarball}.tar.gz"
  tar -xzf "/tmp/${loadedTarball}.tar.gz" -C "/tmp"

  cd "/tmp/${loadedTarball}" || exit 1

  npm install --include=dev --no-progress \
  && npm run build \
  && npm install --no-progress --silent

  rm -rf "/app"
  mv "/tmp/${loadedTarball}" "/app"

  rm -rf "/tmp/${loadedTarball}.tar.gz"
fi

run_probe
