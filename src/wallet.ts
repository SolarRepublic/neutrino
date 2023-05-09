import type {AccountResponse, LcdQueryClient} from './lcd-query';

import type {ProtoWriter, SlimCoin} from './protobuf';
import type {SecretBech32} from './types';

import type {Coin} from '@cosmjs/amino';

import {base64_to_buffer, buffer_to_base64, buffer_to_hex, sha256, type Nilable} from '@solar-republic/belt';

import {gen_sk, sign, sk_to_pk} from '@solar-republic/secp256k1-js';

import {bech32Encode} from './bech32';
import {any, coin, protobuf} from './protobuf';
import {ripemd160} from './ripemd160';


enum SignModeValue {
	UNSPECIFIED = 0,
	DIRECT = 1,
	TEXTUAL = 2,
	DIRECT_AUX = 3,
	LEGACY_AMINO_JSON = 127,
	EIP_191 = 191,
}

/**
 * ModeInfo.Single
 */
const encode_modeinfo_single = (k_writer: ProtoWriter, xc_mode: SignModeValue) => k_writer
	.uint32(8).uint32(xc_mode);

/**
 * ModeInfo
 */
const encode_modeinfo = (k_writer: ProtoWriter, xc_mode_single_arg: SignModeValue) => k_writer
	.uint32(10).nest(encode_modeinfo_single, xc_mode_single_arg);

/**
 * SignerInfo
 */
const encode_signerinfo = (k_writer: ProtoWriter, atu8_pubkey: Uint8Array, sg_sequence: `${bigint}`) => {
	k_writer
		.uint32(10).bytes(atu8_pubkey)
		.uint32(18).nest(encode_modeinfo, SignModeValue.DIRECT);

	if('0' !== sg_sequence) {
		k_writer.uint32(24).uint64(BigInt(sg_sequence));
	}

	return k_writer;
};

/**
 * Fee
 */
const encode_fee = (
	k_writer: ProtoWriter,
	a_amounts: SlimCoin[],
	sg_limit: `${bigint}`,
	sa_granter?: Nilable<SecretBech32> | '',
	sa_payer?: Nilable<SecretBech32> | ''
) => {
	a_amounts.map(a_coin => k_writer.uint32(10).bytes(coin(a_coin)));

	if('0' !== sg_limit) k_writer.uint32(16).uint64(BigInt(sg_limit));

	// for multi-signer mode, not used in single-signer mode
	if(sa_payer) k_writer.uint32(26).string(sa_payer);

	// fee granter
	if(sa_granter) k_writer.uint32(34).string(sa_granter);

	return k_writer;
};

/**
 * AuthInfo
 */
const encode_authinfo = (k_writer: ProtoWriter, a_signers: Uint8Array[], atu8_fee: Uint8Array) => {
	a_signers.map(atu8_signer => k_writer.uint32(10).bytes(atu8_signer));

	k_writer.uint32(18).bytes(atu8_fee);

	return k_writer;
};

/**
 * TxBody
 */
const encode_txbody = (k_writer: ProtoWriter, a_msgs: Uint8Array[], s_memo?: string, sg_timeout?: `${bigint}`) => {
	a_msgs.map(atu8_msg => k_writer.uint32(10).bytes(atu8_msg));

	if(s_memo) k_writer.uint32(18).string(s_memo);

	if(sg_timeout) k_writer.uint32(24).uint64(BigInt(sg_timeout));

	return k_writer;
};

/**
 * SignDoc
 */
const encode_signdoc = (
	k_writer: ProtoWriter,
	atu8_body: Uint8Array,
	atu8_auth: Uint8Array,
	si_chain: string,
	sg_account: Nilable<`${bigint}`>
) => {
	k_writer
		.uint32(10).bytes(atu8_body)
		.uint32(18).bytes(atu8_auth)
		.uint32(26).string(si_chain);

	if(sg_account) k_writer.uint32(32).uint64(BigInt(sg_account));

	return k_writer;
};

/**
 * TxRaw
 */
const encode_txraw = (k_writer: ProtoWriter, atu8_body: Uint8Array, atu8_auth: Uint8Array, a_signatures: Uint8Array[]) => {
	k_writer
		.uint32(10).bytes(atu8_body)
		.uint32(18).bytes(atu8_auth);

	a_signatures.map(atu8_sig => k_writer.uint32(26).bytes(atu8_sig));

	return k_writer;
};

export enum SignModeName {
	UNSPECIFIED = 'SIGN_MODE_UNSPECIFIED',
	DIRECT = 'SIGN_MODE_DIRECT',
	TEXTUAL = 'SIGN_MODE_TEXTUAL',
	DIRECT_AUX = 'SIGN_MODE_DIRECT_AUX',
	AMINO = 'SIGN_MODE_LEGACY_AMINO_JSON',
	EIP_191 = 'SIGN_MODE_EIP_191',
}

