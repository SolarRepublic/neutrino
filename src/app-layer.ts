/* eslint-disable prefer-const */
/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/naming-convention */

import type {CreateQueryArgsAndAuthParams} from './inferencing.js';
import type {SecretContractQueryIntermediates, SecretContract} from './secret-contract.js';
import type {AuthSecret, JsonRpcResponse, LcdRpcStruct, MsgQueryPermit, PermitConfig, TendermintEvent, TxResultWrapper, WeakSecretAccAddr} from './types.js';

import type {Wallet} from './wallet.js';
import type {JsonObject, Nilable, Promisable, AsJson, NaiveJsonString} from '@blake.regalia/belt';

import type {ContractInterface} from '@solar-republic/contractor';
import type {NetworkJsonResponse} from '@solar-republic/cosmos-grpc';
import type {CosmosBaseAbciTxResponse} from '@solar-republic/cosmos-grpc/cosmos/base/abci/v1beta1/abci';
import type {TendermintAbciTxResult} from '@solar-republic/cosmos-grpc/tendermint/abci/types';
import type {SecretQueryPermit, SlimCoin, WeakAccountAddr, TrustedContextUrl, CwAccountAddr, CwUint32, WeakUint128Str} from '@solar-republic/types';

import {__UNDEFINED, bytes_to_base64, timeout, base64_to_bytes, bytes_to_text, oda, odv, safe_json} from '@blake.regalia/belt';

import {die} from '@solar-republic/cosmos-grpc';
import {SI_JSON_COSMOS_TX_BROADCAST_MODE_BLOCK, submitCosmosTxBroadcastTx} from '@solar-republic/cosmos-grpc/cosmos/tx/v1beta1/service';

import {decodeGoogleProtobufAny} from '@solar-republic/cosmos-grpc/google/protobuf/any';

import {create_and_sign_tx_direct, sign_amino} from './wallet.js';


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
 * Evaluates the given Promise, returning whatever value is resolved or rejected
 */
const without_throwing = <
	w_type extends NetworkJsonResponse,
>(dp_req: Promise<w_type>): Promise<w_type> => new Promise(fk_resolve => dp_req.then(fk_resolve, fk_resolve));


/**
 * Opens a new Tendermint JSONRPC WebSocket and immediately subscribes using the given query.
 * Users should close the WebSocket when no longer needed
 * @param p_rpc - RPC endpoint as an HTTPS base URL without trailing slash, e.g., "https://rpc.provider.net"
 * @param sx_query - the Tendermint query to filter events by, e.g., "tm.event='Tx'"
 * @param fk_message - callback for each message
 * @returns - the WebSocket instance
 */
