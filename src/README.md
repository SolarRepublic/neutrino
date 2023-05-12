# Neutrino

An ultra-lightweight Secret Network client and wallet for the Web.


### Description

The goal of this project is to provide the minimum set of features required to run a self-contained Secret Web dApp and an optionaly embedded hot hot wallet.

The primary purpose of this library is to be able to:
 - query the Secret Network chain
 - construct and broadcast transactions to the chain
 - query and execute Secret Contracts
 - sign and verify Secp256k1 messages (to enable hot hot wallets)

Consequently, the following functions are also exposed:
 - Bech32 encoding/decoding
 - Curve25519 scalar multiplication
 - RIPEMD-160 hashing
 - Secp256k1 key generation, signing/verification, and ECDH
 - AES-128-SIV encryption/decryption
 - Schema-less Protobuf reading/writing


### Tuples, Tuples, Tuples

Tuples (EC Arrays `[]`) are used in places you might normally expect a named struct, such as return values. Similarly, virtually all functions opt for ordered parameters instead of named structs.

This practice helps achieve much lower bundle sizes, but at the expense of API simplicity. However, developing in a TypeScript IDE should make this neglible as rich type information makes it clear what the type of purpose of every parameter and return value are.
