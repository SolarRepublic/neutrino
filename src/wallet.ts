import type {ProtoWriter} from './protobuf-writer';
import type {AccountResponse} from './query/_root';

import type {HttpsUrl, LcdRpcStruct, SecretBech32, SlimAuthInfo, SlimCoin, TypedAminoMsg, TypedStdSignDoc} from './types';

import type {Uint128, HexUpper, Nilable, Base64} from '@blake.regalia/belt';
import type {Coin} from '@cosmjs/amino';

import {text_to_buffer, buffer_to_base64, buffer_to_hex, sha256, canonicalize_json} from '@blake.regalia/belt';


import {bech32_encode} from './bech32';
import {any, coin, Protobuf} from './protobuf-writer';
import {queryAuthAccounts} from './query/auth';
import {ripemd160} from './ripemd160';
import {sign, sk_to_pk, type SignatureAndRecovery} from './secp256k1';
import {random_32, safe_json} from './util';

const XC_SIGN_MODE_DIRECT = 1 as const;
const XC_SIGN_MODE_AMINO = 127 as const;

type SignModeValue = typeof XC_SIGN_MODE_DIRECT | typeof XC_SIGN_MODE_AMINO;

// enum SignModeValue {
// 	// UNSPECIFIED = 0,
// 	DIRECT = 1,
// 	// TEXTUAL = 2,
// 	// DIRECT_AUX = 3,
// 	LEGACY_AMINO_JSON = 127,
// 	// EIP_191 = 191,
// }

/**
 * ModeInfo.Single
 */
const encode_modeinfo_single = (k_writer: ProtoWriter, xc_mode: SignModeValue) => k_writer
	.v(8).v(xc_mode);

/**
 * ModeInfo
 */
const encode_modeinfo = (k_writer: ProtoWriter, xc_mode_single_arg: SignModeValue) => k_writer
	.v(10).n(encode_modeinfo_single, xc_mode_single_arg);

/**
 * SignerInfo
 */
const encode_signerinfo = (k_writer: ProtoWriter, xc_sign_mode: SignModeValue, atu8_pubkey: Uint8Array, sg_sequence: Uint128) => {
	k_writer
		.v(10).b(atu8_pubkey)
		.v(18).n(encode_modeinfo, xc_sign_mode);

	if('0' !== sg_sequence) {
		k_writer.v(24).g(BigInt(sg_sequence));
	}

	return k_writer;
};

/**
 * Fee
 */
export const encode_fee = (
	k_writer: ProtoWriter,
	a_amounts: SlimCoin[],
	sg_limit: Uint128,
	sa_granter?: Nilable<SecretBech32> | '',
	sa_payer?: Nilable<SecretBech32> | ''
) => {
	a_amounts.map(a_coin => k_writer.v(10).b(coin(a_coin)));

	if('0' !== sg_limit) k_writer.v(16).g(BigInt(sg_limit));

	// for multi-signer mode, not used in single-signer mode
	if(sa_payer) k_writer.v(26).s(sa_payer);

	// fee granter
	if(sa_granter) k_writer.v(34).s(sa_granter);

	return k_writer;
};

/**
 * AuthInfo
 */
export const encode_authinfo = (k_writer: ProtoWriter, a_signers: Uint8Array[], atu8_fee: Uint8Array) => {
	a_signers.map(atu8_signer => k_writer.v(10).b(atu8_signer));

	k_writer.v(18).b(atu8_fee);

	return k_writer;
};

/**
 * TxBody
 */
export const encode_txbody = (k_writer: ProtoWriter, a_msgs: Uint8Array[], s_memo?: string, sg_timeout?: Uint128) => {
	a_msgs.map(atu8_msg => k_writer.v(10).b(atu8_msg));

	if(s_memo) k_writer.v(18).s(s_memo);

	if(sg_timeout) k_writer.v(24).g(BigInt(sg_timeout));

	return k_writer;
};

/**
 * SignDoc
 */
export const encode_signdoc = (
	k_writer: ProtoWriter,
	atu8_body: Uint8Array,
	atu8_auth: Uint8Array,
	si_chain: string,
	sg_account: Nilable<Uint128>
) => {
	k_writer
		.v(10).b(atu8_body)
		.v(18).b(atu8_auth)
		.v(26).s(si_chain);

	if(sg_account) k_writer.v(32).g(BigInt(sg_account));

	return k_writer;
};

/**
 * TxRaw
 */
export const encode_txraw = (k_writer: ProtoWriter, atu8_body: Uint8Array, atu8_auth: Uint8Array, a_signatures: Uint8Array[]) => {
	k_writer
		.v(10).b(atu8_body)
		.v(18).b(atu8_auth);

	a_signatures.map(atu8_sig => k_writer.v(26).b(atu8_sig));

	return k_writer;
};


