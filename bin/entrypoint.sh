#!/usr/bin/env bash

function run_probe() {
  node /app/dist/index.js
  return
}

response=$(curl -XGET -s "https://api.github.com/repos/jsdelivr/globalping-probe/releases/latest")
latestVersion=$(jq -r ".tag_name" <<<"${response}" | sed 's/v//')
latestBundle=$(jq -r ".assets[] .browser_download_url" <<<"${response}")

currentVersion=$(jq -r ".version" "/app/package.json")

if [ "$latestVersion" != "$currentVersion" ]; then
  loadedTarball="globalping-probe-${latestVersion}"

  curl -Ls -XGET "${latestBundle}" -o "/tmp/${loadedTarball}.tar.gz"
  tar -xzf "/tmp/${loadedTarball}.tar.gz" --one-top-level="/tmp/${loadedTarball}"

  rm -rf "/app"
  mv "/tmp/${loadedTarball}" "/app"

  rm -rf "/tmp/${loadedTarball}.tar.gz"
fi

run_probe
