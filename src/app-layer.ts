/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/naming-convention */
import type {NetworkErrorDetails} from './query/_root';
import type {QueryIntermediates, SecretContract} from './secret-contract';
import type {AuthSecret, HttpsUrl, JsonRpcResponse, LcdRpcStruct, MsgQueryPermit, PermitConfig, QueryPermit, SecretBech32, SlimCoin, TendermintEvent, TxResult} from './types';

import type {JsonObject, Nilable, Promisable, Uint128, AsJson, JsonString} from '@blake.regalia/belt';

import {__UNDEFINED, buffer_to_base64, hex_to_buffer, timeout, base64_to_buffer, buffer_to_text, oda} from '@blake.regalia/belt';


import {decode_protobuf} from './protobuf-reader';
import {die, safe_json} from './util';
import {
	type BroadcastResultOk,
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	type BroadcastResultErr,
	type TxResponse,
	type Wallet,
	type BroadcastResult,
	create_and_sign_tx_direct,
	sign_amino,
	broadcast,
} from './wallet';


export type RetryParams = [
	xt_wait: number,
];

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

		throw die('Retried '+c_attempts+'x: '+f_broadcast, z_broadcast);
	}
};


/**
 * Opens a new Tendermint JSONRPC WebSocket and immediately subscribes using the given query.
 * Users should close the WebSocket when no longer needed
 * @param p_rpc - RPC endpoint as an HTTPS base URL without trailing slash, e.g., "https://rpc.provider.net"
 * @param sx_query - the Tendermint query to filter events by, e.g., "tm.event='Tx'"
 * @param fk_message - callback for each message
 * @returns - the WebSocket instance
 */
export const subscribe_tendermint_events = (
	p_rpc: HttpsUrl,
	sx_query: string,
	fk_message: (d_event: MessageEvent<JsonString>) => any
): WebSocket => oda(
	// change protocol from http => ws and append /websocket to path
	new WebSocket('ws'+p_rpc.slice(4)+'/websocket'), {
		// first message will be subscription confirmation
		onmessage() {
			// each subsequent message
			this.onmessage = fk_message;
		},

		// open event
		onopen() {
			// subscribe to event
			this.send(JSON.stringify({
				id: '0',
				method: 'subscribe',
				params: {
					query: sx_query,
				},
			}));
		},
	} as {
		onmessage: (this: WebSocket, d_event: WebSocketEventMap['message']) => void;
		onopen: (this: WebSocket, d_event: WebSocketEventMap['open']) => void;
	});


/**
 * Broadcast a transaction to the network for its result
 * @param gc_node 
 * @param atu8_raw 
 * @param si_txn 
 * @returns tuple of `[number, string, TxResponse?]`
 *  - [0]: `xc_code: number` - error code from chain, or non-OK HTTP status code from the LCD server.
 * 		A value of `0` indicates success. A value of `-1` indicates a JSON parsing error.
 *  - [1]: `sx_res: string` - raw response text from the initial broadcast request
 *  - [2]: `tx_res?: `{@link TxResponse} - on success, the parsed transaction response JSON object
 */
export const broadcast_result = async(
	gc_node: LcdRpcStruct,
	atu8_raw: Uint8Array,
	si_txn: string
): Promise<[
	xc_code: number,
	sx_res: string,
	g_tx_res?: Nilable<TxResult['TxResult']>,
]> => new Promise(async(fk_resolve) => {
	// listen for tx event
	const d_ws = subscribe_tendermint_events(gc_node.rpc, `tx.hash='${si_txn}'`, (d_event) => {
		// destroy websocket
		d_ws.close();

		// parse message frame
		const g_tx_res = safe_json<JsonRpcResponse<TendermintEvent<TxResult>>>(d_event.data as string)?.result.data.value.TxResult;

		// return parsed result
		fk_resolve([g_tx_res? g_tx_res?.result.code ?? 0: -1, sx_res, g_tx_res]);
	});

	// submit tx
	const [sx_res, d_res] = await broadcast(gc_node.lcd, atu8_raw, 'SYNC');

	// attempt to parse response
	const g_res = safe_json<AsJson<BroadcastResultOk>>(sx_res);

	// not ok
	if(!d_res.ok || !g_res || g_res.tx_response?.code) {
		// close web socket
		d_ws.close();

		// resolve with error
		fk_resolve([
			d_res.ok? g_res?.tx_response?.code ?? -1: d_res.status,
			sx_res,
		]);
	}
});

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
export const query_contract = async<
	w_out extends object=JsonObject,
