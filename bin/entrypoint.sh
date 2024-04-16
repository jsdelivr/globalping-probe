#!/usr/bin/env bash

update-ca-certificates

function run_probe() {
	node /app/dist/index.js
	return
}

function try_update() {
	echo "Checking for the latest version"

	response=$(curl -XGET -Lf -sS "https://api.github.com/repos/jsdelivr/globalping-probe/releases/latest")

	if [ $? != 0 ]; then
		echo "Failed to fetch the latest version data"
		return
	fi

	latestVersion=$(jq -r ".tag_name" <<<"${response}" | sed 's/v//')
	latestBundle=$(jq -r ".assets[] .browser_download_url" <<<"${response}")

	currentVersion=$(jq -r ".version" "/app/package.json")

	echo "Current version $currentVersion"
	echo "Latest version $latestVersion"

	if [ "$(printf '%s\n' "$latestVersion" "$currentVersion" | sort -V | head -n1)" != "$latestVersion" ]; then
		if [ "$latestVersion" != "$currentVersion" ]; then
			loadedTarball="globalping-probe-${latestVersion}"

			echo "Start self-update process"

			curl -XGET -Lf -sS "${latestBundle}" -o "/tmp/${loadedTarball}.tar.gz"

			if [ $? != 0 ]; then
				echo "Failed to fetch the release tarball"
				return
			fi

			tar -xzf "/tmp/${loadedTarball}.tar.gz" --one-top-level="/tmp/${loadedTarball}"

			if [ $? != 0 ]; then
				echo "Failed to extract the release tarball"
				return
			fi

			rm -rf "/app"
			mv "/tmp/${loadedTarball}" "/app"
			cd "/app" || exit

			rm -rf "/tmp/${loadedTarball}.tar.gz"

			echo "Self-update finished"
		fi
	fi
}

try_update
run_probe