// export enum SignModeName {
// 	// UNSPECIFIED = 'SIGN_MODE_UNSPECIFIED',
// 	DIRECT = 'SIGN_MODE_DIRECT',
// 	// TEXTUAL = 'SIGN_MODE_TEXTUAL',
// 	// DIRECT_AUX = 'SIGN_MODE_DIRECT_AUX',
// 	AMINO = 'SIGN_MODE_LEGACY_AMINO_JSON',
// 	// EIP_191 = 'SIGN_MODE_EIP_191',
// }


export interface TxResponse {
	code: number;
	codespace: string;
	data: Base64;
	events: {
		type: string;
		attributes: {
			index?: boolean;
			key: Base64;
			value: Base64;
		}[];
	}[];
	gas_used: Uint128;
	gas_wanted: Uint128;
	height: Uint128;
	info: string;
	logs: [];
	raw_log: string;
	timestamp: string;
	tx: null | {
		auth_info: {
			fee: {
				amount: Coin[];
				gas_limit: Uint128;
				granter: SecretBech32 | '';
				payer: SecretBech32 | '';
			};
			signer_infos: {
				mode_info: {
					single: {
						mode: `SIGN_MODE_${'UNSPECIFIED' | 'DIRECT' | 'TEXTUAL' | 'DIRECT_AUX' | 'LEGACY_AMINO_JSON' | 'EIP_191'}`;
					};
				} | {
					multi: unknown;
				};
				public_key: {
					type_url: '/cosmos.crypto.secp256k1.PubKey';
					value: Base64;
				};
				sequence: Uint128;
			}[];
		};
		body: {
			extension_options: unknown[];
			memo: string;
			messages: {
				type_url: string;
				value: Base64;
			}[];
			non_critical_extension_options: unknown[];
			timeout_height: Uint128;
		};
		signatures: Base64[];
	};
	txhash: HexUpper;
}


export interface BroadcastResultOk {
	tx_response?: TxResponse;
}

export interface BroadcastResultErr {
	code: 2;
	message: string;
	details: unknown[];
}

export type BroadcastResult = BroadcastResultOk | BroadcastResultErr;

export interface Wallet extends LcdRpcStruct {
	/**
	 * Chain id
	 */
	ref: string;

	/**
	 * Bech32 account address
	 */
	addr: SecretBech32;

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
}

export const pubkey_to_bech32 = async<
	s_hrp extends `secret${string}`='secret',
>(atu8_pk_33: Uint8Array, s_hrp: s_hrp='secret' as s_hrp): Promise<SecretBech32<s_hrp>> => {
	// sha-256 hash of pubkey
	const atu8_sha256 = await sha256(atu8_pk_33);

	// ripemd-160 hash of that
	const atu8_ripemd160 = ripemd160(atu8_sha256);

	// encode to bech32
	return bech32_encode(s_hrp, atu8_ripemd160) as SecretBech32<s_hrp>;
};


// eslint-disable-next-line @typescript-eslint/naming-convention
export const Wallet = async(
	atu8_sk: Uint8Array,
	si_chain: string,
	p_lcd: HttpsUrl,
	p_rpc: HttpsUrl
): Promise<Wallet> => {
	// obtain public key
	const atu8_pk33 = sk_to_pk(atu8_sk);

	// convert to bech32
	const sa_account = await pubkey_to_bech32(atu8_pk33);

	return {
		lcd: p_lcd,

		rpc: p_rpc,

		ref: si_chain,

		addr: sa_account,

		pk33: atu8_pk33,

		sign: (atu8_hash: Uint8Array, atu8_k=random_32()) => sign(atu8_sk, atu8_hash, atu8_k),
	};
};


/**
 * Fetches auth info for the account (account_number and sequence)
 * @param a_auth 
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const auth = async(g_wallet: Pick<Wallet, 'lcd' | 'addr'>, a_auth?: Nilable<SlimAuthInfo> | 0): Promise<SlimAuthInfo> => {
	// resolve auth data
	if(!a_auth) {
		let g_account!: AccountResponse | undefined;
		try {
			g_account = (await queryAuthAccounts(g_wallet.lcd, g_wallet.addr))[0];
		}
		catch(e_auth) {}

		// destructure auth data
		a_auth = [g_account?.account_number, g_account?.sequence];
	}

	return a_auth;
};


/**
 * Broadcast a transaction to the network
 * @param p_lcd 
 * @param atu8_raw 
 * @returns tuple of `[string, Response]` where:
 *  - [0]: `s_res: string` - the result of `await response.text()`
 *  - [1]: `d_res: Response` - the {@link Response} object
 */
