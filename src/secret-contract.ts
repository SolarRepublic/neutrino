/* eslint-disable no-console, prefer-const */

import type {O} from 'ts-toolbelt';

import type {TxResponseTuple} from './app-layer';
import type {CosmosSigner} from './cosmos-signer';
import type {ContractInfo, RemoteServiceArg} from './types';
import type {Dict, JsonObject, Nilable} from '@blake.regalia/belt';
import type {SecretAccAddr, ContractInterface} from '@solar-republic/contractor';
import type {CosmosClientLcd, RequestDescriptor} from '@solar-republic/cosmos-grpc';
import type {SecretComputeContractInfo} from '@solar-republic/cosmos-grpc/secret/compute/v1beta1/types';
import type {CwHexLower, CwSecretAccAddr, CwUint32, RemoteServiceDescriptor, SlimCoin, TrustedContextUrl, WeakSecretAccAddr, WeakUintStr} from '@solar-republic/types';

import {__UNDEFINED, base64_to_bytes, base64_to_text, bytes, bytes_to_hex, bytes_to_text, gunzip_bytes, is_function, is_string, parse_json, sha256, stringify_json} from '@blake.regalia/belt';

import {decodeCosmosBaseAbciTxMsgData} from '@solar-republic/cosmos-grpc/cosmos/base/abci/v1beta1/abci';
import {encodeGoogleProtobufAny, type EncodedGoogleProtobufAny} from '@solar-republic/cosmos-grpc/google/protobuf/any';
import {SI_MESSAGE_TYPE_SECRET_COMPUTE_MSG_EXECUTE_CONTRACT, SI_MESSAGE_TYPE_SECRET_COMPUTE_MSG_INSTANTIATE_CONTRACT, SI_MESSAGE_TYPE_SECRET_COMPUTE_MSG_STORE_CODE, decodeSecretComputeMsgInstantiateContractResponse, decodeSecretComputeMsgStoreCodeResponse, encodeSecretComputeMsgExecuteContract, encodeSecretComputeMsgInstantiateContract, encodeSecretComputeMsgStoreCode} from '@solar-republic/cosmos-grpc/secret/compute/v1beta1/msg';
import {destructSecretComputeQueryCodeHashResponse, destructSecretComputeQueryContractInfoResponse, destructSecretComputeQuerySecretContractResponse, querySecretComputeCodeHashByCodeId, querySecretComputeCodes, querySecretComputeContractInfo, querySecretComputeQuerySecretContract} from '@solar-republic/cosmos-grpc/secret/compute/v1beta1/query';
import {destructSecretRegistrationKey} from '@solar-republic/cosmos-grpc/secret/registration/v1beta1/msg';
import {querySecretRegistrationTxKey} from '@solar-republic/cosmos-grpc/secret/registration/v1beta1/query';

import {normalize_lcd_client, remote_service} from './_common';
import {broadcast_result} from './app-layer';
import {GC_NEUTRINO} from './config.js';
import {create_and_sign_tx_direct} from './cosmos-signer';
import {secret_response_decrypt} from './secret-response';
import {SecretWasm} from './secret-wasm.js';
import {successful} from './util.js';


export type KnownContractInfo = O.Required<SecretComputeContractInfo, 'code_id' | 'label'>;

export type SecretNetworkInfo = [
	k_wasm: SecretWasm,
	atu8_conspk: Uint8Array,
];

// cache of Secret WASM code info
const h_codes_cache: Record<ContractInfo['code_id'], CwHexLower> = {};

// cache of Secret contract info
const h_contract_cache: Record<WeakSecretAccAddr, KnownContractInfo> = {};

// cache of persistent fields associated with network
const h_networks = {} as Dict<SecretNetworkInfo>;


/**
 * Stores intermediate values during the process of querying a Secret contract
 */
export interface SecretContractQueryIntermediates {
	/**
	 * The nonce that was used to encrypt the query
	 */
	n?: Uint8Array;
}


