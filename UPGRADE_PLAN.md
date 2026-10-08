# Belt and TypeScript migration status — 2026-10-08

The recommended Types prerequisite and coordinated local integration are complete. Neutrino now uses Belt **0.58.0**, local **Types**, local **Contractor**, and local **cosmos-grpc**. Neutrino now builds with **native TypeScript 7.0.2**, uses the **TS6.0.3 compiler API** for tooling, and retains **TS5.9.3** as the checked consumer floor. Checkout versions are unchanged. Five versioned candidate tarballs have passed the hosted platform matrix and are retained in a draft release asset; no npm package has been published.

## Completed dependency and schema work

- **Types:** declared the production dependencies required by its declarations, upgraded Amino to 0.39, fixed ESM/ts-toolbelt imports, introduced optional-field JSON input types, repaired signature generics/arrays and CwUint53's Rust representation. Removed conflicting ambient declarations. Its source and clean tarball pass TS5.9/6/7 with full declaration checking.
- **Contractor:** consumes local Types and Belt 0.58, compiles with native TS7.0.2, retains the TS6 compiler API for tooling, and now enables full declaration checking. Its clean package passes positive/negative schema inference under TS5.9/6/7 and NodeNext/Bundler. The [audit](../contractor/AUDIT.md) records generator fixes and remaining protocol-conformance work.
- **Neutrino:** uses SchemaObject for in-memory contract arguments, supports optional protobuf transport fields, and validates JSON object response envelopes. SecretContract carries its interface type through wrappers; regression assertions cover query/execute names, args, auth, and response inference. Single-key renamed answers are unwrapped; malformed/ambiguous responses fail explicitly. An execution may still return raw text with an undefined parsed JSON result; missing response tuples fail explicitly.
- **Signing/serialization:** omitted object fields are removed deliberately; undefined/sparse array entries, cycles, nonfinite numbers, bigint, functions and nonplain objects are rejected. Signing sorts keys recursively while preserving array order and existing Amino escaping. A byte-exact fixture checks omitted nested fields and canonical bytes. The implementation handles keys such as constructor and __proto__ without relying on Belt's constructor-based object predicate.
- **Cosmos gRPC:** JsonAny and generated Any-registry signatures explicitly admit optional fields. Both the API source and generator template are patched, and the existing default generated library was recompiled. No schema/profile selection was changed by this integration.
- **Neutrino ambient types:** replaced invalid global redeclarations of Belt codecs with local wrappers whose outputs carry the encoding brands established by those codecs. Removed obsolete test WebSocket polyfills; the supported Node runtime provides WebSocket.

## Development overrides and release candidates

Cosmos gRPC and published Crypto still request Belt 0.57, whose declarations fail full NodeNext resolution. Neutrino's pnpm overrides select Belt 0.58 specifically for those two packages, and route Cosmos gRPC's Types dependency to the local repaired package. These overrides were tested with full source checking, the crypto/signing regressions, and the clean consumer matrix. They are not a universal override for every dependency.

The clean package test packs Types, Contractor, Cosmos gRPC and Neutrino separately and installs them into a fresh production-only npm consumer. It reproduces the same overrides explicitly, with no workspace node_modules symlinks. This validates the coordinated graph; it does **not** imply that publishing Neutrino alone would propagate root-level overrides to consumers. The new release harness goes further: it stages corrected candidate manifests, serves them through a read-only local registry, and verifies that installing only Neutrino resolves the complete coordinated graph without overrides or file links. Third-party versions are frozen in the consumer lockfile. These are local candidate artifacts; apply/version the manifest changes upstream before publication. See [release/README.md](release/README.md).

## Validation

