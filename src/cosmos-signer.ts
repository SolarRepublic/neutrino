/* eslint-disable prefer-const */


import type {S} from 'ts-toolbelt';

import type {CosmosClientLcdRpcStruct, RemoteServiceArg, SlimAuthInfo} from './types';

import type {AsJson, Nilable} from '@blake.regalia/belt';
import type {ProtoEnumCosmosTxSigningSignMode} from '@solar-republic/cosmos-grpc/cosmos/tx/signing/v1beta1/signing';
import type {CwUint128, CwHexUpper, CwAccountAddr, SlimCoin, WeakUint128Str, CwUint64, TypedAminoMsg, TypedStdSignDoc, WeakSecretAccAddr} from '@solar-republic/types';

import type {SignatureAndRecovery, Secp256k1} from '@solar-republic/wasm-secp256k1';

import {text_to_bytes, bytes_to_hex, sha256, canonicalize_json, stringify_json, die, __UNDEFINED, is_number} from '@blake.regalia/belt';

import {any, restruct_coin, type CosmosClientLcd} from '@solar-republic/cosmos-grpc';
import {destructCosmosAuthBaseAccount, type CosmosAuthBaseAccount} from '@solar-republic/cosmos-grpc/cosmos/auth/v1beta1/auth';
import {destructCosmosAuthQueryAccountResponse, queryCosmosAuthAccount} from '@solar-republic/cosmos-grpc/cosmos/auth/v1beta1/query';
import {encodeCosmosCryptoSecp256k1PubKey} from '@solar-republic/cosmos-grpc/cosmos/crypto/secp256k1/keys';
import {XC_PROTO_COSMOS_TX_SIGNING_SIGN_MODE_DIRECT} from '@solar-republic/cosmos-grpc/cosmos/tx/signing/v1beta1/signing';

import {encodeCosmosTxAuthInfo, encodeCosmosTxFee, encodeCosmosTxModeInfo, encodeCosmosTxModeInfoSingle, encodeCosmosTxSignDoc, encodeCosmosTxSignerInfo, encodeCosmosTxTxBody, encodeCosmosTxTxRaw} from '@solar-republic/cosmos-grpc/cosmos/tx/v1beta1/tx';
import {bech32_encode} from '@solar-republic/crypto';

import {initWasmSecp256k1} from '@solar-republic/wasm-secp256k1';

import {normalize_lcd_client, remote_service} from './_common';
import {ripemd160} from './ripemd160.js';
import {exec_fees} from './secret-app';
import {random_32} from './util.js';

let Y_SECP256K1: Secp256k1;


type Zeroable<n_type extends number> = n_type | 0 | undefined;
type Emptyable<s_type extends string> = s_type | '' | undefined;

/**
 * Tuple for specifying preferences for default gas price and denom
 */
export type GasPreferences = [x_gas_price: number, s_denom: string];


export interface CosmosSigner<s_hrp extends string=string> extends CosmosClientLcdRpcStruct {
	/**
	 * Chain id
	 */
	ref: string;

	/**
	 * Bech32 account address
	 */
	addr: CwAccountAddr<s_hrp>;

	/**
	 * Secp256k1 Public Key in compressed 33-byte form
	 */
	pk33: Uint8Array;

	/**
	 * Signs a 32-byte message digest
	 * @param atu8_hash - the message digest to sign
	 * @param atu8_k - optional entropy to use (defaults to secure random 32 bytes)
	 */
	sign(atu8_hash: Uint8Array, atu8_k?: Uint8Array): Promise<SignatureAndRecovery>;

	/**
	 * If gas preferences were specified, produces a `[`{@link SlimCoin `SlimCoin`}`]` containing
	 * the gas fees needed to execute a transaction with the given gas limit
	 * @param z_limit - the gas limit argument passed to {@link exec_fees}
	 */
	// eslint-disable-next-line @typescript-eslint/member-ordering
	fees?: ((z_limit: Parameters<typeof exec_fees>[0]) => ReturnType<typeof exec_fees>) | undefined;
}

/**
 * Convert a 33-byte canonical public key to a bech32-encoded string
 * @param atu8_pk_33 - 33-byte public key buffer
 * @param s_hrp - human-readable part of bech32-encoded address
 * @returns bech32-encoded address string
 */
export const pubkey_to_bech32 = async<
	s_hrp extends string,
>(atu8_pk_33: Uint8Array, s_hrp: s_hrp='secret' as s_hrp): Promise<CwAccountAddr<s_hrp>> => {
	// sha-256 hash of pubkey
	const atu8_sha256 = await sha256(atu8_pk_33);

	// ripemd-160 hash of that
	const atu8_ripemd160 = ripemd160(atu8_sha256);

	// encode to bech32
	return bech32_encode(s_hrp, atu8_ripemd160);
};


