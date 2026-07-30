# R7 Repository Rules

Use this file for R7 workspaces, especially `sdkjs`, `web-apps`, and `desktop-apps`.

## Roots

`C:\work\R7\main\projects` is an aggregate workspace, not the authoritative root for all analysis.

Many second-level folders under `projects` are Windows junctions:

- `projects\sdkjs\...` -> `C:\work\R7\main\sdkjs\...`
- `projects\web-apps\...` -> `C:\work\R7\main\web-apps\...`
- `projects\desktop-apps\...` -> `C:\work\R7\main\desktop-apps\...`

Use the real worktree roots for GitNexus, tests, file paths, and source edits:

- `C:\work\R7\main\sdkjs`
- `C:\work\R7\main\web-apps`
- `C:\work\R7\main\desktop-apps`

## GitNexus Scope

- Prefer explicit repos `sdkjs`, `web-apps`, and `desktop-apps`.
- Use exact repo names reported by `list_repos`.
- Record index freshness, branch, commit, and warnings.
- If a GitNexus tool supports `worktree`, pass the real worktree path for linked/junction workspaces.

## Search Scope

- Start with source and tests.
- Keep generated, vendor, cache, `node_modules`, sourcemaps, minified bundles, help/locales, and compiled bundles separate from source evidence.
- If file search follows junctions from `projects`, record that linked directories were followed.
- Load `search-noise-profiles.json` for neutral exclusion profiles.