export type SecretContract<
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	g_interface extends ContractInterface=ContractInterface,
> = {
	/**
	 * Cosmos Client LCD
	 */
	lcd: CosmosClientLcd;

	/**
	 * Contract address
	 */
	addr: SecretAccAddr;

	/**
	 * Contract's label, code id, and creator
	 */
	info: KnownContractInfo;

	/**
	 * Code hash
	 */
	hash: CwHexLower;

	/**
	 * the {@link SecretWasm} instance
	 */
	wasm: SecretWasm;

	/**
	 * Queries a contract and returns the parsed JSON response
	 * @param h_query - the query JSON as an object
	 * @param g_out - optional object to store intermediate results (such as the nonce) into
	 * @returns tuple of `[number, string, JsonObject?]` where:
	 *  - [0]: `xc_code: number` - error code from chain, or non-OK HTTP status code from the LCD server.
	 * 		A value of `0` indicates success.
	 *  - [1]: `s_error: string | undefined` - error message from chain or HTTP response body
	 *  - [3]: `d_res: Response` - HTTP response object
	 *  - [4]: `h_answer?: JsonObject` - contract response as JSON object on success
	 */
	query(h_query: JsonObject, g_out?: SecretContractQueryIntermediates): Promise<[
		xc_code: number,
		s_error: string,
		d_res: Response,
		g_result: JsonObject,
	]>;

	/**
	 * Construct a contract execution message
	 * @param h_exec 
	 * @param sa_sender 
	 * @param a_funds 
	 * @returns 
	 */
	exec(h_exec: JsonObject, sa_sender: WeakSecretAccAddr, a_funds?: SlimCoin[]): Promise<[
		atu8_data: EncodedGoogleProtobufAny,
		atu8_nonce: Uint8Array,
	]>;
};

/**
 * Bypass the contract cache
 */
export const XC_CONTRACT_CACHE_BYPASS = 0;

/**
 * Accept and use the contract cache
 */
export const XC_CONTRACT_CACHE_ACCEPT = 1;

/**
 * Describes how to use the contract cache when creating a contract handle
 */
export type ContractCacheOption = typeof XC_CONTRACT_CACHE_BYPASS | typeof XC_CONTRACT_CACHE_ACCEPT;

// retrieves network info from cache or from chain
const retrieve_network_info = async(
	z_lcd: CosmosClientLcd | RemoteServiceArg,
	atu8_seed?: Nilable<Uint8Array>
): Promise<SecretNetworkInfo> => {
	// uniquely identify this request pattern
	let si_lcd = stringify_json(is_string(z_lcd)
		? [z_lcd, '', '']
		: is_string((z_lcd as CosmosClientLcd).id)
			? [(z_lcd as CosmosClientLcd).id, '', '']
			: [
				(z_lcd as RemoteServiceDescriptor).origin,
				(z_lcd as RemoteServiceDescriptor).headers,
				(z_lcd as RemoteServiceDescriptor).redirect,
			].map(s => s || '')
	);

	// try loading entry from cache
	let a2_cached = h_networks[si_lcd];

	// network not yet cached
	if(!a2_cached) {
		// fetch consensus io pubkey
		let g_res_reg = await successful(querySecretRegistrationTxKey, z_lcd);

		// destructure response
		let [atu8_consensus_pk] = destructSecretRegistrationKey(g_res_reg);

		// instantiate default secret wasm using random seed and save to cache
		h_networks[si_lcd] = a2_cached = [
			SecretWasm(atu8_consensus_pk!),
			atu8_consensus_pk!,
		];
	}

	// entuple result
	return [
		// custom seed specified...
		atu8_seed
			// ...create new instance
			? SecretWasm(a2_cached[1], atu8_seed)
			// no custom seed; re-use default WASM instance
			: a2_cached[0],
		// consensus public key
		a2_cached[1],
	];
};