/**
 * Creates a Secp256k1 signer instance configured for a specific Cosmos chain and LCD/RPC endpoints,
 * capable of signing arbitrary message hashes.
 * @param atu8_sk - the private key
 * @param si_chain - chain identifier
 * @param p_lcd - the LCD endpoint URL (gRPC-gateway)
 * @param p_rpc - the RPC endpoint URL
 * @returns 
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const CosmosSigner = async<s_hrp extends string, si_chain extends string=string>(
	atu8_sk: Uint8Array,
	si_chain: si_chain,
	z_lcd: CosmosClientLcd | RemoteServiceArg,
	z_rpc: RemoteServiceArg,
	a_gas_prefs?: GasPreferences,
	s_hrp: s_hrp=si_chain.replace(/-.*/, '') as s_hrp
): Promise<CosmosSigner<string extends s_hrp? S.Split<si_chain, '-'>[0]: s_hrp>> => {
	// init secp256k1 WASM
	Y_SECP256K1 ??= await initWasmSecp256k1();

	// obtain public key
	const atu8_pk33 = Y_SECP256K1.sk_to_pk(atu8_sk);

	// convert to bech32
	const sa_account = await pubkey_to_bech32(atu8_pk33, s_hrp);

	return {
		lcd: normalize_lcd_client(z_lcd),

		rpc: remote_service(z_rpc),

		ref: si_chain,

		addr: sa_account,

		pk33: atu8_pk33,

		sign: (atu8_msg: Uint8Array, atu8_k=random_32()) => sha256(atu8_msg).then(atu8_hash => Y_SECP256K1.sign(atu8_sk, atu8_hash, atu8_k)),

		fees: a_gas_prefs
			? z_limit => exec_fees(z_limit, ...a_gas_prefs)
			: __UNDEFINED,
	};
};


/**
 * Fetches auth info for the account (account_number and sequence)
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const auth = async(g_wallet: Pick<CosmosSigner, 'lcd' | 'addr'>, a_auth?: Nilable<SlimAuthInfo> | 0): Promise<SlimAuthInfo> => {
	let sg_account: CwUint64 | undefined;
	let sg_sequence: CwUint64 | undefined;

	// resolve auth data
	if(!a_auth) {
		// submit gRPC-gateway query and destructure the response, extracting the response JSON
		let [g_res, g_err, d_res, s_res] = await queryCosmosAuthAccount(g_wallet.lcd, g_wallet.addr);

		// success
		if(g_res) {
			// destructure the response JSON to get the account struct
			let [g_account] = destructCosmosAuthQueryAccountResponse(g_res);

			// destructure the account struct to get its account and sequence numbers
			[,, sg_account, sg_sequence] = destructCosmosAuthBaseAccount(g_account as CosmosAuthBaseAccount);
		}
		// error
		else if(g_err) {
			// anything other than account not found
			if(5 !== g_err.code) {
				die(g_err.message);
			}
		}
		// no data
		else {
			die(s_res, d_res);
		}
	}

	// return auth data as a tuple (possibly [undefined x 2])
	return a_auth || [sg_account, sg_sequence];
};



/**
 * Signs a set of Amino messages as part of a transaction
 * @param k_wallet - the {@link CosmosSigner} instance
 * @param a_msgs - ordered list of {@link TypedAminoMsg}
 * @param a_fees - transaction fees to approve in the {@link SlimCoin} format
 * @param sg_limit - gas limit as a {@link WeakUint128Str}
 * @param a_auth - optional auth info to use in order to bypass an additional network request, in the {@link SlimAuthInfo} format
 * @param s_memo - optional public memo text to attach to the transaction
 * @param sa_granter - optional address of fee granter account, who will ultimately pay for the transaction fee
 * @param sa_payer - optional address of account to specify which signer account is responsible for the trasaction fee
 * @returns a tuple where:
 *   - 0: the raw signature bytes as a `Uint8Array`
 *   - 1: the signed doc as a {@link TypedStdSignDoc}
 */
export const sign_amino = async<
	a_msgs extends TypedAminoMsg[]=TypedAminoMsg[],
	g_signed extends TypedStdSignDoc<a_msgs>=TypedStdSignDoc<a_msgs>,
