#!/bin/bash

# Bumps a package's version, commits and tags it, and pushes the tag and main
# together. The tag push starts .github/workflows/release.yml, which builds and
# publishes the package. See RELEASE.md.
#
# Needs cocogitto (cog) 7 or later, and node and npm on the PATH.

set -o errexit
set -o nounset
set -o pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PACKAGES="gigaplot deephaven-plugin-gigaplot"

function usage() {
    cat <<EOF
Usage: $(basename "$0") <package> [options]

Packages:
  gigaplot                    the gigaplot npm package
  deephaven-plugin-gigaplot   the plugin's Python package, which bundles its JS

Options:
  --version <X.Y.Z>     release this version instead of computing it from the commits
  --major | --minor | --patch
                        bump this part of the version instead of computing it
  --remote <name>       git remote to push main and the tag to (default: origin)
  --dry-run             print the version that would be released, and stop
  --yes                 do not ask for confirmation
  --help                print this message
EOF
}

function fail() {
    echo -e "\033[31mError: $*\033[0m" >&2
    exit 1
}

package=
bump=(--auto)
remote=origin
dry_run=false
while (( $# > 0 )); do
    case "$1" in
        --version)
            (( $# > 1 )) || fail "--version needs a value"
            bump=(--version "${2#v}")
            shift
            ;;
        --major | --minor | --patch) bump=("$1") ;;
        --remote)
            (( $# > 1 )) || fail "--remote needs a value"
            remote="$2"
            shift
            ;;
        --dry-run) dry_run=true ;;
        --yes) export RELEASE_YES=1 ;;
        --help | -h) usage; exit 0 ;;
        -*) usage >&2; fail "Unknown option $1" ;;
        *)
            [ -z "$package" ] || fail "Release one package at a time, got '$package' and '$1'"
            package="$1"
            ;;
    esac
    shift
done

if [ -z "$package" ]; then
    usage >&2
    exit 2
fi
[[ " $PACKAGES " == *" $package "* ]] || fail "Unknown package '$package'. Expected one of: $PACKAGES"

for tool in cog git node npm; do
    command -v "$tool" >/dev/null || fail "$tool is not on the PATH. See RELEASE.md for the prerequisites."
done

# cog 7 moved monorepo packages to [monorepo.packages], which older versions ignore
cog_version="$(cog --version | awk '{print $2}')"
(( ${cog_version%%.*} >= 7 )) || fail "cog $cog_version is too old. Install cocogitto 7 or later, see RELEASE.md."

git remote get-url "$remote" >/dev/null 2>&1 || fail "There is no git remote named '$remote'. Pass one with --remote."

if [ -n "$(git status --porcelain)" ]; then
    git status --short >&2
    fail "The working tree has uncommitted changes. Commit or stash them first."
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = main ] || fail "Releases are cut from main, but you are on '$branch'."

# cog tags HEAD and the hooks push main, so HEAD must be exactly the remote's main
git fetch --quiet "$remote" main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse FETCH_HEAD)" ]; then
    if git merge-base --is-ancestor HEAD FETCH_HEAD; then
        fail "Local main is behind $remote/main. Run: git pull --ff-only $remote main"
    fi
    git --no-pager log --oneline FETCH_HEAD..HEAD >&2
    fail "Local main has commits that are not on $remote/main."
fi
# cog reads the latest release from local tags
git fetch --quiet --tags "$remote"

# A dry run prints the tag cog would create. When there is nothing to release,
# cog explains why and, depending on the case, exits with 0 or 1.
nothing_to_release="If there are no feat or fix commits since the last release, pass --patch, --minor, --major, or --version to release anyway."
plan="$(cog bump --package "$package" "${bump[@]}" --dry-run)" || fail "cog cannot bump $package. $nothing_to_release"
tag="$(grep -E "^$package-v[0-9]+\.[0-9]+\.[0-9]+$" <<< "$plan" || true)"
if [ -z "$tag" ]; then
    echo "$plan" >&2
    fail "There is nothing to release for $package. $nothing_to_release"
fi

if [ "$dry_run" = true ]; then
    echo "Would release $tag"
    exit 0
fi

echo "Releasing $tag from $(git --no-pager log -1 --format='%h %s')"
echo "Pushing main and the tag to $remote ($(git remote get-url --push "$remote"))"
RELEASE_REMOTE="$remote" cog bump --package "$package" "${bump[@]}"

git ls-remote --exit-code --tags "$remote" "refs/tags/$tag" >/dev/null || fail "$tag did not reach $remote. See RELEASE.md to recover."

echo
echo "Pushed $tag. Follow the release at"
echo "https://github.com/mofojed/gigaplot/actions/workflows/release.yml"
