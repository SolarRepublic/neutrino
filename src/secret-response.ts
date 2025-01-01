import type {TxResponseTuple} from './app-layer';
import type {SecretWasm} from './secret-wasm';
import type {JsonObject, Promisable} from '@blake.regalia/belt';

import {bytes_to_text, base64_to_bytes, parse_json_safe, __UNDEFINED} from '@blake.regalia/belt';
import {decodeCosmosBaseAbciTxMsgData} from '@solar-republic/cosmos-grpc/cosmos/base/abci/v1beta1/abci';
import {SI_MESSAGE_TYPE_SECRET_COMPUTE_MSG_EXECUTE_CONTRACT_RESPONSE, SI_MESSAGE_TYPE_SECRET_COMPUTE_MSG_MIGRATE_CONTRACT_RESPONSE, SI_MESSAGE_TYPE_SECRET_COMPUTE_MSG_INSTANTIATE_CONTRACT_RESPONSE, decodeSecretComputeMsgExecuteContractResponse, decodeSecretComputeMsgInstantiateContractResponse} from '@solar-republic/cosmos-grpc/secret/compute/v1beta1/msg';


// response message types that contain encrypted result from contract
type EncryptedResponseMessageType =
	| typeof SI_MESSAGE_TYPE_SECRET_COMPUTE_MSG_EXECUTE_CONTRACT_RESPONSE
	| typeof SI_MESSAGE_TYPE_SECRET_COMPUTE_MSG_MIGRATE_CONTRACT_RESPONSE
	| typeof SI_MESSAGE_TYPE_SECRET_COMPUTE_MSG_INSTANTIATE_CONTRACT_RESPONSE;


/**
 * Creates a decoder dict for parsing secret compute transaction responses
 * @param k_wasm - the {@link SecretWasm} instance that transaction is being executed against
 * @param atu8_nonce - the nonce that was used for encrypting the outgoing message
 * @returns decoder dict appropriate for use in {@link secret_response_parse}
 */
export const secret_response_decoders: (
	k_wasm: SecretWasm,
	a_nonces: Uint8Array[],
) => Parameters<typeof secret_response_parse>[1] = (k_wasm, a_nonces) => {
	// contract response decryptor
	const f_decryptor = async(atu8_ciphertext: Uint8Array, i_msg: number) => {
		// decrypt ciphertext
		const atu8_plaintext = await k_wasm.decrypt(atu8_ciphertext, a_nonces[i_msg]);

		// decode plaintext
		const s_plaintext = bytes_to_text(base64_to_bytes(bytes_to_text(atu8_plaintext)));

		// entuple results
		return [s_plaintext, parse_json_safe<JsonObject>(s_plaintext)] as const;
	};

	// execution/migration response parser
	const f_exec_migrate_decoder = async(atu8_payload: Uint8Array, i_msg: number) => {
		// decode payload
		const [atu8_ciphertext] = decodeSecretComputeMsgExecuteContractResponse(atu8_payload);

		// return decrypted contract response
		return atu8_ciphertext?.length? await f_decryptor(atu8_ciphertext, i_msg): [''];
	};

	// create decoder dict
	return {
		// execution/migration response parser
		[SI_MESSAGE_TYPE_SECRET_COMPUTE_MSG_EXECUTE_CONTRACT_RESPONSE]: f_exec_migrate_decoder,

		// migration response is same as execute response
		[SI_MESSAGE_TYPE_SECRET_COMPUTE_MSG_MIGRATE_CONTRACT_RESPONSE]: async(atu8_payload, i_msg) => atu8_payload?.length
			? f_exec_migrate_decoder(atu8_payload, i_msg)
			: [''] as const,

		// // store code decoder
		// [SI_MESSAGE_TYPE_SECRET_COMPUTE_MSG_STORE_CODE_RESPONSE]: decodeSecretComputeMsgStoreCodeResponse,

		// instantiation decoder
		[SI_MESSAGE_TYPE_SECRET_COMPUTE_MSG_INSTANTIATE_CONTRACT_RESPONSE]: async(atu8_payload, i_msg) => {
			// decode response
			const [, atu8_ciphertext] = decodeSecretComputeMsgInstantiateContractResponse(atu8_payload);

			// return decrypted contract response
			return atu8_ciphertext?.length? await f_decryptor(atu8_ciphertext, i_msg): [''];
		},
	};
};


