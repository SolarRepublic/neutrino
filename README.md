<p>
  <a href="https://starshell.net/">
    <img src="https://github.com/SolarRepublic/neutrino/assets/1456400/9f854305-a47a-4074-a5d0-bab5ac4b3764" alt="Neutrino logo" width="144">
  </a>
</p>


# Neutrino

An ultra-lightweight Secret Network client and wallet for the Web.

Engineered to produce the smallest possible javascript bundle sizes after gzip, with even greater savings when tree-shaking is used.

### Description

The goal of this project is to provide the necessary tools to run a self-contained Secret Web dApp and an optionaly embedded hot hot wallet. Users are able to:
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