>(
	k_wallet: CosmosSigner,
	a_msgs: a_msgs,  // eslint-disable-line @typescript-eslint/naming-convention
	a_fees: SlimCoin[],
	sg_limit: WeakUint128Str,
	a_auth?: Nilable<SlimAuthInfo> | 0,  // eslint-disable-line @typescript-eslint/naming-convention
	s_memo?: string,
	sa_granter?: Emptyable<WeakSecretAccAddr>,
	sa_payer?: Emptyable<WeakSecretAccAddr>
): Promise<[
	atu8_signature: Uint8Array,
	g_signed: g_signed,
]> => {
	// resolve auth data
	const [sg_account, sg_sequence] = await auth(k_wallet, a_auth);

	// produce sign doc
	const g_signdoc: g_signed = canonicalize_json({
		chain_id: k_wallet.ref,
		account_number: sg_account,
		sequence: sg_sequence,
		msgs: a_msgs,
		fee: {
			amount: a_fees.map(restruct_coin),
			gas: sg_limit,
			granter: sa_granter,
			payer: sa_payer,
		},
		memo: s_memo || '',
	}) as g_signed;

	// prepare message
	const atu8_signdoc = text_to_bytes(
		stringify_json(g_signdoc as AsJson<g_signed>)
			.replace(/&/g, '\\u0026')
			.replace(/</g, '\\u003c')
			.replace(/>/g, '\\u003e'));

	// sign it
	const [atu8_signature] = await k_wallet.sign(atu8_signdoc);

	// tuple of signature and sign doc
	return [atu8_signature, g_signdoc];
};


/**
 * Signs a set of Amino messages as part of a transaction
 * @param k_wallet - the {@link CosmosSigner} instance
 * @param a_msgs - ordered list of {@link TypedAminoMsg}
 * @param a_fees - transaction fees to approve in the {@link SlimCoin} format
 * @param sg_limit - gas limit as a {@link WeakUint128Str}
 * @param a_auth - optional auth info to use in order to bypass an additional network request, in the {@link SlimAuthInfo} format
 * @param s_memo - optional public memo text to attach to the transaction
 * @param sa_granter - optional address of fee granter account, who will ultimately pay for the transaction fee
 * @param sa_payer - optional address of account to specify which signer account is responsible for the trasaction fee
 * @returns a tuple where:
 *   - 0: the raw signature bytes as a `Uint8Array`
 *   - 1: the signed doc as a {@link TypedStdSignDoc}
 */

/**
 * Signs a set of protobuf-encoded messages (Direct mode)
 * @param k_wallet - the {@link CosmosSigner} instance
 * @param atu8_auth - protobuf-encoded auth message
 * @param atu8_body - protobuf-encoded
 * @param sg_account 
 * @returns 
 */
export const sign_direct = async(
	k_wallet: CosmosSigner,
	atu8_auth: Uint8Array,
	atu8_body: Uint8Array,
	sg_account?: Nilable<WeakUint128Str>
): Promise<[
	atu8_signature: Uint8Array,
	atu8_signdoc: Uint8Array,
]> => {
	// encode signdoc
	const atu8_doc = encodeCosmosTxSignDoc(atu8_body, atu8_auth, k_wallet.ref, sg_account);

	// sign message
	const [atu8_signature] = await k_wallet.sign(atu8_doc);

	// return tuple of signature and signdoc
	return [atu8_signature, atu8_doc];
};


/**
 * Encodes a transaction
 * 
 * @param xc_sign_mode 
 * @param k_wallet 
 * @param a_msgs 
 * @param a_fees 
 * @param sg_limit 
 * @param a_auth 
 * @param s_memo 
 * @param sa_granter 
 * @param sa_payer 
 * @returns 
 */
export const create_tx_body = async(
	xc_sign_mode: ProtoEnumCosmosTxSigningSignMode,
	k_wallet: Parameters<typeof auth>[0] & Pick<CosmosSigner, 'pk33' | 'fees'>,
	a_msgs: Uint8Array[],
	zg_limit: bigint | WeakUint128Str,
	z_fees?: [SlimCoin, ...SlimCoin[]] | number,
	a_auth?: Nilable<SlimAuthInfo> | 0,  // eslint-disable-line @typescript-eslint/naming-convention
	s_memo?: string,
	sa_granter?: Emptyable<WeakSecretAccAddr>,
	sa_payer?: Emptyable<WeakSecretAccAddr>
): Promise<[
	atu8_auth: Uint8Array,
	atu8_body: Uint8Array,
	sg_account: Nilable<CwUint128>,
]> => {
	// resolve auth data
	const [sg_account, sg_sequence] = await auth(k_wallet, a_auth);

	// encode pubkey
	const atu8_pubkey = any(
		'/cosmos.crypto.secp256k1.PubKey',
		encodeCosmosCryptoSecp256k1PubKey(k_wallet.pk33)
	);

	// encode signer info
	const atu8_signer = encodeCosmosTxSignerInfo(
		atu8_pubkey,
		encodeCosmosTxModeInfo(
			encodeCosmosTxModeInfoSingle(xc_sign_mode)
		),
		sg_sequence
	);

	// encode fee
	const atu8_fee = encodeCosmosTxFee(
		k_wallet.fees?.(zg_limit) ?? (is_number(z_fees)? exec_fees(zg_limit, z_fees): z_fees || die('Must specify fee')),
		zg_limit+'' as WeakUint128Str, sa_payer, sa_granter
	);

	// encode auth info
	const atu8_auth = encodeCosmosTxAuthInfo([atu8_signer], atu8_fee);

	// encode tx body bytes
	const atu8_body = encodeCosmosTxTxBody(a_msgs, s_memo);

	// return tx data
	return [
		atu8_auth,
		atu8_body,
		sg_account as CwUint128,
	];
};