/**
 * Creates a low-level handle for a Secret Contract. Accepts contract info as an argument, or how to use
 * the cache. If no info is provided or cached, or the cache is bypassed, then it queries the chain for
 * the contract's code hash and info.
 * 
 * The `query` and `exec` methods are not intended for general application use; projects should instead use
 * {@link query_secret_contract_raw} and {@link exec_secret_contract}.
 * @param z_lcd 
 * @param sa_contract 
 * @param atu8_seed 
 * @returns 
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const SecretContract = async<
	g_interface extends ContractInterface=ContractInterface,
>(
	z_lcd: CosmosClientLcd | RemoteServiceArg,
	sa_contract: WeakSecretAccAddr,
	atu8_seed?: Nilable<Uint8Array>,
	a_block_sizes?: [nb_block_query?: number, nb_block_exec?: number],
	z_info: KnownContractInfo|ContractCacheOption=XC_CONTRACT_CACHE_ACCEPT
): Promise<SecretContract<g_interface>> => {
	// normalize client
	const ylc_client = normalize_lcd_client(z_lcd);

	// retrieve Secret network info
	const [k_wasm] = await retrieve_network_info(ylc_client, atu8_seed);

	// ref contract info
	let g_info = XC_CONTRACT_CACHE_ACCEPT === z_info? h_contract_cache[sa_contract]: z_info;
	if(!g_info) {
		// refload contract info
		let g_res_info = await successful(querySecretComputeContractInfo, ylc_client, sa_contract);

		// destruct response
		let [, g_info1] = destructSecretComputeQueryContractInfoResponse(g_res_info);

		// update
		g_info = h_contract_cache[sa_contract] = g_info1 as KnownContractInfo;
	}

	// ref code id
	const sg_code = g_info.code_id!;

	// ref code hash
	let sb16_code_hash = h_codes_cache[sg_code];
	if(!sb16_code_hash) {
		// refload code hash
		let g_res_hash = await successful(querySecretComputeCodeHashByCodeId, ylc_client, sg_code);

		// destruct response
		sb16_code_hash = h_codes_cache[sg_code] = destructSecretComputeQueryCodeHashResponse(g_res_hash)[0]!;
	}


	// properties and methods
	return {
		// lcd endpoint
		lcd: ylc_client,

		// contract address
		addr: sa_contract as SecretAccAddr,

		// expose info
		info: g_info,

		// code hash
		hash: sb16_code_hash,

		// wasm instance
		wasm: k_wasm,

		// query contract
		// @ts-expect-error typed in interface
		async query(h_query, g_out={}) {
			// encrypt and encode query msg
			const atu8_msg = await k_wasm.encodeMsg(sb16_code_hash, h_query, a_block_sizes?.[0] ?? GC_NEUTRINO.PAD_QUERY);

			// extract nonce
			const atu8_nonce = g_out.n = atu8_msg.slice(0, 32);

			// submit query
			let [g_res_query, g_err_query, d_res_query, s_res_query] = await querySecretComputeQuerySecretContract(ylc_client, sa_contract, atu8_msg);

			// success
			if(g_res_query) {
				// destructure
				const [atu8_ciphertext] = destructSecretComputeQuerySecretContractResponse(g_res_query);

				// decrypt response
				const atu8_plaintext = await k_wasm.decrypt(atu8_ciphertext!, atu8_nonce);

				// decode result
				const sb64_response = bytes_to_text(atu8_plaintext);
				const sx_result = base64_to_text(sb64_response);

				// return response and json
				return [0, __UNDEFINED, d_res_query, parse_json(sx_result)];
			}
			// contract error
			else if(g_err_query) {
				// destructure as error
				let {
					code: xc_code,
					message: s_message,
				} = g_err_query;

				// ensure non-zero
				xc_code ||= -1 as CwUint32;

				// encrypted error message
				const m_error = /encrypted: ([\w+/=]+)/.exec(s_message || '');
				if(m_error) {
					// decode base64 string
					const atu8_ciphertext = base64_to_bytes(m_error[1]);

					// decrypt the ciphertext
					const atu8_plaintext = await k_wasm.decrypt(atu8_ciphertext, atu8_nonce);

					// decode
					const sx_plaintext = bytes_to_text(atu8_plaintext);

					// return tuple
					return [xc_code, sx_plaintext, d_res_query];
				}

				// plaintext error
				return [xc_code, s_message, d_res_query];
			}

			// some other error
			return [d_res_query.status, s_res_query, d_res_query];
		},

		// execute contract
		async exec(h_exec, sa_sender, a_funds=[]) {
			// encrypt and encode execution body
			const atu8_body = await k_wasm.encodeMsg(sb16_code_hash, h_exec, a_block_sizes?.[1] ?? GC_NEUTRINO.PAD_EXEC);

			// extract nonce
			const atu8_nonce = atu8_body.slice(0, 32);

			// return tuple
			return [
				encodeGoogleProtobufAny(
					SI_MESSAGE_TYPE_SECRET_COMPUTE_MSG_EXECUTE_CONTRACT,
					encodeSecretComputeMsgExecuteContract(sa_sender, sa_contract, atu8_body, __UNDEFINED, a_funds)
				),
				atu8_nonce,
			];
		},
	};
};


/**
 * Uploads the given Secret WASM bytecode to the chain, short-circuiting if the code already exists
 * @param k_wallet 
 * @param atu8_wasm - WASMByteCode can be raw or gzip compressed
 * @param a_options - an optional tuple of properties to attach to the uploaded code where:
 *  - 0: `s_source?: string` - a valid absolute HTTPS URI to the contract's source code
 *  - 1: `s_builder?: string` - a valid docker image name with tag
 * @returns 
 */
