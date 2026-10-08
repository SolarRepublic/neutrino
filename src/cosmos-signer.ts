import {bytes_to_hex} from './encoding.js';
import {to_wire_json} from './json.js';



import type {S} from 'ts-toolbelt';

import type {CosmosClientLcdRpcStruct, RemoteServiceArg, SlimAuthInfo} from './types.js';

import type {AsJson, Nilable} from '@blake.regalia/belt';
import type {CosmosClientLcd} from '@solar-republic/cosmos-grpc';
import type {ProtoEnumCosmosTxSigningSignMode} from '@solar-republic/cosmos-grpc/cosmos/tx/signing/v1beta1/signing';
import type {CwUint128, CwHexUpper, CwAccountAddr, SlimCoin, WeakUint128Str, TypedAminoMsg, TypedStdSignDoc, WeakSecretAccAddr} from '@solar-republic/types';

import type {SignatureAndRecovery, Secp256k1} from '@solar-republic/wasm-secp256k1';

import {text_to_bytes, sha256, stringify_json, die, __UNDEFINED, is_number} from '@blake.regalia/belt';

import {any, restruct_coin} from '@solar-republic/cosmos-grpc';


import {queryCosmosAuthAccount} from '@solar-republic/cosmos-grpc/cosmos/auth/v1beta1/query';
import {encodeCosmosCryptoSecp256k1PubKey} from '@solar-republic/cosmos-grpc/cosmos/crypto/secp256k1/keys';
import {XC_PROTO_COSMOS_TX_SIGNING_SIGN_MODE_DIRECT} from '@solar-republic/cosmos-grpc/cosmos/tx/signing/v1beta1/signing';

import {encodeCosmosTxAuthInfo, encodeCosmosTxFee, encodeCosmosTxModeInfo, encodeCosmosTxModeInfoSingle, encodeCosmosTxSignDoc, encodeCosmosTxSignerInfo, encodeCosmosTxTxBody, encodeCosmosTxTxRaw} from '@solar-republic/cosmos-grpc/cosmos/tx/v1beta1/tx';
import {bech32_encode} from '@solar-republic/crypto';

import {initWasmSecp256k1} from '@solar-republic/wasm-secp256k1';

import {normalize_lcd_client, remote_service} from './_common.js';
import {ripemd160} from './ripemd160.js';
import {random_32} from './util.js';

let DP_SECP256K1: Promise<Secp256k1> | undefined;


type Emptyable<s_type extends string> = s_type | '' | undefined;

/**
 * Tuple for specifying preferences for default gas price and denom
 */
export type GasPreferences = [x_gas_price: number, s_denom: string];


export interface CosmosSigner<
	s_hrp extends string=string,
	w_extra_signing_data extends any=any,
> extends CosmosClientLcdRpcStruct {
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
	 * Signs a 32-byte message
	 * @param atu8_msg - the message to sign (not the digest)
	 * @param atu8_k - optional entropy to use (defaults to secure random 32 bytes)
	 * @param w_extra - optional arbitrary data to pass to implementors
	 */
	sign(atu8_msg: Uint8Array, atu8_k?: Uint8Array, w_extra?: w_extra_signing_data): Promise<SignatureAndRecovery>;

	/**
	 * If gas preferences were specified, produces a `[`{@link SlimCoin `SlimCoin`}`]` containing
	 * the gas fees needed to execute a transaction with the given gas limit
	 * @param z_limit - the gas limit argument passed to {@link exec_fees}
	 */

	fees?: ((z_limit: Parameters<typeof exec_fees>[0]) => ReturnType<typeof exec_fees>) | undefined;

	/** Wipe owned key material and reject future signing, if supported. */
	dispose?(): void;
}


/**
 * Given a limit, gas price, and denom (defaults to 'uscrt'), produces an array containing a single {@link SlimCoin} tuple
 * @param z_limit 
 * @param x_gas_price 
 * @param s_denom 
 * @returns 
 */