export const subscribe_tendermint_events = (
	p_rpc: TrustedContextUrl,
	sx_query: string,
	fk_message: (d_event: MessageEvent<NaiveJsonString>) => any
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
	g_tx_res?: Nilable<TxResultWrapper['TxResult']>,
]> => new Promise(async(fk_resolve) => {
	// listen for tx event
	const d_ws = subscribe_tendermint_events(gc_node.rpc, `tx.hash='${si_txn}'`, (d_event) => {
		// destroy websocket
		d_ws.close();

		// parse message frame
		const g_tx_res = safe_json<JsonRpcResponse<TendermintEvent<TxResultWrapper>>>(d_event.data as string)?.result.data.value.TxResult;

		// return parsed result
		fk_resolve([g_tx_res? g_tx_res?.result?.code ?? 0: -1, sx_res, g_tx_res]);
	});

	// submit tx
	const [d_res, sx_res, g_res] = await without_throwing(submitCosmosTxBroadcastTx(gc_node.lcd, atu8_raw, SI_JSON_COSMOS_TX_BROADCAST_MODE_BLOCK));

	// not ok HTTP code, no parsed JSON, or non-zero response code
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
 *  - [3]: `h_answer?: JsonObject` - contract response as JSON object on success
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const query_secret_contract = async<
	g_interface extends ContractInterface,
	h_variants extends ContractInterface.MsgAndAnswer<g_interface, 'queries'>,
	g_variant extends h_variants[keyof h_variants],
>(
	k_contract: SecretContract<g_interface>,
	h_query: g_variant['msg']
): Promise<[xc_code: number, s_error: string, h_answer?: g_variant['answer']]> => {
	// output intermediates
	const g_out: SecretContractQueryIntermediates = {};

	// attempt query as usual
	try {
		return [0, '', await k_contract.query(h_query, g_out)];
	}
	// not successful
	catch(e_query) {
		// tuple was thrown
		if((e_query as NetworkJsonResponse)[0]) {
			// destructure details
			const [d_res, s_res, g_res] = e_query as NetworkJsonResponse<{
				code: CwUint32;
				message: string;
			}>;

			// destructure chain code
			const xc_code = g_res?.code;

			// error message
			const m_error = /encrypted: (.+?):/.exec(g_res?.message || '');
			if(m_error) {
				// decode base64 string
				const atu8_ciphertext = base64_to_bytes(m_error[1]);

				// decrypt the ciphertext
				const atu8_plaintext = await k_contract.wasm.decrypt(atu8_ciphertext, g_out.n!);

				// decode
				const sx_plaintext = bytes_to_text(atu8_plaintext);

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
export const format_secret_query = (
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


interface QueryContractInfer {
	<
		g_interface extends ContractInterface,
		h_variants extends ContractInterface.MsgAndAnswer<g_interface, 'queries'>,
		si_method extends Extract<keyof h_variants, string>,
		g_variant extends h_variants[si_method],
	>(
		k_contract: SecretContract<g_interface>,
		si_method: si_method,
		...[h_args, z_auth]: CreateQueryArgsAndAuthParams<
			h_variants,
			si_method,
			ContractInterface extends g_interface? 1: 0
		>
	): Promise<[
		w_result: g_variant['response'] | undefined,
		xc_code_x: number,
		s_error: string,
		h_answer?: g_variant['answer'],
	]>;
}

/**
 * Query a Secret Contract method and automatically apply an auth secret if one is provided.
 * Additionally, unwrap the success response if one was returned.
 * @param k_contract - the contract
 * @param si_method - which query method to invoke
 * @param h_args - the args value to pass in with the given query
 * @param z_auth - optional {@link AuthSecret} to perform an authenticated query
 * @returns tuple of `[JsonObject?, number, string, JsonObject?]` where:
 *  - [0]: `w_result?: JsonObject` - unwrapped contract result on success
 *  - [1]: `xc_code: number` - error code from chain, or non-OK HTTP status code from the LCD server.
 * 		A value of `0` indicates success.
 *  - [2]: `s_error: string` - error message from chain or HTTP response body
 *  - [3]: `h_answer?: JsonObject` - contract response as JSON object on success
 */
export const query_secret_contract_infer: QueryContractInfer = async(
	k_contract: SecretContract,
	si_method: string,
	...[h_args, z_auth]: [h_args?: Nilable<JsonObject>, z_auth?: Nilable<AuthSecret>]
): Promise<[w_result: JsonObject | undefined, xc_code_p: number, s_error: string, h_answer?: JsonObject]> => {
	if(import.meta.env?.DEV) {
		console.groupCollapsed(`❓ ${si_method}`);
		console.debug(`Querying contract ${k_contract.addr} (${k_contract.info.label})`);
		console.debug(format_secret_query(si_method, h_args || {}, z_auth));
		console.groupEnd();
	}

	const a_response = await query_secret_contract(k_contract, format_secret_query(si_method, h_args || {}, z_auth));

	if(import.meta.env?.DEV) {
		console.groupCollapsed(`🛰️ ${si_method}`);
		console.debug(`Query response [code: ${a_response[0]}] from ${k_contract.addr} (${k_contract.info.label}):`);
		console.debug(a_response[2]);
		console.groupEnd();
	}

	// put unwrapped result in front
	return [
		a_response[0]
			? __UNDEFINED
			: odv(a_response[2] as JsonObject)[0]! as JsonObject,
		...a_response,
	];
};


/**
 * Execute a Secret Contract method using BROADCAST_MODE_SYNC and wait for confirmation via JSONRPC.
 * More reliable than `exec_contract_unreliable` which may appear to fail if the chain's block time exceeds node's broadcast timeout.
 * @param k_contract - a {@link SecretContract} instance
 * @param k_wallet - the {@link Wallet} of the sender
 * @param h_exec - the execution message as a plain object (to be JSON-encoded)
 * @param a_fees - an Array of {@link SlimCoin} describing the amounts and denoms of fees
 * @param sg_limit - the u128 gas limit to set for the transaction
 * @param sa_granter - optional granter address to use to pay for gas fee
 * @param a_funds - optional Array of {@link SlimCoin} of funds to send into the contract with the tx
 * @param s_memo - optional memo field
 * @returns tuple of `[number, string, TxResponse?]`
 *  - [0]: `xc_code: number` - error code from chain, or non-OK HTTP status code from the LCD server.
 * 		A value of `0` indicates success.
 *  - [1]: `s_res: string` - message text. on success, will be the contract's response as a JSON string.
 * 		on error, will be either the error string from HTTP response text, chain error message,
 * 		or contract error as a JSON string.
 *  - [2]: `g_tx_res?: `{@link TxResponse} - on success, the parsed transaction response JSON object
 *  - [3]: `si_txn?: string` - the transaction hash if a broadcast attempt was made
 * 
 * @throws a {@link BroadcastResultErr}
 */
export const exec_secret_contract = async<
	g_interface extends ContractInterface,
	h_group extends ContractInterface.MsgAndAnswer<g_interface, 'executions'>,
	as_methods extends Extract<keyof h_group, string>,
>(
	k_contract: SecretContract<g_interface>,
	k_wallet: Wallet,
	h_exec: ContractInterface extends g_interface? JsonObject: {
		[si_method in as_methods]: h_group[si_method]['msg'];
	},
	a_fees: [SlimCoin, ...SlimCoin[]],
	sg_limit: WeakUint128Str,
	sa_granter?: WeakSecretAccAddr | '',
	a_funds?: SlimCoin[],
	s_memo?: string
): Promise<[
	xc_code: number,
	s_res: string,
	g_tx_res?: TendermintAbciTxResult | undefined,
	si_txn?: string,
]> => {
	// prep plaintext
	let s_plaintext;

	// construct execution message and save nonce
	let [atu8_msg, atu8_nonce] = await k_contract.exec(h_exec, k_wallet.addr, a_funds);

	// sign in direct mode
	let [atu8_tx_raw, , si_txn] = await create_and_sign_tx_direct(k_wallet, [atu8_msg], a_fees, sg_limit, 0, s_memo, sa_granter);

	// debug info
	if(import.meta.env?.DEV) {
		console.groupCollapsed(`🗳️ ${Object.keys(h_exec)[0]}`);
		console.debug([
			`Executing contract ${k_contract.addr} (${k_contract.info.label}) from ${k_wallet.addr}`,
			`  limit: ${sg_limit} ┃ hash: ${si_txn}`,
		].join('\n'));
		console.debug(h_exec);
		console.groupEnd();
	}

	// broadcast to chain
	let [xc_error, sx_res, g_tx_res] = await broadcast_result(k_wallet, atu8_tx_raw, si_txn);

	// parse broadcast result
	let g_broadcast = safe_json<AsJson<{tx_response: CosmosBaseAbciTxResponse}>>(sx_res);

	// invalid json
	if(xc_error < 0) return [xc_error, sx_res];

	// no errors
	if(!xc_error) {
		// // parse data
		let [s_type, atu8_ciphertext] = decodeGoogleProtobufAny(base64_to_bytes(g_tx_res!.result!.data!));

		// decrypt ciphertext
		const atu8_plaintext = await k_contract.wasm.decrypt(atu8_ciphertext!, atu8_nonce);

		// decode plaintext
		s_plaintext = bytes_to_text(base64_to_bytes(bytes_to_text(atu8_plaintext)));
	}
	// error
	else {
		const s_error = g_tx_res?.result?.log ?? g_broadcast?.tx_response.raw_log ?? sx_res;

		// encrypted error message
		const m_response = /(\d+):(?: \w+:)*? encrypted: (.+?): (.+?) contract/.exec(s_error);
		if(m_response) {
			const [, s_index, sb64_encrypted, si_action] = m_response;

			const atu8_plaintext = await k_contract.wasm.decrypt(base64_to_bytes(sb64_encrypted), atu8_nonce);

			s_plaintext = bytes_to_text(atu8_plaintext);
		}

		// debug info
		if(import.meta.env?.DEV) {
			console.groupCollapsed(`❌ ${Object.keys(h_exec)[0]} [code: ${xc_error}]`);
			console.debug('tx: ', g_tx_res);
			console.debug('data: ', s_plaintext ?? s_error);
			console.groupEnd();
		}

		return [xc_error, s_plaintext ?? s_error, void 0, si_txn];
	}

	// debug info
	if(import.meta.env?.DEV) {
		console.groupCollapsed(`✅ ${Object.keys(h_exec)[0]}`);

		if(g_tx_res) {
			const {
				gas_used: sg_used,
				gas_wanted: sg_wanted,
			} = g_tx_res.result!;

			console.log(`gas used/wanted: ${sg_used}/${sg_wanted}  (${+sg_wanted! - +sg_used!}) wasted)`);
		}

		console.debug('tx: ', g_tx_res);
		console.debug('data: ', safe_json(s_plaintext) || s_plaintext);
		console.groupEnd();
	}

	// return as tuple
	return [xc_error, s_plaintext, g_tx_res!, si_txn];
};


/**
 * Sign a query permit and return the encoded object ready for use in a query
 * @param k_wallet 
 * @param si_permit 
 * @param a_tokens 
 * @param a_permissions 
 * @returns 
 */
export const sign_secret_query_permit = async(
	k_wallet: Wallet,
	si_permit: string,
	a_tokens: WeakAccountAddr<'secret'>[],
	a_permissions: string[]
): Promise<SecretQueryPermit> => {
	// prep params
	const g_params: PermitConfig = {
		permit_name: si_permit,
		allowed_tokens: a_tokens as CwAccountAddr<'secret'>[],
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
				value: bytes_to_base64(k_wallet.pk33),
			},
			signature: bytes_to_base64(atu8_signature),
		},
	};
};
