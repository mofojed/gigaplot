#!/bin/bash

# Sets or checks the version of a releasable package in every file that holds it.
# The release hooks in cog.toml call this, and so does the release workflow with
# --check. You should not need to run it by hand.
#
#   update_version.sh <package> <version>          set the release version
#   update_version.sh <package> <version> --dev    set the in-development version
#   update_version.sh <package> <version> --check  fail unless the files hold <version>

set -o errexit
set -o nounset
set -o pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PACKAGES="gigaplot deephaven-plugin-gigaplot"
PLUGIN_SETUP_CFG="deephaven-plugin-gigaplot/setup.cfg"

function usage() {
    echo "Usage: $(basename "$0") <package> <version> [--dev | --check]"
    echo "Packages: $PACKAGES"
}

package=
version=
mode="set"
while (( $# > 0 )); do
    case "$1" in
        --dev) mode=dev ;;
        --check) mode=check ;;
        --help | -h) usage; exit 0 ;;
        -*) echo "Unknown option $1" >&2; usage >&2; exit 2 ;;
        *)
            if [ -z "$package" ]; then
                package="$1"
            elif [ -z "$version" ]; then
                version="${1#v}"
            else
                echo "Unexpected argument $1" >&2; usage >&2; exit 2
            fi
            ;;
    esac
    shift
done

if [ -z "$package" ] || [ -z "$version" ]; then
    usage >&2
    exit 2
fi

# npm and PEP 440 spell pre-releases differently, so only plain versions keep the JS and Python packages in step
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Version '$version' must be MAJOR.MINOR.PATCH" >&2
    exit 2
fi

function npm_version() {
    node -p "require('./$1/package.json').version"
}

function set_npm_version() {
    npm version "$version" --workspace="$1" --no-git-tag-version --no-workspaces-update --allow-same-version >/dev/null
    # Sync package-lock.json without reinstalling the workspace
    npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null
}

function python_version() {
    sed -n -E 's/^version = (.*)$/\1/p' "$PLUGIN_SETUP_CFG"
}

function set_python_version() {
    # Write through a temp file, since sed -i differs between GNU and BSD
    sed -E "s/^version = .*/version = $1/" "$PLUGIN_SETUP_CFG" > "$PLUGIN_SETUP_CFG.tmp"
    mv "$PLUGIN_SETUP_CFG.tmp" "$PLUGIN_SETUP_CFG"
}

mismatches=0
function check() {
    local file="$1" actual="$2"
    if [ "$actual" != "$version" ]; then
        echo "$file has version '$actual', expected '$version'" >&2
        mismatches=$((mismatches + 1))
    fi
}

case "$package" in
    gigaplot)
        case "$mode" in
            set) set_npm_version packages/gigaplot ;;
            dev) ;; # No Python package, so nothing marks development builds
            check) check packages/gigaplot/package.json "$(npm_version packages/gigaplot)" ;;
        esac
        ;;
    deephaven-plugin-gigaplot)
        case "$mode" in
            set)
                set_npm_version deephaven-plugin-gigaplot/src/js
                set_python_version "$version"
                ;;
            dev) set_python_version "$version.dev0" ;;
            check)
                check deephaven-plugin-gigaplot/src/js/package.json "$(npm_version deephaven-plugin-gigaplot/src/js)"
                check "$PLUGIN_SETUP_CFG" "$(python_version)"
                ;;
        esac
        ;;
    *)
        echo "Unknown package '$package'" >&2
        usage >&2
        exit 2
        ;;
esac

if (( mismatches > 0 )); then
    exit 1
fi
if [ "$mode" = check ]; then
    echo "$package versions match $version"
fi