export const exec_fees = (z_limit: number|bigint|`${bigint}`, x_gas_price: number, s_denom='uscrt'): [SlimCoin] => {
	if('number' === typeof z_limit && !Number.isSafeInteger(z_limit)) die('Gas limit must be a safe integer');
	const xg_limit = BigInt(z_limit);
	if(xg_limit < 0n || !Number.isFinite(x_gas_price) || x_gas_price < 0) die('Invalid gas limit or price');
	// Interpret the price's decimal representation exactly, including exponent notation.
	const [s_coefficient, s_exponent='0'] = String(x_gas_price).split('e');
	const [s_whole, s_fraction=''] = s_coefficient.split('.');
	const n_scale = s_fraction.length - Number(s_exponent);
	const xg_numerator = xg_limit * BigInt(s_whole+s_fraction) * (10n ** BigInt(Math.max(0, -n_scale)));
	const xg_denominator = 10n ** BigInt(Math.max(0, n_scale));
	return [[String((xg_numerator + xg_denominator - 1n) / xg_denominator), s_denom]] as [SlimCoin];
};


/**
 * Convert a 33-byte canonical public key to a bech32-encoded string
 * @param atu8_pk_33 - 33-byte public key buffer
 * @param s_hrp - human-readable part of bech32-encoded address
 * @returns bech32-encoded address string
 */
export const pubkey_to_bech32 = async<
	s_hrp extends string,
