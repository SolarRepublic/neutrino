import type {NetworkErrorDetails} from './lcd/_root';
import type {SlimCoin} from './protobuf-writer';
import type {QueryIntermediates, SecretContract} from './secret-contract';


import type {SecretBech32} from './types';
import type {
	BroadcastResultOk,
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	BroadcastResultErr,
	TxResponse,
	Wallet,
	BroadcastResult,
} from './wallet';
import type {JsonObject, Nilable, Promisable} from '@blake.regalia/belt';


import {hex_to_buffer, timeout, base64_to_buffer, buffer_to_text} from '@blake.regalia/belt';

import {decode_protobuf} from './protobuf-reader';
import {safe_json} from './util';


export type RetryParams = [
	xt_wait: number,
];

export const err = (s_msg: string, w_data: unknown): Error => Object.assign(new Error(s_msg), {data:w_data});

export const retry = async<w_out>(
	f_broadcast: (c_attempts: number) => Promise<w_out>,
	f_handle: (z_error: unknown, c_attempts: number) => Promisable<RetryParams | Nilable<void>>,
	c_attempts=0
): Promise<w_out> => {
	try {
		return await f_broadcast(c_attempts);
	}
	catch(z_broadcast) {
		const a_retry = await f_handle(z_broadcast, ++c_attempts);

		// retry
		if(a_retry) {
			await timeout(a_retry[0] || 0);
			return await retry(f_broadcast, f_handle, c_attempts);
		}

		throw err('Retried '+c_attempts+'x: '+f_broadcast, z_broadcast);
	}
};


/**
 * Query a Secret Contract method
 * @param k_contract 
 * @param h_query 
 * @returns tuple of `[number, string, JsonObject?]` where:
 *  - [0]: `xc_code: number` - error code from chain, or non-OK HTTP status code from the LCD server.
 * 		A value of `0` indicates success.
 *  - [1]: `s_error: string` - error message from chain or HTTP response body
 *  - [2]: `h_msg?: JsonObject` - contract response as JSON object on success
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const queryContract = async<
	w_out extends object=JsonObject,
>(
	k_contract: SecretContract,
	h_query: JsonObject
): Promise<[xc_code: number, s_error: string, h_msg?: w_out]> => {
	// output intermediates
	let g_out: QueryIntermediates = {};

	// attempt query as usual
	try {
		return [0, '', await k_contract.query<w_out>(h_query, g_out)];
	}
	// not successful
	catch(e_query) {
		// tuple was thrown
		if((e_query as NetworkErrorDetails)[0]) {
			// destructure details
			const [d_res, s_res, g_res] = e_query as NetworkErrorDetails;

			// destructure chain code
			const xc_code = g_res?.['code'] as number;

			// error message
			const m_error = /encrypted: (.+?):/.exec(g_res?.['message'] as string || '');
			if(m_error) {
				// decode base64 string
				const atu8_ciphertext = base64_to_buffer(m_error[1]);

				// decrypt the ciphertext
				const atu8_plaintext = await k_contract.wasm.decrypt(atu8_ciphertext, g_out.n!);

				// decode
				const sx_plaintext = buffer_to_text(atu8_plaintext);

				// return tuple
				return [xc_code, sx_plaintext];
			}

			// other code or server error
			return [xc_code ?? d_res.status, s_res || d_res.statusText];
		}

		// error instance was thrown; rethrow
		throw e_query;
	}
};


/**
 * Execute a Secret Contract method
 * @param k_contract - a {@link SecretContract} instance
 * @param k_wallet - the {@link Wallet} of the sender
 * @param h_exec - the execution message as a plain object (to be JSON-encoded)
 * @param a_fees - an Array of {@link SlimCoin SlimCoin} describing the amounts and denoms of fees
 * @param sg_limit - the u128 gas limit to set for the transaction
 * @param sa_granter - optional granter address to use to pay for gas fee
 * @returns tuple of `[number, string, TxResponse?]`
 *  - [0]: `xc_code: number` - error code from chain, or non-OK HTTP status code from the LCD server.
 * 		A value of `0` indicates success.
 *  - [1]: `s_res: string` - message text. on success, will be the contract's response as a JSON string.
 * 		on error, will be either the error string from HTTP response text, chain error message,
 * 		or contract error as a JSON string.
 *  - [2]: `tx_res?: `{@link TxResponse} - on success, the parsed transaction response JSON object
 * 
 * @throws a {@link BroadcastResultErr}
 */
export const execContract = async(  // eslint-disable-line @typescript-eslint/naming-convention
	k_contract: SecretContract,
	k_wallet: Wallet,
	h_exec: JsonObject,
	a_fees: [SlimCoin, ...SlimCoin[]],
	sg_limit: `${bigint}`,
	sa_granter?: SecretBech32 | ''
): Promise<[xc_code: number, s_error: string, g_tx_res?: TxResponse, s_exec_res?: string]> => {
	// construct execution message and save nonce
	const [atu8_msg, atu8_nonce] = await k_contract.exec(h_exec, k_wallet.bech32);

	// sign in direct mode
	const [atu8_tx_raw] = await k_wallet.signDirect([atu8_msg], a_fees, sg_limit, sa_granter);

	// broadcast to chain
	const [sx_res, d_res] = await k_wallet.broadcast(atu8_tx_raw);

	// parse response
	const g_res = safe_json(sx_res) as BroadcastResult;

	// invalid json
	if(!g_res) return [d_res.status, sx_res];

	// destructure broadcast response
	const g_tx_res = (g_res as BroadcastResultOk).tx_response;

	// not success; restructure error
	if(!g_tx_res) return [(g_res as BroadcastResultErr).code, (g_res as BroadcastResultErr).message];

	// destructure tx response
	let {
		code: xc_error,
		codespace: si_codespace,
		raw_log: s_rawlog,
	} = g_tx_res;

	// prep plaintext
	let s_plaintext = '';

	// no errors
	if(!xc_error) {
		// parse data
		const [
			// @ts-expect-error recursive type
			[[
				// type_url
				[atu8_type],

				// value
				[
					[[atu8_ciphertext]],
				],
			]],
		] = decode_protobuf(hex_to_buffer(g_tx_res.data));

		// decrypt ciphertext
		const atu8_plaintext = await k_contract.wasm.decrypt(atu8_ciphertext, atu8_nonce);

		// decode plaintext
		s_plaintext = buffer_to_text(base64_to_buffer(buffer_to_text(atu8_plaintext)));
	}
	// error
	else {
		// encrypted error message
		const m_response = /(\d+):(?: \w+:)*? encrypted: (.+?): (.+?) contract/.exec(s_rawlog);
		if(m_response) {
			const [, s_index, sb64_encrypted, si_action] = m_response;

			const atu8_plaintext = await k_contract.wasm.decrypt(base64_to_buffer(sb64_encrypted), atu8_nonce);

			s_plaintext = buffer_to_text(atu8_plaintext);
		}

		return [xc_error, s_plaintext];
	}

	// return as tuple
	return [0, s_plaintext, g_tx_res];
};