export type Base64 = string;
export type Hexadecimal = string;

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
	gas_used: `${bigint}`;
	gas_wanted: `${bigint}`;
	height: `${bigint}`;
	info: string;
	logs: [];
	raw_log: string;
	timestamp: string;
	tx: {
		auth_info: {
			fee: {
				amount: Coin[];
				gas_limit: `${bigint}`;
				granter: SecretBech32 | '';
				payer: SecretBech32 | '';
			};
			signer_infos: {
				mode_info: {
					single: {
						mode: SignModeName;
					};
				} | {
					multi: unknown;
				};
				public_key: {
					type_url: '/cosmos.crypto.secp256k1.PubKey';
					value: Base64;
				};
				sequence: `${bigint}`;
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
			timeout_height: `${bigint}`;
		};
		signatures: Base64[];
	};
	txhash: Hexadecimal;
}

export interface Wallet {
	bech32: SecretBech32;

	signDirect(
		a_msgs: Uint8Array[],
		a_fees: SlimCoin[],
		sg_limit: `${bigint}`,
		sa_granter?: Nilable<SecretBech32> | '',
		sa_payer?: Nilable<SecretBech32> | '',
	): Promise<[
		atu8_tx_raw: Uint8Array,
		atu8_signdoc: Uint8Array,
		si_txn: string,
	]>;

	broadcast(atu8_raw: Uint8Array): Promise<TxResponse>;
}

export const pubkey_to_bech32 = async<
	s_hrp extends `secret${string}`='secret',
>(atu8_pk_33: Uint8Array, s_hrp: s_hrp='secret' as s_hrp): Promise<SecretBech32<s_hrp>> => {
	// sha-256 hash of pubkey
	const atu8_sha256 = await sha256(atu8_pk_33);

	// ripemd-160 hash of that
	const atu8_ripemd160 = ripemd160(atu8_sha256);

	// encode to bech32
	return bech32Encode(s_hrp, atu8_ripemd160) as SecretBech32<s_hrp>;
};

export const wallet = async(k_querier: LcdQueryClient, si_chain: string, atu8_sk: Uint8Array): Promise<Wallet> => {
	// obtain public key
	const atu8_pk33 = sk_to_pk(atu8_sk);

	// convert to bech32
	const sa_account = await pubkey_to_bech32(atu8_pk33);

	return {
		bech32: sa_account,

		async signDirect(a_msgs, a_fees, sg_limit, sa_granter='') {
			// fetch auth data
			let g_account!: AccountResponse | undefined;
			try {
				g_account = (await k_querier.auth.accounts(sa_account))[0];
			}
			catch(e_auth) {}

			// destructure auth data
			const sg_account = g_account?.account_number;
			const sg_sequence = g_account?.sequence;

			// encode pubkey
			const atu8_pubkey = any(
				'/cosmos.crypto.secp256k1.PubKey',
				protobuf().uint32(10).bytes(atu8_pk33).out()
			);

			// encode signer info
			const atu8_signer = encode_signerinfo(protobuf(), atu8_pubkey, sg_sequence || '0').out();


			// encode fee
			const atu8_fee = encode_fee(protobuf(), a_fees, sg_limit, sa_granter).out();


			// encode auth info
			const atu8_auth = encode_authinfo(protobuf(), [atu8_signer], atu8_fee).out();


			// encode tx body bytes
			const atu8_body = encode_txbody(protobuf(), a_msgs).out();

			// encode signdoc
			const atu8_doc = encode_signdoc(protobuf(), any('/cosmos.tx.v1beta1.TxBody', atu8_body), atu8_auth, si_chain, sg_account).out();


			// hash message
			const atu8_hash = await sha256(atu8_doc);

			// sign message hash
			const [atu8_signature] = await sign(atu8_sk, atu8_hash);

			// encode txraw
			const atu8_raw = encode_txraw(protobuf(), atu8_body, atu8_auth, [atu8_signature]).out();

			// compute transaction hash id
			const si_tx = buffer_to_hex(await sha256(atu8_raw)).toUpperCase();

			return [atu8_raw, atu8_doc, si_tx];
		},

		async broadcast(atu8_raw) {
			const d_res = await fetch(k_querier._p_origin+'/cosmos/tx/v1beta1/txs', {
				method: 'POST',
				body: JSON.stringify({
					mode: 'BROADCAST_MODE_BLOCK',
					txBytes: buffer_to_base64(atu8_raw),
				}),
			});

			const s_res_text = await d_res.text();

			console.log(s_res_text);

			const g_response = JSON.parse(s_res_text);

			debugger;
			console.log(g_response);

			return g_response as TxResponse;
		},
	};
};
