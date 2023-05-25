import type {query_contract, exec_contract} from './app-layer';

import type {ContractInfo, SecretBech32, HttpsUrl as HttpsUrl, SlimCoin} from './types';

import {base64_to_text, type HexLower, type JsonObject, type Nilable} from '@blake.regalia/belt';

import {buffer_to_text} from '@blake.regalia/belt';

import {bech32_decode} from './bech32';
import {queryComputeInfo, queryComputeCodeHashByCodeId, queryComputeQuery} from './lcd/compute';
import {queryRegistrationTxKey} from './lcd/registration';
import {any, coin, Protobuf} from './protobuf-writer';
import {SecretWasm} from './secret-wasm';


// pads all query messages to be multiples of this many bytes
const NB_QUERY_BLOCK = 64;

// pads all execution messages to be multiples of this many bytes
const NB_EXEC_BLOCK = 0;

const h_codes_cache: Record<ContractInfo['code_id'], HexLower> = {};

const h_contract_cache: Record<SecretBech32, ContractInfo> = {};

const h_networks: Record<HttpsUrl, SecretWasm> = {};


export interface QueryIntermediates {
	/**
	 * The nonce that was used to encrypt the query
	 */
	n?: Uint8Array;
}


export interface SecretContract {
	/**
	 * URL of the LCD endpoint
	 */
	lcd: HttpsUrl;

	/**
	 * Contract address
	 */
	addr: SecretBech32;

	/**
	 * Contract's label, code id, and creator
	 */
	info: ContractInfo;

	/**
	 * Code hash
	 */
	hash: string;

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
	query<w_out extends object=JsonObject>(h_query: JsonObject, g_out?: QueryIntermediates): Promise<w_out>;

	/**
	 * Construct a contract execution message
	 * @param h_exec 
	 * @param sa_sender 
	 * @param a_funds 
	 * @returns 
	 */
	exec(h_exec: JsonObject, sa_sender: SecretBech32, a_funds?: SlimCoin[]): Promise<[
		atu8_data: Uint8Array,
		atu8_nonce: Uint8Array,
	]>;
}


/**
 * Creates a low-level handle for a Secret Contract. Immediately queries the chain for the contract's code hash
 * and info unless already cached.
 * 
 * The `query` and `exec` methods are not intended for general application use; projects should instead use
 * {@link query_contract} and {@link exec_contract}.
 * @param p_lcd 
 * @param sa_contract 
 * @param atu8_seed 
 * @returns 
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const SecretContract = async(p_lcd: HttpsUrl, sa_contract: SecretBech32, atu8_seed: Nilable<Uint8Array>=null): Promise<SecretContract> => {
	// try loading instance from cache
	let k_wasm = h_networks[p_lcd];

	// network not yet cached
	if(!k_wasm) {
		// fetch consensus io pubkey
		const atu8_consensus_pk = await queryRegistrationTxKey(p_lcd);

		// instantiate secret wasm and save to cache
		h_networks[p_lcd] = k_wasm = SecretWasm(atu8_consensus_pk, atu8_seed);
	}

	// refload contract info
	const g_info = h_contract_cache[sa_contract] = h_contract_cache[sa_contract] || await queryComputeInfo(p_lcd, sa_contract);

	// ref code id
	const si_code = g_info.code_id;

	// refload code hash
	const sb16_code_hash = h_codes_cache[si_code] = h_codes_cache[si_code] || await queryComputeCodeHashByCodeId(p_lcd, si_code);

	// decode contract address
	const atu8_contract = bech32_decode(sa_contract);

	// methods
	return {
		// lcd endpoint
		lcd: p_lcd,

		// contract address
		addr: sa_contract,

		// expose info
		info: g_info,

		// code hash
		hash: sb16_code_hash,

		// wasm instance
		wasm: k_wasm,

		// query contract
		async query(h_query, g_out={}) {
			// encrypt and encode query msg
			const atu8_msg = await k_wasm.encodeMsg(sb16_code_hash, h_query, NB_QUERY_BLOCK);

			// extract nonce
			const atu8_nonce = g_out.n = atu8_msg.slice(0, 32);

			// submit query
			const atu8_ciphertext = await queryComputeQuery(p_lcd, sa_contract, atu8_msg);

			// decrypt response
			const atu8_plaintext = await k_wasm.decrypt(atu8_ciphertext, atu8_nonce);

			// decode result
			const sb64_response = buffer_to_text(atu8_plaintext);
			const sx_result = base64_to_text(sb64_response);

			// return response and json
			return JSON.parse(sx_result);
		},

		// execute contract
		async exec(h_exec, sa_sender, a_funds=[]) {
			// encrypt and encode execution body
			const atu8_exec = await k_wasm.encodeMsg(sb16_code_hash, h_exec, NB_EXEC_BLOCK);

			// extract nonce
			const atu8_nonce = atu8_exec.slice(0, 32);

			// construct body
			const kb_body = Protobuf()
				.v(10).b(bech32_decode(sa_sender))
				.v(18).b(atu8_contract)
				.v(26).b(atu8_exec);

			// encode sent funds
			a_funds.map(a_coin => kb_body.v(42).b(coin(a_coin)));

			// construct as direct message
			const atu8_msg = any('/secret.compute.v1beta1.MsgExecuteContract', kb_body.o());

			return [atu8_msg, atu8_nonce];
		},
	};
};