export async function secret_contract_upload_code(
	k_wallet: CosmosSigner,
	atu8_wasm: Uint8Array,
	z_limit: bigint | WeakUintStr,
	[s_source, s_builder]: [
		s_source?: TrustedContextUrl,
		s_builder?: `${string}/${string}:${string}`,
	]=[],
	s_memo?: string,
	sa_granter?: WeakSecretAccAddr,
	ylc_client: CosmosClientLcd | RequestDescriptor=k_wallet.lcd
): Promise<[
	sg_code_id: undefined | WeakUintStr,
	sb16_hash: CwHexLower,
	a6_broadcast?: TxResponseTuple,
	]> {
	// decompressed bytecode
	let atu8_bytecode = atu8_wasm;

	// gzip-encoded; decompress
	if(0x1f === atu8_wasm[0] && 0x8b === atu8_wasm[1]) {
		atu8_bytecode = await gunzip_bytes(atu8_wasm);
	}

	// hash raw bytecode
	const atu8_hash = await sha256(atu8_bytecode);
	const sb16_hash = bytes_to_hex(atu8_hash);

	// fetch all uploaded codes
	const g_codes = await successful(querySecretComputeCodes, ylc_client);

	// already uploaded
	const g_existing = g_codes?.code_infos?.find(g => g.code_hash === sb16_hash);
	if(g_existing) {
		// debug
		if(import.meta.env?.DEV) {
			console.debug(`🔦 Found matching code ID ${g_existing.code_id} already uploaded to network`);
		}

		// entuple result
		return [
			g_existing.code_id as WeakUintStr,
			sb16_hash,
		];
	}

	// encode message
	const atu8_msg = encodeGoogleProtobufAny(
		SI_MESSAGE_TYPE_SECRET_COMPUTE_MSG_STORE_CODE,
		encodeSecretComputeMsgStoreCode(
			k_wallet.addr,
			atu8_wasm,
			s_source,
			s_builder
		)
	);

	// sign in direct mode
	const [atu8_tx_raw, si_txn] = await create_and_sign_tx_direct(
		k_wallet,
		[atu8_msg],
		z_limit,
		__UNDEFINED,
		0,
		s_memo,
		sa_granter
	);

	// debug info
	if(import.meta.env?.DEV) {
		console.groupCollapsed(`📦 Uploading ${Math.round(atu8_wasm.length / 1024)}kib contract bytecode...`);
		console.debug([
			`Uploading contract code of ${atu8_wasm.length} bytes from ${k_wallet.addr}`,
			`  limit: ${z_limit} ┃ hash: ${si_txn}`+(sa_granter? ` ┃ granter: ${sa_granter}`: '')+(s_memo? ` ┃ memo: ${s_memo}`: ''),
		].join('\n'));
		console.groupEnd();
	}

	// broadcast to chain and detuple result
	const a6_broadcast = await broadcast_result(k_wallet, atu8_tx_raw, si_txn);

	// detuple
	const [xc_code, sx_res,, g_meta,, atu8_data] = a6_broadcast;

	// non-zero response code
	if(xc_code) {
		// debug
		if(import.meta.env?.DEV) {
			console.groupCollapsed(`❌ Upload failed [code: ${xc_code}]`);
			console.debug('meta: ', g_meta);
			console.debug('res: ', sx_res);
			console.groupEnd();
		}

		// set error text
		a6_broadcast[1] = g_meta?.log ?? sx_res;

		// exit with error result
		return [__UNDEFINED, sb16_hash, a6_broadcast];
	}

	// decode message responses
	const [, [[, atu8_response]=[]]=[]] = decodeCosmosBaseAbciTxMsgData(atu8_data!);

	// decode response
	const [sg_code_id] = decodeSecretComputeMsgStoreCodeResponse(atu8_response!);

	// debug info
	if(import.meta.env?.DEV) {
		console.groupCollapsed(`✅ Upload succeeded`);

		if(g_meta) {
			const {
				gas_used: sg_used,
				gas_wanted: sg_wanted,
			} = g_meta;

			console.debug(`gas used/wanted: ${sg_used}/${sg_wanted}  (${+sg_wanted - +sg_used}) wasted)`);
		}

		console.debug('code ID: ', sg_code_id);
		console.debug('meta: ', g_meta);
		console.debug('txhash: ', si_txn);
		console.groupEnd();
	}

	// entuple result
	return [
		sg_code_id,
		sb16_hash,
		a6_broadcast,
	];
}


/**
 * Instantiates the given code into a contract
 * @param k_wallet 
 * @param sg_code_id 
 * @param h_init_msg 
 * @returns 
 */
