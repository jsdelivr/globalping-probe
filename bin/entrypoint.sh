#!/usr/bin/env bash

function run_probe() {
  NODE_ENV=development node /app/dist/index.js
  return
}

response=$(curl -XGET "https://api.globalping.io/v1/updates")
latestVersion=$(jq -r ".version" <<<"${response}")
latestTarball=$(jq -r ".tarball" <<<"${response}")

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
