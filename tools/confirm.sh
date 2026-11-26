#!/bin/bash

# Asks the release manager to confirm before cog commits, tags, and pushes.
# Set RELEASE_YES=1 to skip the prompt.

if [ "${RELEASE_YES:-}" = 1 ]; then
    exit 0
fi

read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
fi
