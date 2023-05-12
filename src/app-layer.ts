
import type {SlimCoin} from './protobuf-writer';
import type {SecretContract} from './secret-contract';

import type {SecretBech32} from './types';
import type {TxResponse, Wallet} from './wallet';

import type {JsonObject, Nilable, Promisable} from '@solar-republic/belt';

import {hex_to_buffer, timeout, base64_to_buffer, buffer_to_text} from '@solar-republic/belt';

import {decode_protobuf} from './protobuf-reader';


export type RetryParams = [
	xt_wait: number,
];

export const err = (s_msg: string, w_data: unknown) => Object.assign(new Error(s_msg), {data:w_data});

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
 * Execute a Secret contract method
 * @param k_contract - a {@link SecretContract} instance
 * @param k_wallet - the {@link Wallet} of the sender
 * @param h_exec - the execution message as a plain object (to be JSON-encoded)
 * @param a_fees - an Array of {@link SlimCoin SlimCoin} describing the amounts and denoms of fees
 * @param sg_limit - the u128 gas limit to set for the transaction
 * @param sa_granter - optional granter address to use to pay for gas fee
 * @returns
 *  - [0]: `tx_res` - the parsed {@link TxResponse} JSON object
 *  - [1]: `exec_res` - decrypted response string from the contract (for both errors and success)
 * 
 * @throws 
 */
export const executeContract = async(  // eslint-disable-line @typescript-eslint/naming-convention
	k_contract: SecretContract,
	k_wallet: Wallet,
	h_exec: JsonObject,
	a_fees: [SlimCoin, ...SlimCoin[]],
	sg_limit: `${bigint}`,
	sa_granter?: SecretBech32 | ''
): Promise<[g_tx_res: TxResponse, s_exec_res: string]> => {
	// construct execution message and save nonce
	const [atu8_msg, atu8_nonce] = await k_contract.exec(h_exec, k_wallet.bech32);

	// sign in direct mode
	const [atu8_tx_raw] = await k_wallet.signDirect([atu8_msg], a_fees, sg_limit, sa_granter);

	// broadcast to chain
	const g_broadcast = await k_wallet.broadcast(atu8_tx_raw);

	// destructure broadcast response
	const g_tx_res = g_broadcast['tx_response'];

	// not valid; throw
	if(!g_tx_res) throw g_tx_res;

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
	}

	// return as tuple
	return [
		g_tx_res,
		s_plaintext,
	];
};