| Scope | Result |
| --- | --- |
| Types source/type assertions | TS5.9, TS6 and native TS7; full declaration checking |
| Types and Contractor clean tarballs | TS5.9/6/7 × NodeNext/Bundler, skipLibCheck false, runtime exports and CLI where applicable |
| Contractor generator/runtime | Six Node test groups; Rust compilation and Serde round trip, including u32/u64, enums and response keys |
| Neutrino source/type assertions | TS5.9, TS6 and native TS7; skipLibCheck false |
| Neutrino offline suite | 44 passing tests on Node 22.12 and 26.10; the native TS7-emitted suite also passes on Node 22.12 |
| Compiler/tooling migration | TS5.9/6/7 emit identical JavaScript and equivalent declaration syntax; TypeDoc and ESLint use the TS6.0.3 API |
| Coordinated Neutrino clean tarball | ESM/require(esm), TS5.9/6/7 × NodeNext/Bundler, full declaration checking and negative inference tests |
| Browser compilation | Browser ESM bundle succeeds (540,362 bytes unminified in the original build; not a benchmark) |
| Candidate dependency graph | Five exact candidate versions, one Belt 0.58, no overrides/file links, locked third-party dependencies; clean production-only install from a loopback registry |
| Candidate runtime/declarations | All 44 offline tests on Node 22.12/26, ESM/require(esm), TS5.9/6/7 × NodeNext/Bundler |
| Real browser runtime | Chromium, Firefox and WebKit: crypto vectors, authentication failure, exact fees and real WebSocket event/deadline checks |
| Cosmos gRPC regressions | 52 passing tests after the API/generator adjustment |
| Dependency advisories | Zero known advisories in the final Types, Contractor and Neutrino lockfile scans |

Runtime checks ran on macOS arm64 with Node 22.12.0 and 26.10.0, plus the installed Rust toolchain. The clean package matrix also passes on Node 22.12. The subsequent format-2 candidate also passes hosted macOS/Linux/Windows × Node 22.12/24. Broader application-browser coverage and live chain execution remain release gates. TypeScript interfaces are erased: response object-envelope checks do not validate every contract-specific field. No live or funded transactions were sent.

## Completed: Neutrino compiler adoption

Build and typecheck scripts explicitly invoke `node_modules/@typescript/native/bin/tsc` (7.0.2). This avoids the `tsc` executable collision with the retained `typescript59` alias. Package-consumer tests now use Neutrino's own three compiler installations instead of borrowing compilers from the Types sibling.

```json
{
  "typescript": "npm:@typescript/typescript6@6.0.2",
  "@typescript/native": "npm:typescript@7.0.2",
  "typescript59": "npm:typescript@5.9.3"
}
```

The TS6 wrapper package is 6.0.2, but its underlying `@typescript/old` dependency resolves to **TypeScript 6.0.3** in the lockfile. `typecheck:compat`, TypeDoc and ESLint use that API. Peer auto-installation is disabled to prevent an unintended extra compiler from satisfying tool peers. Frozen-lockfile installs preserve the tested graph.

Repeatable gates:

- `pnpm typecheck`, `pnpm typecheck:compat`, `pnpm typecheck:floor`: full source/type assertions with TS7, TS6 and TS5.9 respectively.
- `pnpm test:toolchain`: compares all three compilers' emitted JavaScript byte-for-byte and declaration syntax trees with only trivia/string quote normalization; verifies TypeDoc/parser API resolution; generates API JSON and checks key exports; bundles the native build for browsers. Source-map equality is not asserted.
- `pnpm test:all`: the 44 offline tests with tsx. Discovery uses Node rather than shell wildcard expansion.
- `pnpm test:compiled`: compiles the source and tests with TS7, then runs the same 44 tests as native ESM without a loader. This uncovered extensionless imports in legacy tests, now repaired. Live examples are compiled but never executed by this runner.
- `pnpm test:package`: native build followed by coordinated clean tarballs, ESM/require(esm) and TS5.9/6/7 NodeNext/Bundler consumers.
- `pnpm lint` and `pnpm docs`: tooling on the TS6 API. ESLint passes with 52 existing warnings; TypeDoc generation passes with 30 documentation warnings (stale parameter names, missing/external links and the local remote). Those warnings remain documentation debt.

The runtime floor remains Node **22.12**. ESLint 10 requires **22.13+** on Node 22, or Node **24+**; use a supported development runtime rather than changing the library's runtime floor for dev-only tooling. The native compiler package declares binaries for macOS/Linux/Windows architectures; the hosted candidate consumers execute it on macOS arm64, Linux x64 and Windows x64. The minimum-runtime binary was downloaded from nodejs.org and checked against its published SHA-256 checksum.

## Completed: candidate graph and platform workflow

`release/plan.json` proposes Types 0.4.0-rc.0, Crypto 0.6.3-rc.0, Contractor 0.12.0-rc.0, Cosmos gRPC 0.21.0-rc.0 and Neutrino 2.0.0-rc.0. Staging rebuilds the three TS7 packages and consumes a freshly regenerated default Cosmos library. Crypto comes from its integrity-pinned published 0.6.2 artifact with only dependency metadata changed; the separate local Crypto/WASM development state is excluded.

