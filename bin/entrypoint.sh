#!/usr/bin/env bash

update-ca-certificates

function run_probe() {
	exec node /app/dist/index.js
	return
}

function try_update() {
	echo "Checking for the latest probe version..."

	response=$(curl --max-time 40 --retry 3 --retry-max-time 120 --retry-all-errors -XGET -Lf -sS "https://data.jsdelivr.com/v1/packages/gh/jsdelivr/globalping-probe/resolved")

	# Check if curl succeeded AND returned a non-empty response
	if [ $? == 0 ] && [ -n "$response" ]; then
		echo "Probe version successfully fetched from jsDelivr API."
		latestVersion=$(jq -r ".version" <<<"${response}" | sed 's/v//')
	else
		echo "Failed to fetch the version info from jsDelivr API. Trying GitHub API..."
		response=$(curl --max-time 40 --retry 3 --retry-max-time 120 --retry-all-errors -XGET -Lf -sS "https://api.github.com/repos/jsdelivr/globalping-probe/releases/latest")

		# Check if the fallback curl succeeded AND returned a non-empty response
		if [ $? == 0 ] && [ -n "$response" ]; then
			echo "Probe version successfully fetched from GitHub API."
			latestVersion=$(jq -r ".tag_name" <<<"${response}" | sed 's/v//')
		else
			echo "Failed to fetch the version info from GitHub API. All methods failed. Exiting."
			return
		fi
	fi

	# Final check to ensure jq parsing yielded a version
	if [ -z "$latestVersion" ] || [ "$latestVersion" == "null" ]; then
		echo "Failed to parse the version string from the response. Skipping the update."
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

			echo "Starting self-update process to v$latestVersion..."

			curl -XGET -Lf -sS "${latestBundleA}" -o "/tmp/${loadedTarball}.tar.gz"

			if [ $? != 0 ]; then
				echo "Failed to fetch the release tarball from cdn.jsdelivr.net. Trying fastly.jsdelivr.net..."
				curl -XGET -Lf -sS "${latestBundleB}" -o "/tmp/${loadedTarball}.tar.gz"

				if [ $? != 0 ]; then
					echo "Failed to fetch the release tarball from fastly.jsdelivr.net. Trying GitHub..."
					curl -XGET -Lf -sS "${latestBundleC}" -o "/tmp/${loadedTarball}.tar.gz"

					if [ $? != 0 ]; then
						echo "Failed to fetch the release tarball from github.com. All methods failed. Exiting."
						return
					fi
				fi
			fi

			tar -xzf "/tmp/${loadedTarball}.tar.gz" --one-top-level="/tmp/${loadedTarball}"

			if [ $? != 0 ]; then
				echo "Failed to extract the release tarball."
				return
			fi

			# Perform the update
			rm -rf "/app"
			mv "/tmp/${loadedTarball}" "/app"
			cd "/app" || exit

			# Clean up
			rm -rf "/tmp/${loadedTarball}.tar.gz"

			if [ -f /app/bin/patch.sh ]; then
				echo "Running the patch script..."
				bash /app/bin/patch.sh
			fi

			echo "Self-update process completed successfully."
		fi
	fi
}

try_update
run_probe
