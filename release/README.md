# Coordinated release candidates

This prepares reviewable tarballs and validates the dependency graph before any public release. It does not publish, tag, change checkout versions, or edit the sibling repositories' dependency manifests. The working checkouts retain their local development links.

## Candidate versions

| Package | Candidate | Release changes |
| --- | --- | --- |
| Types | 0.4.0-rc.0 | Declaration dependencies/ESM imports, optional JSON inputs, signature types and CwUint53 correction |
| Crypto | 0.6.3-rc.0 | Published 0.6.2 implementation, unchanged; Belt dependency becomes 0.58.0 |
| Contractor | 0.12.0-rc.0 | Schema/generator/runtime repairs, TS7 build, updated Types and Belt |
| Cosmos gRPC | 0.21.0-rc.0 | Current default generated schema/API, optional JsonAny fields, updated Types/Crypto/Belt |
| Neutrino | 2.0.0-rc.0 | Audited runtime changes, stricter JSON boundaries, ESM/Node 22.12 floor, updated sibling dependencies |

`plan.json` is the source of these proposed versions. The tarballs replace every coordinated dependency with its exact candidate version and use Belt 0.58.0. They contain no file links, pnpm overrides or development tooling. All candidate publish tags are `next`; publication is a separate action after validation and review.

Crypto is intentionally staged from its checksum-pinned published 0.6.2 tarball. The local Crypto checkout contains separate generated/WASM development state and is not the source of this candidate. Its JavaScript and declarations remain unchanged; only package metadata changes.

## Prepare and validate locally

First install the sibling development graph as described in `../UPGRADE_PLAN.md`, then commit all four source repositories. Cosmos requires its default merged proto input (`build/proto`) and installed generator tools. Preparation regenerates its default library and records hashes of the actual proto input, generator source/scripts, lockfile and submodule revisions.

Then, from Neutrino, on Node 24+:

```sh
npm ci --prefix release/tools --ignore-scripts --no-audit --no-fund
node release/prepare.mjs dist/release-candidate
node release/tools/node_modules/playwright/cli.js install chromium firefox webkit
node release/verify.mjs dist/release-candidate --browser
node --test release/integrity.test.mjs
```

Preparation requires a new output directory and registry access. It regenerates Cosmos, rebuilds Types, Contractor and Neutrino, stages all five manifests, then tests the graph and freezes `consumer-lock.json`. It requires clean committed source and records Git heads plus input artifact hashes. Before compiling a dependent package it refreshes local pnpm file snapshots and verifies their output hashes match the freshly built siblings. Set `RELEASE_PNPM_STORE` when using a nondefault pnpm store. The preserved merged proto input is hashed explicitly; it is not inferred from Git HEAD or silently replaced with a different schema profile.

The verifier serves only the candidate versions through a read-only loopback registry; public dependencies resolve from npm. The consumer requests **only Neutrino** as its runtime dependency. It checks exact installed manifests, one Belt version, ESM/require(esm), Contractor runtime/CLI generation, Cosmos protobuf regressions, all three compiler consumers with full declaration checking, and the 44 offline tests against the installed tarball files. Test-only dependencies are installed after production checks. Subsequent runs use `npm ci` against the frozen consumer lock, with only the fixture registry origin rewritten for its ephemeral port. The locked toolchain and validation scripts must match the prepared format-2 bundle. Its file inventory is exact: unlisted files, missing inference fixtures, symlinks and nonportable paths fail validation. Test execution uses only its signed test list. HTTPS fetches enforce HTTPS redirects and per-file size limits.

`--browser` additionally checks the installed bundle in Chromium, Firefox and WebKit: AES-SIV's RFC vector and tamper rejection, X25519 and RIPEMD-160 vectors, exact fee arithmetic, and a real loopback WebSocket's event delivery and acknowledgement timeout. It neither contacts a chain nor sends transactions. These are targeted interoperability regressions, not full browser/application coverage or cryptographic qualification.

The npm launcher uses the active Node executable and resolves `npm-cli.js` directly, avoiding Windows `.cmd` shell invocation. If npm has a nonstandard layout, set `NPM_CLI_JS` explicitly. Compilers use their explicit alias paths.

## Platform workflow

`.github/workflows/release-candidate.yml` is manually dispatched. Host the **entire prepared directory** at an HTTPS artifact location, then supply its `manifest.json` URL and the SHA-256 printed by preparation. The workflow verifies that manifest hash and every contained file hash before testing. Its six jobs cover macOS/Linux/Windows × Node 22.12/24; Linux/Node 24 also runs all three browser engines. It needs no sibling checkouts or publishing credentials, and retains no checkout credentials.

A dedicated `codex/release-validation` branch can also run the matrix by pushing `release/candidate.json`. That pointer identifies a draft GitHub release asset and pins both archive and manifest SHA-256 hashes; `fetch-draft.mjs` downloads using the job token only in that step. It does not publish an npm package or merge the branch. Archives use explicit top-level member names (no leading `./`); links and special entries are rejected before extraction. `.gitattributes` fixes LF endings for hashed validation files on every platform. Actions are pinned to commit SHAs; jobs run harness regression tests and record validator/candidate identities.

The workflow has not yet been dispatched from this local checkout. Uploading the artifact and running it in the repository are separate steps; do not claim those platform gates passed from the local macOS checks. A local candidate directory and its manifest hash identify exactly what was tested even while sibling changes remain uncommitted.

References: [Playwright browser installation](https://playwright.dev/docs/browsers), [setup-node matrix usage](https://github.com/actions/setup-node#matrix-testing).

## Before publication

1. Review/version the sibling changes, apply the candidate manifest dependency changes upstream, and retain the default Cosmos schema used here. Commit source and generator inputs; record their immutable revisions.
2. Pass the platform workflow, inspect existing lint/documentation warnings, and complete the separate live testnet/independent crypto qualification gates in the audit.
3. Publish the exact validated candidates in dependency order: Types and Crypto, Contractor and Cosmos gRPC, then Neutrino, using the `next` tag. Recheck registry consumers without the loopback registry before promoting any version.
4. Replace local development links/overrides with approved release versions in the release branches and rebuild/retest. Public stable version/tag choices require release review; the local candidate versions do not reserve registry names.


## Local validation record — 2026-10-07

The prepared bundle is `dist/release-candidate` (approximately 5.2 MiB). Its manifest SHA-256 is `0c30c2a6bcc8a166a55628653b243ec435fa70beb1f2d45059018cbdf8ce4924`.

- Frozen production graph, all six compiler/resolution combinations, and 44 installed-package tests pass on macOS arm64, Node 22.12.0 and 26.10.0.
- Final Node 22.12 verification also passes Contractor Rust CLI generation and Cosmos timestamp/bank/oneof checks, plus Chromium/Firefox/WebKit runtime checks.
- Cosmos regeneration succeeds and its 52 regressions pass. Candidate dependency and validation-tool audits each report zero known advisories.
- Six integrity/download/subprocess regression tests pass; the six-job workflow parses successfully but has not been dispatched. Linux/Windows remain untested.

This record identifies the existing immutable candidate snapshot. Later documentation edits do not change that snapshot; prepare a new output directory to include subsequent source or documentation changes.
