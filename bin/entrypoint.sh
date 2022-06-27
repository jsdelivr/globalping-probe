#!/usr/bin/env bash

update-ca-certificates

# temp code that installs unbuffer without the need to pull the container again
# remove this code in about 3-4 months when all probes should have the container pulled
ARCHLOCAL=$(dpkg --print-architecture)

if [[ ! -f "/usr/bin/unbuffer" ]]; then

curl -O http://ftp.nl.debian.org/debian/pool/main/e/expect/tcl-expect_5.45.4-2+b1_${ARCHLOCAL}.deb
dpkg --extract tcl-expect_5.45.4-2+b1_${ARCHLOCAL}.deb /

curl -O http://ftp.nl.debian.org/debian/pool/main/t/tcl8.6/libtcl8.6_8.6.11+dfsg-1_${ARCHLOCAL}.deb
dpkg --extract libtcl8.6_8.6.11+dfsg-1_${ARCHLOCAL}.deb /

curl -O http://ftp.nl.debian.org/debian/pool/main/t/tcl8.6/tcl8.6_8.6.11+dfsg-1_${ARCHLOCAL}.deb
dpkg --extract tcl8.6_8.6.11+dfsg-1_${ARCHLOCAL}.deb /

curl -O http://ftp.nl.debian.org/debian/pool/main/e/expect/expect_5.45.4-2+b1_${ARCHLOCAL}.deb
dpkg --extract expect_5.45.4-2+b1_${ARCHLOCAL}.deb /

fi
# end temp code


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
