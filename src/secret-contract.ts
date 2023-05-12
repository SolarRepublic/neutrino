import type {LcdQueryClient} from './lcd-query';
import type {ContractInfo, SecretBech32} from './types';
import type {JsonObject, Nilable} from '@solar-republic/belt';

import {base64_to_buffer, buffer_to_text} from '@solar-republic/belt';

import {bech32Decode} from './bech32';
import {any, coin, protobuf, type SlimCoin} from './protobuf-writer';
import {SecretWasm} from './secret-wasm';


// pads all query messages to be multiples of this many bytes
const NB_QUERY_BLOCK = 64;

// pads all execution messages to be multiples of this many bytes
const NB_EXEC_BLOCK = 0;

const h_codes_cache: Record<ContractInfo['code_id'], string> = {};

const h_contract_cache: Record<SecretBech32, ContractInfo> = {};

const hm_networks = new Map<LcdQueryClient, SecretWasm>();


export interface SecretContract {
	info: ContractInfo;
	hash: string;
	wasm: SecretWasm;
	query(h_query: JsonObject): Promise<JsonObject>;
	exec(h_exec: JsonObject, sa_sender: SecretBech32, a_funds?: SlimCoin[]): Promise<[
		atu8_data: Uint8Array,
		atu8_nonce: Uint8Array,
	]>;
}


// eslint-disable-next-line @typescript-eslint/naming-convention
export const secretContract = async(k_querier: LcdQueryClient, sa_contract: SecretBech32, atu8_seed: Nilable<Uint8Array>=null): Promise<SecretContract> => {
	// try loading instance from cache
	let k_wasm = hm_networks.get(k_querier)!;

	// network not yet cached
	if(!k_wasm) {
		// fetch consensus io pubkey
		const atu8_consensus_pk = await k_querier.registration.txKey();

		// instantiate secret wasm and save to cache
		hm_networks.set(k_querier, k_wasm = new SecretWasm(atu8_consensus_pk, atu8_seed));
	}

	// refload contract info
	const g_info = h_contract_cache[sa_contract] = h_contract_cache[sa_contract] || await k_querier.compute.info(sa_contract);

	// ref code id
	const si_code = g_info.code_id;

	// refload code hash
	const sb16_code_hash = h_codes_cache[si_code] = h_codes_cache[si_code] || await k_querier.compute.code_hash.by_code_id(si_code);

	// decode contract address
	const atu8_contract = bech32Decode(sa_contract);

	// methods
	return {
		// expose info
		info: g_info,

		// code hash
		hash: sb16_code_hash,

		// wasm instance
		wasm: k_wasm,

		// query contract
		async query(h_query) {
			// encrypt and encode query msg
			const atu8_msg = await k_wasm.encodeMsg(sb16_code_hash, h_query, NB_QUERY_BLOCK);

			// extract nonce
			const atu8_nonce = atu8_msg.slice(0, 32);

			// submit query
			const atu8_ciphertext = await k_querier.compute.query(sa_contract, atu8_msg);

			// decrypt response
			const atu8_plaintext = await k_wasm.decrypt(atu8_ciphertext, atu8_nonce);

			// decode result
			const sb64_response = buffer_to_text(atu8_plaintext);
			const atu8_response = base64_to_buffer(sb64_response);
			const sx_result = buffer_to_text(atu8_response);

			// return response and json
			return JSON.parse(sx_result);
		},

		// execute contract method
		async exec(h_exec, sa_sender, a_funds=[]) {
			// encrypt and encode execution body
			const atu8_exec = await k_wasm.encodeMsg(sb16_code_hash, h_exec, NB_EXEC_BLOCK);

			// extract nonce
			const atu8_nonce = atu8_exec.slice(0, 32);

			// construct body
			const kb_body = protobuf()
				.uint32(10).bytes(bech32Decode(sa_sender))
				.uint32(18).bytes(atu8_contract)
				.uint32(26).bytes(atu8_exec);

			// encode sent funds
			a_funds.map(a_coin => kb_body.uint32(42).bytes(coin(a_coin)));

			// construct as direct message
			const atu8_msg = any('/secret.compute.v1beta1.MsgExecuteContract', kb_body.out());

			return [atu8_msg, atu8_nonce];
		},
	};
};