export const broadcast = async(p_lcd: HttpsUrl, atu8_raw: Uint8Array, s_mode: 'BLOCK' | 'SYNC' | 'ASYNC'='BLOCK'): Promise<[string, Response]> => {
	const d_res = await fetch(p_lcd+'/cosmos/tx/v1beta1/txs', {
		method: 'POST',
		body: JSON.stringify({
			mode: 'BROADCAST_MODE_'+s_mode,
			txBytes: buffer_to_base64(atu8_raw),
		}),
	});

	return [await d_res.text(), d_res];
};



// /**
//  * Signs a message in DIRECT mode (protobuf encoding)
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
// export const sign_direct = async(
// 	k_wallet: Wallet,
// 	a_msgs: Uint8Array[],
// 	a_fees: SlimCoin[],
// 	sg_limit: Uint128,
// 	sa_granter: Nilable<SecretBech32> | ''='',
// 	sa_payer: Nilable<SecretBech32> | ''='',
// 	s_memo='',
// 	a_auth?: Nilable<SlimAuthInfo>
// ): Promise<[
// 	atu8_tx_raw: Uint8Array,
// 	atu8_signdoc: Uint8Array,
// 	si_txn: string,
// ]> => {
// 	// resolve auth data
// 	const [sg_account, sg_sequence] = await k_wallet.auth(a_auth);

// 	// encode pubkey
// 	const atu8_pubkey = any(
// 		'/cosmos.crypto.secp256k1.PubKey',
// 		Protobuf().v(10).b(k_wallet.pk33).o()
// 	);

// 	// encode signer info
// 	const atu8_signer = encode_signerinfo(Protobuf(), XC_SIGN_MODE_DIRECT, atu8_pubkey, sg_sequence || '0').o();


// 	// encode fee
// 	const atu8_fee = encode_fee(Protobuf(), a_fees, sg_limit, sa_granter).o();


// 	// encode auth info
// 	const atu8_auth = encode_authinfo(Protobuf(), [atu8_signer], atu8_fee).o();


// 	// encode tx body bytes
// 	const atu8_body = encode_txbody(Protobuf(), a_msgs, s_memo).o();

// 	// encode signdoc
// 	const atu8_doc = encode_signdoc(Protobuf(), atu8_body, atu8_auth, k_wallet.ref, sg_account).o();


// 	// hash message
// 	const atu8_hash = await sha256(atu8_doc);

// 	// sign message hash
// 	const [atu8_signature] = await k_wallet.sign(atu8_hash);

// 	// encode txraw
// 	const atu8_raw = encode_txraw(Protobuf(), atu8_body, atu8_auth, [atu8_signature]).o();

// 	// compute transaction hash id
// 	const si_tx = buffer_to_hex(await sha256(atu8_raw)).toUpperCase();

// 	return [atu8_raw, atu8_doc, si_tx];
// };


/**
 * Signs a set of Amino messages
 * @param k_wallet 
 * @param a_msgs 
 * @param a_fees 
 * @param sg_limit 
 * @param sa_granter 
 * @param sa_payer 
 * @param s_memo 
 * @param a_auth 
 * @returns 
 */
export const sign_amino = async<
	a_msgs extends TypedAminoMsg[]=TypedAminoMsg[],
	g_signed extends TypedStdSignDoc<a_msgs>=TypedStdSignDoc<a_msgs>,
>(
	k_wallet: Wallet,
	a_msgs: a_msgs,  // eslint-disable-line @typescript-eslint/naming-convention
	a_fees: SlimCoin[],
	sg_limit: Uint128,
	a_auth?: Nilable<SlimAuthInfo> | 0,  // eslint-disable-line @typescript-eslint/naming-convention
	s_memo?: string,
	sa_granter?: Nilable<SecretBech32> | '',
	sa_payer?: Nilable<SecretBech32> | ''
): Promise<[
	atu8_signature: Uint8Array,
	g_signed: g_signed,
]> => {
	// resolve auth data
	const [sg_account, sg_sequence] = await auth(k_wallet, a_auth);

	// produce sign doc
	const g_signdoc = canonicalize_json({
		chain_id: k_wallet.ref,
		account_number: sg_account,
		sequence: sg_sequence,
		msgs: a_msgs,
		fee: {
			amount: a_fees.map(a_coin => ({
				amount: a_coin[0],
				denom: a_coin[1],
			})),
			gas: sg_limit,
			granter: sa_granter as SecretBech32,
			payer: sa_payer as SecretBech32,
		},
		memo: s_memo || '',
	}) as g_signed;

	// prepare message
	const atu8_signdoc = text_to_buffer(
		JSON.stringify(g_signdoc)
			.replace(/&/g, '\\u0026')
			.replace(/</g, '\\u003c')
			.replace(/>/g, '\\u003e'));

	// hash message
	const atu8_hash = await sha256(atu8_signdoc);

	// sign it
	const [atu8_signature] = await k_wallet.sign(atu8_hash);

	// tuple of signature and sign doc
	return [atu8_signature, g_signdoc];
};