`release:prepare` creates a checksum manifest, five tarballs, compiled offline fixtures and a frozen consumer lockfile. `test:release` installs only Neutrino as a runtime dependency through a read-only loopback registry. It confirms all five candidate manifests, one Belt version, production-only exports/declarations, and the 44 tests against installed artifacts. Subsequent installs use the frozen lockfile; there are no consumer overrides or file links. Both Node 22.12 and 26 pass on macOS arm64. The npm launcher now invokes `npm-cli.js` through the current Node binary, avoiding Windows shell shims in this new harness.

The same installed candidate passes targeted runtime checks in Chromium, Firefox and WebKit. The candidate dependency graph and isolated validation tools each report zero known advisories. Contractor Rust CLI generation and Cosmos timestamp/bank/oneof regressions also pass in the production consumer. Integrity tests reject changed bundle bytes and paths outside the bundle.

`.github/workflows/release-candidate.yml` defines macOS/Linux/Windows × Node 22.12/24, with the three browser engines on Linux/24. It accepts an HTTPS manifest URL and an independently supplied SHA-256, verifies all artifact bytes, and needs no moving sibling checkouts. The workflow passed all six consumers on the validation branch on 2026-10-08, including three browser engines on Linux/Node 24. See [release/README.md](release/README.md) for commands, candidate version rationale and release steps.

## Next: protocol qualification and release preparation

The candidate was rebuilt from clean committed source, reviewed iteratively by a subagent, uploaded as a checksum-pinned draft asset and validated in [hosted run 37742287060](https://github.com/SolarRepublic/neutrino/actions/runs/37742287060). See the format-2 record in [release/README.md](release/README.md) for exact source, validator and artifact identities. No npm package was published or branch merged. Independent Secret/Go fixtures and live-testnet qualification remain the highest release priority; then apply/version the coordinated upstream manifests and validate public-registry consumers before promotion.

[TypeScript 6 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html) explain the configuration transition. Compiler versions, tool peer ranges and native binary targets were checked against installed metadata. Source configurations explicitly select Node/Web ambient types and avoid baseUrl.

## Release order

1. Assign and publish a distinct Types version with the corrected declaration dependencies and JSON input model.
2. Update/version Contractor against that Types release. Update Cosmos gRPC/Crypto dependency manifests for the tested Belt version, retaining the JsonAny generator correction.
3. Replace Neutrino's three local file links with the corresponding distinct releases and remove temporary overrides. Run the clean package matrix again without injected sibling tarballs/overrides.
4. Document the stricter JSON boundary behavior, corrected response tuple optionality and Node >=22.12 support. Repeat minimum-Node validation against that release graph and perform platform/browser/live testnet validation before a Neutrino release.

## Remaining product work after this pass

- Add sequence coordination per signer and recovery based on observed inclusion, never automatic re-signing after an ambiguous outcome.
- Add contract/consensus-key cache invalidation, refresh and request coalescing.
- Expand mixed-message response/nonce fixtures and full contract-response validation; query tuple optionality and missing envelope handling are already repaired.
- Add durable SNIP-52 reconnect cursors/backfill and seed-rotation handling. Current duplicate retention is bounded to 1,024 transaction identities; it cannot recover events missed offline. Bound queued event work and define slow-listener behavior before treating this as a durable stream.
- Expand external Secret/Go transaction fixtures, broader application-browser coverage and independent crypto qualification. Minimum-Node and targeted browser candidate CI now pass. Differential tests are useful regression evidence, not a formal cryptographic audit.


## Review hardening — 2026-10-08

Subagent review identified and prompted fixes for execution of fixtures outside the hash-verified manifest, portable fixture hashing, missing validator/generator provenance, combined npm stderr/JSON output, and stale pnpm file copies. Format-2 bundles require clean committed source, regenerate Cosmos from hashed default proto inputs, refresh and compare local build dependencies, and bind the exact validation scripts and fixture inventory. Downloads enforce HTTPS through redirects and bounded sizes. The workflow pins Actions revisions, runs integrity regressions and records validator/candidate identities. A dedicated validation branch can fetch a checksum-pinned draft release bundle without publishing packages or updating main. The subsequent hosted matrix passed; the release guide records exact identities, platform versions and the resolved draft-token/archive transport failures.
