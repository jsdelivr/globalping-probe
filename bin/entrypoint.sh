#!/usr/bin/env bash

update-ca-certificates

function run_probe() {
	echo "Starting probe..."
	exec node /app/dist/index.js
	return
}

function try_update() {
	echo "Checking for the latest version"

	response=$(curl --max-time 40 --retry 3 --retry-max-time 120 --retry-all-errors -XGET -Lf -sS "https://data.jsdelivr.com/v1/packages/gh/jsdelivr/globalping-probe/resolved")

	# Check if curl succeeded AND returned a non-empty response
	if [ $? == 0 ] && [ -n "$response" ]; then
		echo "Version successfully fetched from jsDelivr API."
		latestVersion=$(jq -r ".version" <<<"${response}" | sed 's/v//')
	else
		echo "Version check failed. Trying using raw.githubusercontent.com..."
		response=$(curl --max-time 40 --retry 3 --retry-max-time 120 --retry-all-errors -XGET -Lf -sS "https://raw.githubusercontent.com/jsdelivr/globalping-probe/refs/heads/master/package.json")

		# Check if the fallback curl succeeded AND returned a non-empty response
		if [ $? == 0 ] && [ -n "$response" ]; then
			echo "Version successfully fetched from GitHub."
			latestVersion=$(jq -r ".version" <<<"${response}" | sed 's/v//')
		else
			echo "Failed to fetch the latest version from all sources. Skipping update."
			return
		fi
	fi

	# Final check to ensure jq parsing yielded a version
	if [ -z "$latestVersion" ] || [ "$latestVersion" == "null" ]; then
		echo "Failed to parse version string from response. Skipping update."
		return
	fi

	if [ -f /app-dev/latest-version.txt ]; then
		latestVersion=$(cat /app-dev/latest-version.txt)
	fi

	latestBundleA="https://cdn.jsdelivr.net/globalping-probe/v$latestVersion/globalping-probe.bundle.tar.gz"
	latestBundleB="https://fastly.jsdelivr.net/globalping-probe/v$latestVersion/globalping-probe.bundle.tar.gz"
	latestBundleC="https://github.com/jsdelivr/globalping-probe/releases/download/v$latestVersion/globalping-probe.bundle.tar.gz"

	currentVersion=$(jq -r ".version" "/app/package.json")

	echo "Current version $currentVersion"
	echo "Latest version $latestVersion"

	# Check if latestVersion is greater than currentVersion
	if [ "$(printf '%s\n' "$latestVersion" "$currentVersion" | sort -V | head -n1)" != "$latestVersion" ]; then
		if [ "$latestVersion" != "$currentVersion" ]; then
			loadedTarball="globalping-probe-${latestVersion}"

			echo "Start self-update process to v$latestVersion"

			curl -XGET -Lf -sS "${latestBundleA}" -o "/tmp/${loadedTarball}.tar.gz"
			
			if [ $? != 0 ]; then
				echo "Failed to fetch the release tarball using cdn.jsdelivr.net. Trying fastly..."
				curl -XGET -Lf -sS "${latestBundleB}" -o "/tmp/${loadedTarball}.tar.gz"

				if [ $? != 0 ]; then
					echo "Failed to fetch the release tarball using fastly.jsdelivr.net. Trying Github..."
					curl -XGET -Lf -sS "${latestBundleC}" -o "/tmp/${loadedTarball}.tar.gz"

					if [ $? != 0 ]; then
						echo "Failed to fetch the release tarball using github.com. All methods failed. Exiting."
						return
					fi
				fi
			fi

			tar -xzf "/tmp/${loadedTarball}.tar.gz" --one-top-level="/tmp/${loadedTarball}"

			if [ $? != 0 ]; then
				echo "Failed to extract the release tarball"
				return
			fi

			# Perform the update
			rm -rf "/app"
			mv "/tmp/${loadedTarball}" "/app"
			cd "/app" || exit

			# Clean up
			rm -rf "/tmp/${loadedTarball}.tar.gz"

			if [ -f /app/bin/patch.sh ]; then
				echo "Running the patch script"
				bash /app/bin/patch.sh
			fi

			echo "Self-update finished"
		fi
	fi
}

try_update
run_probe