>(
	k_contract: SecretContract,
	h_query: JsonObject
): Promise<[xc_code: number, s_error: string, h_msg?: w_out]> => {
	// output intermediates
	const g_out: QueryIntermediates = {};

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
 * Format a query message given its method id and args object, and optionally an auth secret.
 * 
 * If an auth secret is given, the resulting query object will use the typical shape for that method.
 * 
 * Depending on auth secret's type (see {@link AuthSecret}):
 *  - _falsy_: no auth -- `{[method]: args}`
 *  - `string`: Viewing Key -- `{[method]:args, key:z_auth}`
 *  - `[string, string?]`: ViewerInfo -- `{[method]:{...args, viewer:{viewing_key:z_auth[0], address?:z_auth[1]}}}`
 *  - `object`: QueryPermit -- `{with_permit:{query:{[method]:args}, permit:z_auth}}`
 * 
 * @param si_method 
 * @param h_query 
 * @param z_auth 
 * @returns 
 */
export const format_query = (
	si_method: string,
	h_query: object,
	z_auth?: Nilable<AuthSecret>
): JsonObject => (z_auth
	? (z_auth as string | any[]).at
		// array?
		? (z_auth as any[]).map
			// ViewerInfo
			? {
				[si_method]: {
					...h_query,
					viewer: {
						viewing_key: (z_auth as string[])[0],
						address: (z_auth as string[])[1],
					},
				},
			}
			// Viewing Key
			: {
				[si_method]: {
					...h_query,
					key: z_auth,
				},
			}
		// Query Permit
		: {
			with_permit: {
				query: {
					[si_method]: h_query,
				},
				permit: z_auth,
			},
		}
	: {
		[si_method]: h_query,
	}) as JsonObject;


/**
 * Query a Secret Contract method and automatically apply an auth secret if one is provided.
 * Additionally, unwrap the success response if one was returned.
 * 
 * @param k_contract 
 * @param h_query 
 * @returns tuple of `[number, string, JsonObject?]` where:
 *  - [0]: `w_result?: JsonObject` - unwrapped contract result on success
 *  - [1]: `xc_code: number` - error code from chain, or non-OK HTTP status code from the LCD server.
 * 		A value of `0` indicates success.
 *  - [2]: `s_error: string` - error message from chain or HTTP response body
 *  - [3]: `h_msg?: JsonObject` - contract response as JSON object on success
 */
export const query_contract_infer = async<
	w_out extends object=JsonObject,
	si_method extends string=string,
	h_msg extends object=Record<si_method, w_out>,
>(
	k_contract: SecretContract,
	si_method: si_method,
	h_args?: Nilable<object>,
	z_auth?: Nilable<AuthSecret>
): Promise<[w_result: w_out | undefined, xc_code: number, s_error: string, h_msg?: h_msg]> => {
	const a_response = await query_contract<h_msg>(k_contract, format_query(si_method, h_args || {}, z_auth));

	// put unwrapped result in front
	return [
		a_response[0]
			? __UNDEFINED
			: (a_response[2] as any)?.[si_method] as w_out,
		...a_response,
	];
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
export const exec_contract = async(
	k_contract: SecretContract,
	k_wallet: Wallet,
	h_exec: JsonObject,
	a_fees: [SlimCoin, ...SlimCoin[]],
	sg_limit: Uint128,
	s_memo?: string,
	sa_granter?: SecretBech32 | ''
): Promise<[
	xc_code: number,
	s_error: string,
	g_tx_res?: TxResponse,
	// s_exec_res?: string,
]> => {
	// prep plaintext
	let s_plaintext;

	// construct execution message and save nonce
	let [atu8_msg, atu8_nonce] = await k_contract.exec(h_exec, k_wallet.addr);

	// sign in direct mode
	let [atu8_tx_raw] = await create_and_sign_tx_direct(k_wallet, [atu8_msg], a_fees, sg_limit, 0, s_memo, sa_granter);

	// broadcast to chain
	let [sx_res, d_res] = await broadcast(k_wallet.lcd, atu8_tx_raw);

	// parse response
	let g_res = safe_json(sx_res) as BroadcastResult;

	// invalid json
	if(!g_res) return [d_res.status, sx_res];

	// destructure broadcast response
	let g_tx_res = (g_res as BroadcastResultOk).tx_response;

	// not success; restructure error
	if(!g_tx_res) return [(g_res as BroadcastResultErr).code, (g_res as BroadcastResultErr).message];

	// destructure tx response
	let {
		code: xc_error,
		codespace: si_codespace,
		raw_log: s_rawlog,
	} = g_tx_res;

	// no errors
	if(!xc_error) {
		// parse data
		const [
			[[
				// type_url
				[atu8_type],  // eslint-disable-line @typescript-eslint/no-unused-vars

				// value
				[
					[[atu8_ciphertext]],
				],
			]],
		] = decode_protobuf(hex_to_buffer(g_tx_res.data)) as [[[[Uint8Array], [[[Uint8Array]]]]]];

		// decrypt ciphertext
		const atu8_plaintext = await k_contract.wasm.decrypt(atu8_ciphertext, atu8_nonce);

		// decode plaintext
		s_plaintext = buffer_to_text(base64_to_buffer(buffer_to_text(atu8_plaintext)));

		// return as tuple
		return [0, s_plaintext, g_tx_res];
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

		return [xc_error, s_plaintext ?? s_rawlog];
	}
};


/**
 * Execute a Secret Contract method using BROADCAST_MODE_SYNC and waiting for confirmation via JSONRPC.
 * More reliable than `exec_contract` which may appear to fail if the chain's block time exceeds node's broadcast timeout.
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
export const exec_contract_reliable = async(
	k_contract: SecretContract,
	k_wallet: Wallet,
	h_exec: JsonObject,
	a_fees: [SlimCoin, ...SlimCoin[]],
	sg_limit: Uint128,
	s_memo?: string,
	sa_granter?: SecretBech32 | ''
): Promise<[
	xc_code: number,
	s_error: string,
	g_tx_res?: TxResult['TxResult'],
	s_exec_res?: string,
]> => {	// prep plaintext
	// prep plaintext
	let s_plaintext;

	// construct execution message and save nonce
	let [atu8_msg, atu8_nonce] = await k_contract.exec(h_exec, k_wallet.addr);

	// sign in direct mode
	let [atu8_tx_raw, , si_txn] = await create_and_sign_tx_direct(k_wallet, [atu8_msg], a_fees, sg_limit, 0, s_memo, sa_granter);

	// broadcast to chain
	let [xc_error, sx_res, g_tx_res] = await broadcast_result(k_wallet, atu8_tx_raw, si_txn);

	// parse broadcast result
	let g_broadcast = safe_json<AsJson<{tx_response: TxResponse}>>(sx_res);

	// invalid json
	if(xc_error < 0) return [xc_error, sx_res];

	// no errors
	if(!xc_error) {
		// parse data
		const [
			[[
				// type_url
				[atu8_type],  // eslint-disable-line @typescript-eslint/no-unused-vars

				// value
				[
					[[atu8_ciphertext]],
				],
			]],
		] = decode_protobuf(base64_to_buffer(g_tx_res!.result.data)) as [[[[Uint8Array], [[[Uint8Array]]]]]];

		// decrypt ciphertext
		const atu8_plaintext = await k_contract.wasm.decrypt(atu8_ciphertext, atu8_nonce);

		// decode plaintext
		s_plaintext = buffer_to_text(base64_to_buffer(buffer_to_text(atu8_plaintext)));
	}
	// error
	else {
		const s_error = g_tx_res?.result.log ?? g_broadcast?.tx_response.raw_log ?? sx_res;

		// encrypted error message
		const m_response = /(\d+):(?: \w+:)*? encrypted: (.+?): (.+?) contract/.exec(s_error);
		if(m_response) {
			const [, s_index, sb64_encrypted, si_action] = m_response;

			const atu8_plaintext = await k_contract.wasm.decrypt(base64_to_buffer(sb64_encrypted), atu8_nonce);

			s_plaintext = buffer_to_text(atu8_plaintext);
		}

		return [xc_error, s_plaintext ?? s_error];
	}

	// return as tuple
	return [xc_error, s_plaintext, g_tx_res!];
};


/**
 * Sign a query permit and return the encoded object ready for use in a query
 * @param k_wallet 
 * @param si_permit 
 * @param a_tokens 
 * @param a_permissions 
 * @returns 
 */
export const sign_query_permit = async(
	k_wallet: Wallet,
	si_permit: string,
	a_tokens: SecretBech32[],
	a_permissions: string[]
): Promise<QueryPermit> => {
	// prep params
	const g_params: PermitConfig = {
		permit_name: si_permit,
		allowed_tokens: a_tokens,
		permissions: a_permissions,
	};

	// sign query permit
	const [atu8_signature, g_signed] = await sign_amino<[MsgQueryPermit]>(k_wallet, [{
		type: 'query_permit',
		value: g_params,
	}], [['0', 'uscrt']], '1', ['0', '0']);

	// encode query permit
	return {
		params: {
			...g_signed.msgs[0].value,
			chain_id: k_wallet.ref,
		},
		signature: {
			pub_key: {
				type: 'tendermint/PubKeySecp256k1',
				value: buffer_to_base64(k_wallet.pk33),
			},
			signature: buffer_to_base64(atu8_signature),
		},
	};
};
