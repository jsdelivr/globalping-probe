#!/usr/bin/env bash

update-ca-certificates

function run_probe() {
  node /app/dist/index.js
  return
}

echo "Checking for the latest version"

response=$(curl -XGET -s "https://api.github.com/repos/jsdelivr/globalping-probe/releases/latest")
latestVersion=$(jq -r ".tag_name" <<<"${response}" | sed 's/v//')
latestBundle=$(jq -r ".assets[] .browser_download_url" <<<"${response}")

currentVersion=$(jq -r ".version" "/app/package.json")

echo "Current version $currentVersion"
echo "Latest version $latestVersion"

if [ "$latestVersion" != "$currentVersion" ]; then
  loadedTarball="globalping-probe-${latestVersion}"

  echo "Start self-update process"

  curl -Ls -XGET "${latestBundle}" -o "/tmp/${loadedTarball}.tar.gz"
  tar -xzf "/tmp/${loadedTarball}.tar.gz" --one-top-level="/tmp/${loadedTarball}"

  rm -rf "/app"
  mv "/tmp/${loadedTarball}" "/app"
  cd "/app" || exit

  rm -rf "/tmp/${loadedTarball}.tar.gz"

  echo "Self-update finished"
fi

run_probe