/**
 * Signs a message in DIRECT mode (protobuf encoding)
 * @param k_wallet 
 * @param a_msgs 
 * @param a_fees 
 * @param zg_limit 
 * @param sa_granter 
 * @param sa_payer 
 * @param s_memo 
 * @param a_auth 
 * @returns 
 */
export const create_and_sign_tx_direct = async(
	k_wallet: CosmosSigner,
	a_msgs: Uint8Array[],
	zg_limit: bigint | WeakUint128Str,
	z_fees?: [SlimCoin, ...SlimCoin[]] | number,
	a_auth?: Nilable<SlimAuthInfo> | 0,  // eslint-disable-line @typescript-eslint/naming-convention
	s_memo?: string,
	sa_granter?: Emptyable<WeakSecretAccAddr>,
	sa_payer?: Emptyable<WeakSecretAccAddr>
): Promise<[
	atu8_raw: Uint8Array,
	si_txn: CwHexUpper,
	atu8_signdoc: Uint8Array,
	atu8_signature: Uint8Array,
]> => {
	// create tx
	const [
		atu8_auth,
		atu8_body,
		sg_account,
	] = await create_tx_body(XC_PROTO_COSMOS_TX_SIGNING_SIGN_MODE_DIRECT, k_wallet, a_msgs, zg_limit, z_fees, a_auth, s_memo, sa_granter, sa_payer);

	// sign direct
	const [atu8_signature, atu8_signdoc] = await sign_direct(k_wallet, atu8_auth, atu8_body, sg_account);

	// encode txraw
	const atu8_raw = encodeCosmosTxTxRaw(atu8_body, atu8_auth, [atu8_signature]);

	// compute transaction hash id
	const si_txn = bytes_to_hex(await sha256(atu8_raw)).toUpperCase();

	// return tuple of raw tx bytes, tx hash id, sign doc, and signature
	return [atu8_raw, si_txn, atu8_signdoc, atu8_signature];
};

// /**
//  * Signs a message in AMINO mode
//  * @param k_wallet 
//  * @param a_msgs 
//  * @param a_fees 
//  * @param sg_limit 
//  * @param sa_granter 
//  * @param sa_payer 
//  * @param s_memo 
//  * @param a_auth 
//  * @returns 
//  */
// export const create_and_sign_tx_amino = async(
// 	k_wallet: Wallet,
// 	a_msgs: TypedAminoMsg[],
// 	a_fees: SlimCoin[],
// 	sg_limit: WeakUint128Str,
// 	a_auth?: Nilable<SlimAuthInfo> | 0,  // eslint-disable-line @typescript-eslint/naming-convention
// 	s_memo?: string,
// 	sa_granter?: Emptyable<WeakSecretAccAddr>,
// 	sa_payer?: Emptyable<WeakSecretAccAddr>
// ): Promise<[
// 	atu8_raw: Uint8Array,
// 	atu8_signdoc: Uint8Array,
// 	si_txn: CwHexUpper,
// ]> => {
// 	// create tx
// 	const [
// 		atu8_auth,
// 		atu8_body,
// 		sg_account,
// 	] = await create_tx_body(XC_PROTO_COSMOS_TX_SIGNING_SIGN_MODE_LEGACY_AMINO_JSON, k_wallet, a_msgs, a_fees, sg_limit, a_auth, s_memo, sa_granter, sa_payer);

// 	// sign direct
// 	const [atu8_signature, atu8_signdoc] = await sign_amino(k_wallet, a_msgs, a_fees, sg_limit, a_auth, s_memo, sa_granter, sa_payer);
// 	 atu8_auth, atu8_body, sg_account);

// 	// encode txraw
// 	const atu8_raw = encodeCosmosTxTxRaw(atu8_body, atu8_auth, [atu8_signature]);

// 	// compute transaction hash id
// 	const si_txn = bytes_to_hex(await sha256(atu8_raw)).toUpperCase();

// 	// return tuple of raw tx bytes, sign doc, and tx hash id
// 	return [atu8_raw, atu8_signdoc, si_txn];
// };
