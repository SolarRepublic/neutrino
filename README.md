<p>
  <a href="https://starshell.net/">
    <img src="https://github.com/SolarRepublic/neutrino/assets/1456400/9f854305-a47a-4074-a5d0-bab5ac4b3764" alt="Neutrino logo" width="144">
  </a>
</p>


# Neutrino

An ultra-lightweight Secret Network client and wallet for the Web.

Engineered to produce the smallest possible javascript bundle sizes after gzip, with even greater savings when tree-shaking is used.

### Description

The goal of this project is to provide the necessary tools to run a self-contained Secret Web dApp and an optionally embedded hot wallet. Users are able to:
 - query the Secret Network chain
 - construct and broadcast transactions to the chain
 - query and execute Secret Contracts
 - sign and verify Secp256k1 messages (to enable hot hot wallets)

Consequently, the following prerequisite tools are also available to users:
 - Bech32 encoding/decoding
 - Curve25519 scalar multiplication
 - RIPEMD-160 hashing
 - Secp256k1 key generation, signing/verification, and ECDH
 - AES-128-SIV encryption/decryption
 - Schema-less Protobuf reading/writing

Additionally, some dApp-enhancing features are also included:
 - ChaCha20 + Poly1305 AEAD
 - SNIP-52 WebSocket notification client


### API Usage

Tuples (EC Arrays `[]`) are used in places you might normally expect a named struct, such as return values. Similarly, virtually all functions opt for ordered parameters instead of named structs.

This practice allows for much smaller bundle sizes, but comes at the cost of less destructuring verbosity. However, a TypeScript IDE should make this drawback neglible since types and documentation explain every parameter and return value.


### Examples

Basic SNIP-20 example:

```ts
import type {Snip20} from '@solar-republic/contractor';
import {CosmosSigner, SecretContract, SecretApp} from '@solar-republic/neutrino';
import {hex_to_bytes} from '@blake.regalia/belt';

// create a mainnet wallet using an imported private key in hexadecimal
const wallet = await CosmosSigner(
  hex_to_bytes(import.meta.env.PRIVATE_KEY_HEX),
  import.meta.env.CHAIN_ID,
  import.meta.env.LCD_URL,
  import.meta.env.RPC_URL,
  [0.125, 'uscrt']  // set default gas price
);

// create a handle for communicating with some SNIP-20 contract
const contract = await SecretContract<Snip20>(wallet.lcd, import.meta.env.TOKEN_ADDRESS);

// create a context for querying and executing the contract as the given wallet
const token = await SecretApp(wallet, contract);


// prepare a viewing key
const viewingKey = 'my-secret-viewing-key';

{
  // execute the contract and specify the gas limit
  const [result, , [code, text]] = await token.exec('set_viewing_key', {
    key: viewingKey,
  }, 50_000n);
  
  // handle any errors
  if(code) throw Error(`Execution error: ${text}`);
}

{
  // query the contract, providing a viewing key as auth
  const [result, code, text] = await token.query('balance', {
    address: wallet.addr,
  }, viewingKey);

  // handle any errors
  if(code) throw Error(`Query error: ${text}`);

  // print the result
  console.log(`Balance is: ${result.amount}`);
}
```



### Local development and migration

This checkout uses the unreleased sibling `../cosmos-grpc` package. Build it first:

```sh
cd ../cosmos-grpc
pnpm install --frozen-lockfile
pnpm plugin:run  # regenerate its existing default build/proto assembly
cd ../neutrino
pnpm install --frozen-lockfile
pnpm build
pnpm test:all
pnpm typecheck
```

If `build/proto` does not exist, run the upstream `proto:build` command first. The experimental Secret-only profile is not a drop-in replacement for Neutrino's auth/transaction imports. After rebuilding the local dependency, refresh its file installation with `pnpm install --force --ignore-scripts`.

Node >=22.12 is required for CommonJS `require()` of the ESM package. Browser consumers continue to import ESM. `test:all` runs offline tests; the live examples require deliberate endpoint/key configuration and may submit transactions.

Reuse the same LCD client to reuse contract/network caches. Explicit fee arguments override wallet defaults. Fees are rounded up using exact decimal arithmetic; unsafe numeric gas limits are rejected (use bigint/string). SecretWasm rejects low-order consensus keys and malformed nonces.

See [AUDIT.md](./AUDIT.md) for fixed findings, remaining risks, dependency advisories and release prerequisites. Replace the local file dependency with the correctly versioned upstream release before publishing.

### Lifecycle and audit follow-up

`expect_tx(node, hash, stream?, {timeoutMs, signal})` and the final options argument to
`broadcast_result()` bound the complete wait (default: 120 seconds). `TxWaitError`
means inclusion is unknown; reconcile the transaction hash before creating another
transaction. Transient read failures are retried, but broadcasts are not repeated.

Call `dispose()` on locally created signers and managed WebSocket/event-filter
handles when finished. A filter attached to a shared socket detaches without closing
the shared connection. Signer disposal wipes its owned key buffer and prevents future
signing; callers remain responsible for their original key buffer.

Diagnostics are opt-in through `set_neutrino_diagnostics(handler)`. They contain only
operation, stage and status code; automatic development payload logging was removed.
SNIP-52 decoding has explicit work/size limits and bounded duplicate retention; it does
not yet provide durable reconnect/backfill or seed-rotation recovery.

See [AUDIT.md](AUDIT.md) for fixes and residual findings, and
[UPGRADE_PLAN.md](UPGRADE_PLAN.md) for the tested TypeScript preparation and coordinated
Belt/Contractor migration sequence.

### Coordinated dependency migration

The working checkout uses Belt 0.58 and local `types`, `contractor`, and `cosmos-grpc` siblings. Build Types and Contractor, rebuild Cosmos gRPC's default artifact, then install Neutrino. Its package test packs these siblings into a clean production consumer and checks TS5.9/6/7 with NodeNext/Bundler and full declaration checking. It requires registry access. See [UPGRADE_PLAN.md](UPGRADE_PLAN.md) for the targeted transitive overrides, validated behavior and release order.

Contract JSON inputs may omit object fields; undefined array items and other values that JSON would silently change are rejected. Signing preserves canonical key ordering and Amino escaping. Contract response envelopes are checked, but TypeScript interfaces do not provide full runtime schema validation. Neutrino builds with native TS7.0.2, uses the TS6 compiler API for ESLint/TypeDoc, and checks TS5.9 as the consumer floor. Use Node 24+ (or Node 22 starting at 22.13) for development tooling; the library runtime floor remains Node 22.12. `test:toolchain` checks compiler emission parity and browser bundling; `test:compiled` runs the offline suite against TS7-emitted ESM. See the migration plan for the remaining platform and release gates.


### Release candidate validation

[release/README.md](release/README.md) describes the staged five-package release graph, frozen consumer lockfile, real-browser checks and manual platform workflow. `release:prepare` builds local candidate tarballs; `test:release` tests their transitive installation without overrides or file links. These commands do not publish packages. The candidate passes local Node 22.12/26 and Chromium/Firefox/WebKit checks; remote Linux/Windows jobs remain pending.
