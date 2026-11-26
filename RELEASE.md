# Releasing

This repository publishes three packages from two release tags:

| Package                                                                                | Registry | Source                             | Tag                                    |
| -------------------------------------------------------------------------------------- | -------- | ---------------------------------- | -------------------------------------- |
| [`gigaplot`](https://www.npmjs.com/package/gigaplot)                                   | npm      | `packages/gigaplot`                | `gigaplot-v<version>`                  |
| [`deephaven-plugin-gigaplot`](https://www.npmjs.com/package/deephaven-plugin-gigaplot) | npm      | `deephaven-plugin-gigaplot/src/js` | `deephaven-plugin-gigaplot-v<version>` |
| [`deephaven_plugin_gigaplot`](https://pypi.org/project/deephaven-plugin-gigaplot/)     | PyPI     | `deephaven-plugin-gigaplot`        | `deephaven-plugin-gigaplot-v<version>` |

- `gigaplot` is versioned on its own and knows nothing about Deephaven.
- The plugin's npm and Python packages always share a version and are released
  together from one tag. The plugin bundles the gigaplot source, so it does not
  depend on a published `gigaplot`, and a gigaplot fix also counts as a change
  to the plugin.

Publishing uses [trusted publishing](https://docs.pypi.org/trusted-publishers/)
on both registries. The release workflow gets short-lived credentials from
GitHub's OIDC token, so the repository holds no npm or PyPI tokens. npm adds
[provenance](https://docs.npmjs.com/generating-provenance-statements)
automatically, and PyPI adds attestations.

## How a release works

1. [`tools/release.sh`](tools/release.sh) checks that you are on an up to date
   `main` with a clean working tree. It then runs
   [cocogitto](https://docs.cocogitto.io/) (`cog bump`), configured in
   [`cog.toml`](cog.toml), which:
   - works out the next version from the
     [Conventional Commits](https://www.conventionalcommits.org/) that touched
     the package since its last tag: `fix` bumps the patch version, and `feat`
     the minor version. A breaking change (`!` or `BREAKING CHANGE:`) bumps
     the major version, or the minor version while the version is 0.x.
   - writes the version into the package files with
     [`tools/update_version.sh`](tools/update_version.sh), and the new
     section of the package's `CHANGELOG.md`.
   - commits the result as `chore(version): <package>-v<version>` and tags
     that commit.
   - for the plugin, commits the Python version as `<version>.dev0` on `main`,
     so wheels built between releases are not mistaken for the release.
   - pushes `main` and the tag together with `git push --atomic`.
2. The tag push starts the [Release workflow](.github/workflows/release.yml),
   which:
   - checks that the versions in the package files match the tag.
   - runs the unit tests and type checks, and builds the npm tarball (and, for
     the plugin, the wheel and sdist).
   - publishes to npm, and for the plugin also to PyPI. These jobs run in the
     `release` environment.
   - creates a GitHub release named after the tag, with the changelog section
     as its notes and the packages attached.

## Prerequisites

To run a release you need:

- Push access to `main` and permission to create tags. If `main` requires pull
  requests, you need to be allowed to bypass that rule, since the release
  commits are pushed directly.
- [cocogitto](https://github.com/cocogitto/cocogitto#installation) 7 or later
  on your `PATH`, such as with `cargo install cocogitto --locked` or
  `brew install cocogitto`. cog 6 reads a different `cog.toml` layout, and
  `tools/release.sh` refuses to run with it.
- Node.js 24 and npm, as for development.

## One-time setup

Do these steps before the first release. Steps 1 to 3 can be done at any
time. Step 4 starts a 48 hour window that the first release must fall in, so
do it right before [the initial release](#initial-release).

### 1. Create the `release` environment

In the repository's **Settings > Environments**, create an environment named
`release`. The registries trust only jobs in this environment. Recommended
settings:

- **Deployment branches and tags**: choose **Selected branches and tags**, and
  add the tag rules `gigaplot-v*` and `deephaven-plugin-gigaplot-v*`.
- **Required reviewers**: add yourself to approve each publish by hand.
  Optional.

Also consider a tag ruleset (**Settings > Rules > Rulesets**) that limits who
can create tags matching those patterns, since pushing a tag publishes.

### 2. Add the pending publisher on PyPI

PyPI can trust a workflow before the project exists. Signed in to
[PyPI](https://pypi.org/), open
[**Your projects > Publishing**](https://pypi.org/manage/account/publishing/)
and add a pending GitHub publisher:

| Field             | Value                       |
| ----------------- | --------------------------- |
| PyPI project name | `deephaven-plugin-gigaplot` |
| Owner             | `mofojed`                   |
| Repository name   | `gigaplot`                  |
| Workflow name     | `release.yml`               |
| Environment name  | `release`                   |

The first publish creates the project and turns the pending publisher into a
regular one.

### 3. Check the build

Once this tooling is on `main`, build both packages without publishing:

```bash
gh workflow run release.yml -f package=gigaplot
gh workflow run release.yml -f package=deephaven-plugin-gigaplot
```

Run by hand, the workflow tests and builds the package and uploads it as an
artifact, but skips publishing. Download the artifact to check what would be
published.

### 4. Create the npm packages and their trusted publishers

Unlike PyPI, npm can only trust a workflow for a package that already exists,
so each npm package needs one publish by hand first. The current `0.0.1`
versions serve as that placeholder. From a clean, up to date `main`, signed in
with `npm login` and with two-factor authentication on your account:

```bash
npm ci
npm run build -w gigaplot
npm publish -w gigaplot
npm run build -w deephaven-plugin-gigaplot
npm publish -w deephaven-plugin-gigaplot
```

Then trust the release workflow to publish them. With npm 11.15 or later:

```bash
npm trust github gigaplot --file release.yml --repo mofojed/gigaplot --env release --allow-publish
npm trust github deephaven-plugin-gigaplot --file release.yml --repo mofojed/gigaplot --env release --allow-publish
```

Or, on [npmjs.com](https://www.npmjs.com/), open each package's **Settings >
Trusted publishing**, choose **GitHub Actions**, and enter owner `mofojed`,
repository `gigaplot`, workflow `release.yml`, and environment `release`.
Allow `npm publish` as well as `npm stage publish`, since the workflow
publishes directly.

npm does not check these settings when you save them, and a new trusted
publisher expires unless it publishes within 48 hours. Run the initial release
next.

## Initial release

1. Merge a pull request that drops the "not published yet" notes from
   [README.md](README.md), [packages/gigaplot/README.md](packages/gigaplot/README.md),
   and [deephaven-plugin-gigaplot/README.md](deephaven-plugin-gigaplot/README.md),
   and documents `npm install gigaplot` and
   `pip install deephaven-plugin-gigaplot`.
2. Release both packages as `0.1.0`. There is no earlier tag to bump from,
   so give the version explicitly:

   ```bash
   git checkout main && git pull --ff-only
   tools/release.sh gigaplot --version 0.1.0
   tools/release.sh deephaven-plugin-gigaplot --version 0.1.0
   ```

3. Watch both runs of the
   [Release workflow](https://github.com/mofojed/gigaplot/actions/workflows/release.yml),
   and approve the `release` environment if you added reviewers. Check that
   `0.1.0` is on npm for both packages and on PyPI, and that both GitHub
   releases exist.
4. Retire the placeholders:

   ```bash
   npm deprecate gigaplot@0.0.1 "Placeholder for setting up publishing. Use 0.1.0 or later."
   npm deprecate deephaven-plugin-gigaplot@0.0.1 "Placeholder for setting up publishing. Use 0.1.0 or later."
   ```

5. On npmjs.com, set each package's **Settings > Publishing access** to
   **Require two-factor authentication and disallow tokens**. Trusted
   publishing keeps working, and nothing else can publish without your second
   factor.

## Releasing a new version

1. Check what would be released:

   ```bash
   git checkout main && git pull --ff-only
   tools/release.sh gigaplot --dry-run
   tools/release.sh deephaven-plugin-gigaplot --dry-run
   ```

   The version comes from the commits since the package's last tag. If there
   are no `feat` or `fix` commits for a package, there is nothing to release.

2. Release:

   ```bash
   tools/release.sh <package>
   ```

   The script shows the old and new versions and asks before it commits and
   pushes. To choose the version yourself, pass `--patch`, `--minor`,
   `--major`, or `--version <X.Y.Z>`. Pass `--remote <name>` if the
   repository's remote is not `origin`.

3. Follow the
   [Release workflow](https://github.com/mofojed/gigaplot/actions/workflows/release.yml)
   until the GitHub release appears.

A gigaplot fix usually means releasing both packages, gigaplot for npm users
and the plugin to ship the fix to Deephaven. Release them one after the other.

Versions are plain `MAJOR.MINOR.PATCH`. npm and PyPI write pre-release
versions differently, so pre-releases are not supported.

## When something goes wrong

- **`tools/release.sh` stopped before pushing.** Nothing left your machine.
  Drop the local commits and tag, fix the problem, and run it again:

  ```bash
  git tag -d <package>-v<version>
  git reset --hard origin/main
  ```

- **The push was rejected**, usually because `main` moved. Reset as above,
  pull, and run the release again.
- **A publish job failed** on something outside the code, such as an outage or
  a trusted publisher setting. Fix the cause and use **Re-run failed jobs** on
  the run. The publish steps skip versions that are already on the registry,
  so re-running after a partial publish is safe.
- **npm says `ENEEDAUTH` or "Unable to authenticate".** The package's trusted
  publisher does not match the run. Check that the owner, repository,
  workflow (`release.yml`), and environment (`release`) are exact, and that
  `npm publish` is allowed. A trusted publisher that has not published within
  48 hours of being created expires. Delete it and add it again.
- **The build or tests failed on the tag.** Fix the problem on `main` and
  release the next version. The failed version was never published, and only
  its tag and changelog entry remain.
- **A bad version was published.** Release a fixed version. On PyPI, also
  [yank](https://pypi.org/help/#yanked) the bad one. On npm, `npm deprecate`
  it, since npm only allows unpublishing within 72 hours and never reuses a
  version number.