>(atu8_pk_33: Uint8Array<ArrayBuffer>, s_hrp: s_hrp='secret' as s_hrp): Promise<CwAccountAddr<s_hrp>> => {
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
	atu8_sk: Uint8Array<ArrayBuffer>,
	si_chain: si_chain,
	z_lcd: CosmosClientLcd | RemoteServiceArg,
	z_rpc: RemoteServiceArg,
	a_gas_prefs?: GasPreferences,
	s_hrp: s_hrp=si_chain.replace(/-.*/, '') as s_hrp
): Promise<CosmosSigner<string extends s_hrp? S.Split<si_chain, '-'>[0]: s_hrp> & {dispose(): void}> => {
	if(atu8_sk.length !== 32) throw Error('Private key must be 32 bytes');
	const xg_scalar = BigInt('0x'+bytes_to_hex(atu8_sk));
	if(!xg_scalar || xg_scalar >= 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n) throw Error('Invalid secp256k1 private key');
	// Take ownership before the first await so callers may safely wipe their input.
	const atu8_owned = atu8_sk.slice();
	let b_disposed = false;
	let y_secp: Secp256k1;
	let atu8_pk33: Uint8Array<ArrayBuffer>;
	let sa_account: CwAccountAddr<s_hrp>;
	try {
		y_secp = await (DP_SECP256K1 ??= initWasmSecp256k1().catch((e_error: unknown) => {
			DP_SECP256K1 = __UNDEFINED;
			throw e_error;
		}));
		atu8_pk33 = y_secp.sk_to_pk(atu8_owned);
		sa_account = await pubkey_to_bech32(atu8_pk33, s_hrp);
	}
	catch(e_error) { atu8_owned.fill(0); throw e_error; }

	return {
		lcd: normalize_lcd_client(z_lcd),

		rpc: remote_service(z_rpc),

		ref: si_chain,

		addr: sa_account,

		get pk33() { return atu8_pk33.slice(); },

		dispose() { b_disposed = true; atu8_owned.fill(0); },

		async sign(atu8_msg: Uint8Array<ArrayBuffer>, atu8_k=random_32()) {
			if(b_disposed) throw Error('Signer is disposed');
			if(atu8_k.length !== 32) throw Error('Signing entropy must be 32 bytes');
			const atu8_entropy = atu8_k.slice();
			try {
				const atu8_hash = await sha256(atu8_msg);
				if(b_disposed) throw Error('Signer is disposed');
				return y_secp.sign(atu8_owned, atu8_hash, atu8_entropy);
			}
			finally { atu8_entropy.fill(0); }
		},

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
	const f_validate = (a_values: SlimAuthInfo): SlimAuthInfo => {
		if(a_values.length !== 2 || !a_values.every(s_value => 'string' === typeof s_value && /^\d+$/.test(s_value) && BigInt(s_value) <= 0xffffffffffffffffn)) throw Error('Missing or invalid account number/sequence');
		return a_values;
	};

	if(a_auth) return f_validate(a_auth);
	const [g_res, g_err, d_res] = await queryCosmosAuthAccount(g_wallet.lcd, g_wallet.addr);
	if(!g_res) throw Error(5 === g_err?.code? 'Account not found': `Account query failed (${d_res.status})`);
	let g_account = g_res.account as unknown as Record<string, unknown> | undefined;
	if(!g_account) throw Error('Missing account data');
	const s_type = g_account['@type'];
	if('/cosmos.auth.v1beta1.ModuleAccount' === s_type || '/ethermint.types.v1.EthAccount' === s_type || '/injective.types.v1beta1.EthAccount' === s_type) {
		g_account = g_account['base_account'] as Record<string, unknown> | undefined;
	}
	else if('string' === typeof s_type && /^\/cosmos\.vesting\.v1beta1\.(ContinuousVestingAccount|DelayedVestingAccount|PeriodicVestingAccount|PermanentLockedAccount)$/.test(s_type)) {
		g_account = (g_account['base_vesting_account'] as Record<string, unknown> | undefined)?.['base_account'] as Record<string, unknown> | undefined;
	}
	else if(s_type !== '/cosmos.auth.v1beta1.BaseAccount') {throw Error('Unsupported account type');}

	if(g_account?.['address'] !== g_wallet.addr) throw Error('Invalid account address');
	return f_validate([g_account['account_number'], g_account['sequence']] as SlimAuthInfo);
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

	if('string' !== typeof sg_account || 'string' !== typeof sg_sequence) throw Error('Amino signing requires account number and sequence');

	// produce sign doc
	const g_signdoc: g_signed = to_wire_json({
		chain_id: k_wallet.ref,
		account_number: sg_account,
		sequence: sg_sequence,
		msgs: a_msgs,
		fee: {
			amount: a_fees.map(a_coin => restruct_coin(a_coin)!),
			gas: sg_limit,
			granter: sa_granter,
			payer: sa_payer,
		},
		memo: s_memo || '',
	}, true) as unknown as g_signed;

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
	sa_payer?: Emptyable<WeakSecretAccAddr>,
	sg_timeout_height?: Nilable<CwUint128>
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
		is_number(z_fees)? exec_fees(zg_limit, z_fees): z_fees ?? k_wallet.fees?.(zg_limit) ?? die('Must specify fee'),
		zg_limit+'' as WeakUint128Str, sa_payer, sa_granter
	);

	// encode auth info
	const atu8_auth = encodeCosmosTxAuthInfo([atu8_signer], atu8_fee);

	// encode tx body bytes
	const atu8_body = encodeCosmosTxTxBody(a_msgs, s_memo, sg_timeout_height);

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
	sa_payer?: Emptyable<WeakSecretAccAddr>,
	sg_timeout_height?: Nilable<CwUint128>
): Promise<[
	atu8_raw: Uint8Array<ArrayBuffer>,
	si_txn: CwHexUpper,
	atu8_signdoc: Uint8Array,
	atu8_signature: Uint8Array,
]> => {
	// create tx
	const [
		atu8_auth,
		atu8_body,
		sg_account,
	] = await create_tx_body(XC_PROTO_COSMOS_TX_SIGNING_SIGN_MODE_DIRECT, k_wallet, a_msgs, zg_limit, z_fees, a_auth, s_memo, sa_granter, sa_payer, sg_timeout_height);

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
