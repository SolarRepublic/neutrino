/* eslint-disable prefer-const */
import type {Required} from 'ts-toolbelt/out/Object/Required.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type {query_secret_contract} from './app-layer.js';
import type {ContractInfo, WeakSecretAccAddr} from './types.js';

import type {JsonObject, Nilable} from '@blake.regalia/belt';

import type {SecretAccAddr, ContractInterface} from '@solar-republic/contractor';
import type {SecretComputeContractInfo} from '@solar-republic/cosmos-grpc/secret/compute/v1beta1/types';
import type {CwHexLower, SlimCoin, TrustedContextUrl} from '@solar-republic/types';

import {__UNDEFINED, base64_to_text, bytes_to_text} from '@blake.regalia/belt';

import {any} from '@solar-republic/cosmos-grpc';
import {encodeSecretComputeMsgExecuteContract} from '@solar-republic/cosmos-grpc/secret/compute/v1beta1/msg';
import {destructSecretComputeQueryCodeHashResponse, destructSecretComputeQueryContractInfoResponse, destructSecretComputeQuerySecretContractResponse, querySecretComputeCodeHashByCodeId, querySecretComputeContractInfo, querySecretComputeQuerySecretContract} from '@solar-republic/cosmos-grpc/secret/compute/v1beta1/query';
import {destructSecretRegistrationKey} from '@solar-republic/cosmos-grpc/secret/registration/v1beta1/msg';
import {querySecretRegistrationTxKey} from '@solar-republic/cosmos-grpc/secret/registration/v1beta1/query';

import {SecretWasm} from './secret-wasm.js';


export type KnownContractInfo = Required<SecretComputeContractInfo, 'code_id' | 'label'>;

// pads all query messages to be multiples of this many bytes
const NB_QUERY_BLOCK = 64;

// pads all execution messages to be multiples of this many bytes
const NB_EXEC_BLOCK = 0;

const h_codes_cache: Record<ContractInfo['code_id'], CwHexLower> = {};

const h_contract_cache: Record<WeakSecretAccAddr, KnownContractInfo> = {};

const h_networks = {} as Record<TrustedContextUrl, {
	wasm: SecretWasm;
	conspk: Uint8Array;
}>;


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
	g_interface extends ContractInterface=ContractInterface,
> = {
	/**
	 * URL of the LCD endpoint
	 */
	lcd: TrustedContextUrl;

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
	 * @returns the parsed response JSON object of a successful query
	 * @throws a tuple of `[Response, string, JsonObject?]` where:
	 * 	- 0: d_res - the {@link Response}` object
	 * 	- 1: s_res - the response body as text
	 *    - 2?: g_res - the parsed response response JSON if valid
	 */
	query(h_query: JsonObject, g_out?: SecretContractQueryIntermediates): Promise<JsonObject>;
	// query<
	// 	h_variants extends ContractInterface.MsgAndAnswer<g_interface, 'queries'>,
	// 	g_variant extends h_variants[keyof h_variants],
	// >(h_query: g_variant['msg'], g_out?: QueryIntermediates): Promise<g_variant['answer']>;

	/**
	 * Construct a contract execution message
	 * @param h_exec 
	 * @param sa_sender 
	 * @param a_funds 
	 * @returns 
	 */
	exec(h_exec: JsonObject, sa_sender: WeakSecretAccAddr, a_funds?: SlimCoin[]): Promise<[
		atu8_data: Uint8Array,
		atu8_nonce: Uint8Array,
	]>;
};


/**
 * Creates a low-level handle for a Secret Contract. Immediately queries the chain for the contract's code hash
 * and info unless already cached.
 * 
 * The `query` and `exec` methods are not intended for general application use; projects should instead use
 * {@link query_secret_contract} and {@link exec_secret_contract}.
 * @param p_lcd 
 * @param sa_contract 
 * @param atu8_seed 
 * @returns 
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const SecretContract = async<
	g_interface extends ContractInterface=ContractInterface,
>(
	p_lcd: TrustedContextUrl,
	sa_contract: WeakSecretAccAddr,
	atu8_seed: Nilable<Uint8Array>=null
): Promise<SecretContract<g_interface>> => {
	// try loading entry from cache
	let g_cached = h_networks[p_lcd];

	// network not yet cached
	if(!g_cached) {
		// fetch consensus io pubkey
		let [,, g_res] = await querySecretRegistrationTxKey(p_lcd);

		// destructure response
		let [atu8_consensus_pk] = destructSecretRegistrationKey(g_res);

		// instantiate default secret wasm using random seed and save to cache
		h_networks[p_lcd] = g_cached = {
			wasm: SecretWasm(atu8_consensus_pk!),
			conspk: atu8_consensus_pk!,
		};
	}

	// custom seed specified...
	const k_wasm = atu8_seed
		// ...create instance
		? SecretWasm(g_cached.conspk, atu8_seed)
		// no custom seed; re-use default wasm instance
		: g_cached.wasm;

	// ref contract info
	let g_info = h_contract_cache[sa_contract];
	if(!g_info) {
		// refload contract info
		let [,, g_res_info] = await querySecretComputeContractInfo(p_lcd, sa_contract);

		// destruct response
		let [, g_info1] = destructSecretComputeQueryContractInfoResponse(g_res_info);

		// update
		g_info = h_contract_cache[sa_contract] = g_info1 as KnownContractInfo;
	}

	// ref code id
	const si_code = g_info.code_id!;  // eslint-disable-line @typescript-eslint/no-unnecessary-type-assertion

	// ref code hash
	let sb16_code_hash = h_codes_cache[si_code];
	if(!sb16_code_hash) {
		// refload code hash
		let [,, g_res_hash] = await querySecretComputeCodeHashByCodeId(p_lcd, si_code);

		// destruct response
		sb16_code_hash = h_codes_cache[si_code] = destructSecretComputeQueryCodeHashResponse(g_res_hash)[0]!;
	}


	// methods
	return {
		// lcd endpoint
		lcd: p_lcd,

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
			const atu8_msg = await k_wasm.encodeMsg(sb16_code_hash, h_query, NB_QUERY_BLOCK);

			// extract nonce
			const atu8_nonce = g_out.n = atu8_msg.slice(0, 32);

			// submit query
			let [,, g_res_query] = await querySecretComputeQuerySecretContract(p_lcd, sa_contract, atu8_msg);

			// destructure
			const [atu8_ciphertext] = destructSecretComputeQuerySecretContractResponse(g_res_query);

			// decrypt response
			const atu8_plaintext = await k_wasm.decrypt(atu8_ciphertext!, atu8_nonce);

			// decode result
			const sb64_response = bytes_to_text(atu8_plaintext);
			const sx_result = base64_to_text(sb64_response);

			// return response and json
			return JSON.parse(sx_result);
		},

		// execute contract
		async exec(h_exec, sa_sender, a_funds=[]) {
			// encrypt and encode execution body
			const atu8_body = await k_wasm.encodeMsg(sb16_code_hash, h_exec, NB_EXEC_BLOCK);

			// extract nonce
			const atu8_nonce = atu8_body.slice(0, 32);

			// construct body
			const atu8_exec = encodeSecretComputeMsgExecuteContract(sa_sender, sa_contract, atu8_body, __UNDEFINED, a_funds);

			// construct as direct message
			const atu8_msg = any('/secret.compute.v1beta1.MsgExecuteContract', atu8_exec);

			// return tuple
			return [atu8_msg, atu8_nonce];
		},
	};
};