/**
 * Applies the given decoders dict to the raw transaction response data bytes
 * @param atu8_data - transaction response data bytes
 * @param h_decoders - dict of decoders used to parse each message's response data
 * @returns Array of tuples of `[any?, string, Uint8Array]`:
 *  - [0]: `w_return?: any` - result of applying the typed data to its decoder
 *  - [1]: `s_type: string` - proto 'any' "type" string
 *  - [2]: `atu8_payload: Uint8Array` - proto 'any' "value" bytes
 */
export const secret_response_parse = async<
	const h_decoders extends {
		[s_type in EncryptedResponseMessageType]: h_decoders[s_type] extends (atu8_payload: Uint8Array, i_msg: number) => Promisable<infer w_return>
			? (atu8_payload: Uint8Array, i_msg: number) => w_return
			: (atu8_payload: Uint8Array, i_msg: number) => any;
	},
>(
	atu8_data: Uint8Array | undefined,
	h_decoders: h_decoders
): Promise<{
	[s_type in Extract<keyof h_decoders, EncryptedResponseMessageType>]: [
		w_return: Awaited<ReturnType<h_decoders[s_type]>>,
		s_type: s_type,
		atu8_data: Uint8Array,
	]
}[Extract<keyof h_decoders, EncryptedResponseMessageType>][]> => {
	// decode tx msg data
	const [a_data, a_msg_responses] = decodeCosmosBaseAbciTxMsgData(atu8_data!);

	// decode responses
	return await Promise.all((a_msg_responses || a_data)!.map(async([s_type, atu8_payload], i_msg) => [
		await h_decoders[s_type as EncryptedResponseMessageType]?.(atu8_payload!, i_msg),
		s_type as Extract<keyof h_decoders, EncryptedResponseMessageType>,
		atu8_payload!,
	]));
};



/**
 * Decrypts response data from a Secret Contract execution, migration, or instantiation, parsing & marshalling any errors
 * @param k_contract 
 * @param param1 
 * @param atu8_nonce 
 * @returns a two-part tuple where tuple at [0]?:
 *  - [0]: `s_error?: string` - the error message for the entire transaction
 *  - [1]: `i_message?: number` - `-1` if JSON parsing error, `undefined` if error is generic and not associated to any particular message, otherwise the 0-based index of the message that caused the error
 *  
 * ... and the tuple at [1]?:
 *  - [0]: `readonly [s_plaintext: string, g_answer?: JsonObject, sa_contract?: 'secret1${string}']` - the parsed execution/migration response
 *  - [1]: `s_type: string` - the secret compute execute contract message type string
 *  - [2]: `atu8_payload: string` - the raw execution response bytes
 */
export const secret_response_decrypt = async(
	k_wasm: SecretWasm,
	[xc_error, sx_res,, g_meta,, atu8_data]: TxResponseTuple,
	a_nonces: Uint8Array[]
): Promise<[
	a_error?: [
		s_error?: string,
		i_message?: number,
	] | undefined,
	a_results?: [
		readonly [
			s_plaintext: string,
			g_answer?: JsonObject | undefined,
		],
		s_type?: EncryptedResponseMessageType,
		atu8_payload?: Uint8Array,
	][],
]> => {
	// prep plaintext
	let s_plaintext!: string;

	// invalid json
	if(xc_error < 0) return [[sx_res, xc_error]];

	// no errors
	if(!xc_error) {
		// decode transaction response(s)
		return [
			__UNDEFINED,
			await secret_response_parse(atu8_data, secret_response_decoders(k_wasm, a_nonces)),
		];
	}

	// error
	const s_error = g_meta?.log ?? sx_res;

	// encrypted error message
	const m_response = /(\d+):(?: \w+:)*? encrypted: (.+?): (.+?) contract/.exec(s_error);
	if(m_response) {
		// destructure match
		const [, s_index, sb64_encrypted, si_action] = m_response;

		// decrypt message from contract
		const atu8_plaintext = await k_wasm.decrypt(base64_to_bytes(sb64_encrypted), a_nonces[+s_index]);

		// decode bytes
		return [[bytes_to_text(atu8_plaintext) ?? s_error, +s_index]];
	}

	// entuple error
	return [[s_plaintext ?? s_error]];
};
