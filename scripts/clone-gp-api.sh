#!/bin/bash

set -euo pipefail
IFS=$'\n\t'

CURRENT_BRANCH=${CURRENT_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}

# Checkout and sync the branch if the directory exists, otherwise clone the repository
if [ -d "test/e2e/globalping" ]; then
	cd test/e2e/globalping || exit
	git add .
	git reset --hard "@{u}"
	git fetch
	git checkout "$CURRENT_BRANCH" || git checkout master
	git reset --hard "@{u}"
else
	git clone -b "$CURRENT_BRANCH" https://github.com/jsdelivr/globalping.git test/e2e/globalping || git clone https://github.com/jsdelivr/globalping.git test/e2e/globalping
	cd test/e2e/globalping || exit
fi

# Install dependencies
npm install

cd ../../../ || exit

# Copy the e2e-api-* files to the globalping API directory
for f in config/e2e-api-*; do
	cp "$f" "test/e2e/globalping/config/${f#config/e2e-api-}"
done