export const secret_contract_instantiate = async(
	k_wallet: CosmosSigner,
	sg_code_id: WeakUintStr,
	h_init_msg: JsonObject,
	zg_limit: bigint|WeakUintStr,
	[
		sa_admin,
		s_label,
		a_funds,
	]: [
		sa_admin?: Nilable<WeakSecretAccAddr | ''>,
		s_label?: Nilable<string>,
		a_funds?: SlimCoin[],
	]=[],
	[
		s_memo,
		sa_granter,
	]: [
		s_memo?: string,
		sa_granter?: WeakSecretAccAddr|'',
	]=[],
	atu8_seed?: Nilable<Uint8Array>,
	g_out: SecretContractQueryIntermediates={}
): Promise<[
	a_response: undefined | [
		sa_contract: CwSecretAccAddr,
		readonly [
			s_plaintext: string,
			g_answer?: undefined | JsonObject,
		],
	],
	a6_broadcast: TxResponseTuple,
]> => {
	// retrieve Secret network info
	const [k_wasm] = await retrieve_network_info(k_wallet.lcd, atu8_seed);

	// ref code hash
	let sb16_code_hash = h_codes_cache[sg_code_id];
	if(!sb16_code_hash) {
		// refload code hash
		let g_res_hash = await successful(querySecretComputeCodeHashByCodeId, k_wallet.lcd, sg_code_id);

		// destruct response
		sb16_code_hash = h_codes_cache[sg_code_id] = destructSecretComputeQueryCodeHashResponse(g_res_hash)[0]!;
	}

	// encrypt init message
	const atu8_body = await k_wasm.encodeMsg(sb16_code_hash, h_init_msg);

	// extract nonce
	const atu8_nonce = g_out.n = atu8_body.slice(0, 32);

	// encode instantiation message
	const atu8_msg = encodeGoogleProtobufAny(
		SI_MESSAGE_TYPE_SECRET_COMPUTE_MSG_INSTANTIATE_CONTRACT,
		encodeSecretComputeMsgInstantiateContract(
			k_wallet.addr,
			null,
			sg_code_id,
			s_label || h_init_msg['name'] as string,
			atu8_body,
			a_funds,
			__UNDEFINED,
			sa_admin
		)
	);

	// sign in direct mode
	const [atu8_tx_raw, si_txn] = await create_and_sign_tx_direct(
		k_wallet,
		[atu8_msg],
		zg_limit,
		__UNDEFINED,
		0,
		s_memo,
		sa_granter
	);

	// debug info
	if(import.meta.env?.DEV) {
		console.groupCollapsed(`🛞 Instantiating code ID ${sg_code_id}...`);
		console.debug([
			`Instantiating code ID ${sg_code_id} with ${stringify_json(h_init_msg)}`,
			`  limit: ${zg_limit} ┃ hash: ${si_txn}`+(sa_granter? ` ┃ granter: ${sa_granter}`: '')+(s_memo? ` ┃ memo: ${s_memo}`: ''),
		].join('\n'));
		console.groupEnd();
	}

	// broadcast to chain
	const a6_broadcast = await broadcast_result(k_wallet, atu8_tx_raw, si_txn);

	// detuple broadcast result
	const [xc_error, sx_res,, g_meta, h_events, atu8_data] = a6_broadcast;

	// invalid json
	if(xc_error < 0) return [__UNDEFINED, a6_broadcast];

	// decrypt response
	const [a_error, a_responses] = await secret_response_decrypt(k_wasm, a6_broadcast, [atu8_nonce]);

	// non-zero response code
	if(xc_error) {
		// debug
		if(import.meta.env?.DEV) {
			console.groupCollapsed(`❌ Instantiation failed [code: ${xc_error}]`);
			console.debug('meta: ', g_meta);
			console.debug('res: ', sx_res);
			console.groupEnd();
		}

		// set error text
		a6_broadcast[1] = a_error?.[0] ?? g_meta?.log ?? sx_res;

		// return error
		return [__UNDEFINED, a6_broadcast];
	}

	// detuple response grouop for first and only message response
	const [[a2_result,, atu8_response]] = a_responses!;

	// decode response
	const [sa_contract] = decodeSecretComputeMsgInstantiateContractResponse(atu8_response!);

	// debug info
	if(import.meta.env?.DEV) {
		console.groupCollapsed(`✅ Instantiation succeeded`);

		if(g_meta) {
			const {
				gas_used: sg_used,
				gas_wanted: sg_wanted,
			} = g_meta;

			console.debug(`gas used/wanted: ${sg_used}/${sg_wanted}  (${+sg_wanted - +sg_used}) wasted)`);
		}

		console.debug('meta: ', g_meta);
		console.debug('txhash: ', si_txn);
		console.groupEnd();
	}

	// return entupled result
	return [
		[sa_contract as CwSecretAccAddr, a2_result],
		a6_broadcast,
	];
};