/**
 * Signs a set of protobuf-encoded message (Direct mode)
 * @param k_wallet 
 * @param a_msgs 
 * @param a_fees 
 * @param sg_limit 
 * @param sa_granter 
 * @param sa_payer 
 * @param s_memo 
 * @param a_auth 
 * @returns 
 */
export const sign_direct = async(
	k_wallet: Wallet,
	atu8_auth: Uint8Array,
	atu8_body: Uint8Array,
	sg_account?: Nilable<Uint128>
): Promise<[
	atu8_signature: Uint8Array,
	atu8_signdoc: Uint8Array,
]> => {
	// encode signdoc
	const atu8_doc = encode_signdoc(Protobuf(), atu8_body, atu8_auth, k_wallet.ref, sg_account).o();

	// hash message
	const atu8_hash = await sha256(atu8_doc);

	// sign message hash
	const [atu8_signature] = await k_wallet.sign(atu8_hash);

	// return tuple of signature and signdoc
	return [atu8_signature, atu8_doc];
};


/**
 * Encodes a transaction
 * @param k_wallet 
 * @param a_msgs 
 * @param xc_sign_mode 
 * @param a_fees 
 * @param sg_limit 
 * @param sa_granter 
 * @param sa_payer 
 * @param s_memo 
 * @param a_auth 
 * @returns 
 */
export const create_tx = async(
	xc_sign_mode: SignModeValue,
	k_wallet: Parameters<typeof auth>[0] & Pick<Wallet, 'pk33'>,
	a_msgs: Uint8Array[],
	a_fees: SlimCoin[],
	sg_limit: Uint128,
	a_auth?: Nilable<SlimAuthInfo> | 0,  // eslint-disable-line @typescript-eslint/naming-convention
	s_memo?: string,
	sa_granter?: Nilable<SecretBech32> | '',
	sa_payer?: Nilable<SecretBech32> | ''
): Promise<[
	atu8_auth: Uint8Array,
	atu8_body: Uint8Array,
	sg_account: Nilable<Uint128>,
]> => {
	// resolve auth data
	const [sg_account, sg_sequence] = await auth(k_wallet, a_auth);

	// encode pubkey
	const atu8_pubkey = any(
		'/cosmos.crypto.secp256k1.PubKey',
		Protobuf().v(10).b(k_wallet.pk33).o()
	);

	// encode signer info
	const atu8_signer = encode_signerinfo(Protobuf(), xc_sign_mode, atu8_pubkey, sg_sequence || '0').o();


	// encode fee
	const atu8_fee = encode_fee(Protobuf(), a_fees, sg_limit, sa_granter, sa_payer).o();


	// encode auth info
	const atu8_auth = encode_authinfo(Protobuf(), [atu8_signer], atu8_fee).o();


	// encode tx body bytes
	const atu8_body = encode_txbody(Protobuf(), a_msgs, s_memo).o();

	// return tx data
	return [
		atu8_auth,
		atu8_body,
		sg_account,
	];
};


/**
 * Signs a message in DIRECT mode (protobuf encoding)
 * @param k_wallet 
 * @param a_msgs 
 * @param a_fees 
 * @param sg_limit 
 * @param sa_granter 
 * @param sa_payer 
 * @param s_memo 
 * @param a_auth 
 * @returns 
 */
export const create_and_sign_tx_direct = async(
	k_wallet: Wallet,
	a_msgs: Uint8Array[],
	a_fees: SlimCoin[],
	sg_limit: Uint128,
	a_auth?: Nilable<SlimAuthInfo> | 0,  // eslint-disable-line @typescript-eslint/naming-convention
	s_memo?: string,
	sa_granter?: Nilable<SecretBech32> | '',
	sa_payer?: Nilable<SecretBech32> | ''
): Promise<[
	atu8_raw: Uint8Array,
	atu8_signdoc: Uint8Array,
	si_txn: string,
]> => {
	// create tx
	const [
		atu8_auth,
		atu8_body,
		sg_account,
	] = await create_tx(XC_SIGN_MODE_DIRECT, k_wallet, a_msgs, a_fees, sg_limit, a_auth, s_memo, sa_granter, sa_payer);

	// sign direct
	const [atu8_signature, atu8_signdoc] = await sign_direct(k_wallet, atu8_auth, atu8_body, sg_account);

	// encode txraw
	const atu8_raw = encode_txraw(Protobuf(), atu8_body, atu8_auth, [atu8_signature]).o();

	// compute transaction hash id
	const si_txn = buffer_to_hex(await sha256(atu8_raw)).toUpperCase();

	// return tuple of raw tx bytes, sign doc, and tx hash id
	return [atu8_raw, atu8_signdoc, si_txn];
};
