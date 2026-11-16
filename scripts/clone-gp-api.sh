#!/bin/bash

set -euo pipefail
IFS=$'\n\t'

CURRENT_BRANCH=${CURRENT_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}
REPO=https://github.com/jsdelivr/globalping.git

# Use the branch with the same name, then the base branch of the pull request, then master.
for BRANCH in "$CURRENT_BRANCH" ${BASE_BRANCH:-} master; do
	git ls-remote --exit-code --heads "$REPO" "refs/heads/$BRANCH" > /dev/null && break
done

echo "globalping branch: $BRANCH."

# Checkout and sync the branch if the directory exists, otherwise clone the repository
if [ -d "test/e2e/globalping" ]; then
	cd test/e2e/globalping || exit
	git add .
	git reset --hard "@{u}"
	git fetch
	git checkout "$BRANCH"
	git reset --hard "@{u}"
else
	git clone -b "$BRANCH" "$REPO" test/e2e/globalping
	cd test/e2e/globalping || exit
fi

# Install dependencies
npm install

cd ../../../ || exit

# Copy the e2e-api-* files to the globalping API directory
for f in config/e2e-api-*; do
	cp "$f" "test/e2e/globalping/config/${f#config/e2e-api-}"
done
