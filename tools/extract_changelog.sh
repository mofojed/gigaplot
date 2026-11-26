#!/bin/bash

# Prints the newest release section of a cog CHANGELOG.md, for the GitHub release notes.
# cog separates releases with "- - -" lines.

set -o errexit
set -o nounset

if [ ! -f "${1:-}" ]; then
    echo "Usage: $(basename "$0") <CHANGELOG.md>" >&2
    exit 2
fi

awk '
    $0 == "- - -" { separators++; if (separators == 2) exit; next }
    separators == 1 { print }
' "$1"
