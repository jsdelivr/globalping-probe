#!/usr/bin/env bash

update-ca-certificates

function run_probe() {
	node /app/dist/index.js
	return
}

function try_update() {
	echo "Checking for the latest version"

	response=$(curl -XGET -Lf -sS "https://data.jsdelivr.com/v1/packages/gh/jsdelivr/globalping-probe/resolved")

	if [ $? != 0 ]; then
		echo "Failed to fetch the latest version data"
		return
	fi

	latestVersion=$(jq -r ".version" <<<"${response}" | sed 's/v//')

	if [ -f /app-dev/latest-version.txt ]; then
		latestVersion=$(cat /app-dev/latest-version.txt)
	fi

	latestBundleA="https://cdn.jsdelivr.net/globalping-probe/v$latestVersion/globalping-probe.bundle.tar.gz"
	latestBundleB="https://fastly.jsdelivr.net/globalping-probe/v$latestVersion/globalping-probe.bundle.tar.gz"

	currentVersion=$(jq -r ".version" "/app/package.json")

	echo "Current version $currentVersion"
	echo "Latest version $latestVersion"

	if [ "$(printf '%s\n' "$latestVersion" "$currentVersion" | sort -V | head -n1)" != "$latestVersion" ]; then
		if [ "$latestVersion" != "$currentVersion" ]; then
			loadedTarball="globalping-probe-${latestVersion}"

			echo "Start self-update process"

			curl -XGET -Lf -sS "${latestBundleA}" -o "/tmp/${loadedTarball}.tar.gz"

			if [ $? != 0 ]; then
				curl -XGET -Lf -sS "${latestBundleB}" -o "/tmp/${loadedTarball}.tar.gz"

				if [ $? != 0 ]; then
					echo "Failed to fetch the release tarball"
					return
				fi
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
