import {bytes_to_base64} from './encoding.js';
import {contract_response, unwrap_contract_response} from './json.js';
/* eslint-disable prefer-const */

/* eslint-disable @typescript-eslint/naming-convention */

import type {O} from 'ts-toolbelt';

import type {CosmosSigner} from './cosmos-signer.js';
import type {CreateQueryArgsAndAuthParams} from './inferencing.js';
import type {SecretContract} from './secret-contract.js';
import type {EventUnlistener} from './tendermint-event-filter.js';
import type {TendermintWs} from './tendermint-ws.js';
import type {AuthSecret, CosmosClientLcdRpcWsStruct} from './types.js';

import type {JsonObject, Nilable, Promisable, Dict} from '@blake.regalia/belt';

import type {ContractInterface, SchemaObject} from '@solar-republic/contractor';

import type {CosmosBaseAbciTxResponse} from '@solar-republic/cosmos-grpc/cosmos/base/abci/v1beta1/abci';
import type {CosmosTxGetTxResponse} from '@solar-republic/cosmos-grpc/cosmos/tx/v1beta1/service';
import type {TendermintAbciExecTxResult} from '@solar-republic/cosmos-grpc/tendermint/abci/types';
import type {SlimCoin, WeakAccountAddr, WeakUint128Str, WeakUintStr, WeakSecretAccAddr, Snip24QueryPermitSigned, Snip24QueryPermitParams, Snip24QueryPermitMsg, CwHexUpper} from '@solar-republic/types';

import {__UNDEFINED, timeout, parse_json_safe, die, assign, hex_to_bytes, stringify_json, try_async, is_error, defer} from '@blake.regalia/belt';
import {safe_base64_to_bytes} from '@solar-republic/cosmos-grpc';
import {XC_PROTO_COSMOS_TX_BROADCAST_MODE_SYNC, queryCosmosTxGetTx, submitCosmosTxBroadcastTx} from '@solar-republic/cosmos-grpc/cosmos/tx/v1beta1/service';

import {GC_NEUTRINO} from './config.js';
import {create_and_sign_tx_direct, sign_amino} from './cosmos-signer.js';
import {emit_diagnostic} from './diagnostics.js';
import {secret_response_decrypt} from './secret-response.js';
import {F_TEF_RESTART_ANY_ERRORS, SX_QUERY_TM_EVENT_TX, TendermintEventFilter} from './tendermint-event-filter.js';
import {index_abci_events} from './util.js';

/**
 * A synthetic struct for carrying metadata associated with a transaction that may have succeeded or failed.
 * The underlying source of data may have come from either {@link TendermintAbciExecTxResult} (Tendermint event)
 * or {@link CosmosBaseAbciTxResponse} (Cosmos LCD tx query response).
 */
export type TxMeta = {
	height: WeakUintStr;
	gas_wanted: WeakUintStr;
	gas_used: WeakUintStr;
	txhash: string;
	log?: string | undefined;
	code?: number;
	codespace?: string;
};

/**
 * Encapsulates the canonicalized response of transaction, regardless of whether it came from websocket or RPC query
 * 
 *  - [0]: `xc_error: number` - error code from chain, or non-OK HTTP status code from the LCD server.
 * 		A value of `0` indicates success. A value of `-1` indicates a JSON parsing error.
 *  - [1]: `s_error: string` - on success, raw response text from the initial broadcast request (result of CheckTx).
 *  		Otherwise, the error text. Implementing members may override this field to provide more relevant error text.
 *  - [2]: `sb16_txn: CwHexUpper` - the transaction hash of the attempted transaction
 *  - [3]: `g_meta?:`{@link TxMeta `TxMeta`} - information about the tx
 *  - [4]: `h_events?: Dict<string[]>` - all event attributes indexed by their full key path
 *  - [5]: `atu8_data?: Uint8Array` - on success, the raw tx response data bytes
 */
export type TxResponseTuple = [
	xc_error: number,
	s_reslog: string,
	sb16_txn: CwHexUpper,
	g_meta?: TxMeta | undefined,
	h_events?: Dict<string[]> | undefined,
	atu8_data?: Uint8Array | undefined,
];

export type RetryParams = [
	xt_wait: number,
];

/**
 * Generic utility function to retry a given task
 * @param f_task - the task to retry having signature `(c_attempts: number) => Promisable<out>`
 * @param f_handle - handler function that determines how to proceed. return `[xt_wait: number]`
 * to indicate how long to wait before retry, or falsy to stop retrying and throw
 * @param c_attempts - reserved. do not use
 * @returns the resolved value on success, or the last error to be thrown on maximum failure
 */
export const retry = async<w_out>(
	f_task: (c_attempts: number) => Promisable<w_out>,
	f_handle: (z_error: unknown, c_attempts: number) => Promisable<RetryParams | Nilable<void>>,
	c_attempts=0
): Promise<w_out> => {
	// attempt to perform the task and return its result
	try {
		return await f_task(c_attempts);
	}
	// an error was thrown
	catch(z_rejection) {
		// forward rejection and attempt count to handler
		const a_retry = await f_handle(z_rejection, ++c_attempts);

		// caller wants to retry
		if(a_retry) {
			// observe timeout
			await timeout(a_retry[0] || 0);

			// retry
			return await retry(f_task, f_handle, c_attempts);
		}

		// throw
		die('Retried '+c_attempts+'x: '+f_task+'\n'+(is_error(z_rejection)? z_rejection.stack || z_rejection.message: ''), z_rejection);
	}
};


export type TxWaitOptions = {
	/** Total time including socket setup and broadcast, defaults to 120 seconds. */
	timeoutMs?: number;
	signal?: AbortSignal;
};

/** A local wait ended without establishing whether the transaction was included. */
export class TxWaitError extends Error {
	readonly inclusion = 'unknown';
	constructor(readonly txhash: string, readonly reason: 'timeout' | 'aborted') {
		super(`Transaction wait ${reason}; inclusion is unknown`);
		this.name = 'TxWaitError';
	}
}

const with_tx_wait = async(
	gc_node: CosmosClientLcdRpcWsStruct,
	sb16_txn: string,
	g_options: TxWaitOptions,
	f_task: (gc_scoped: CosmosClientLcdRpcWsStruct, d_signal: AbortSignal) => Promise<TxResponseTuple>
): Promise<TxResponseTuple> => {
	const xt_total = g_options.timeoutMs ?? 120_000;
	if(!Number.isSafeInteger(xt_total) || xt_total <= 0 || xt_total > 0x7fffffff) throw Error('Invalid transaction deadline');
	const d_abort = new AbortController();
	let fe_stop!: (e_error: Error) => void;
	const dp_stop = new Promise<never>((_resolve, reject) => { fe_stop = reject; });
	const stop = (s_reason: 'timeout' | 'aborted') => {
		const e_error = new TxWaitError(sb16_txn, s_reason);
		fe_stop(e_error);
		d_abort.abort(e_error);
	};

	const on_abort = () => stop('aborted');
	const i_deadline = setTimeout(() => stop('timeout'), xt_total);
	g_options.signal?.addEventListener('abort', on_abort, {once:true});
	const gc_scoped = {
		...gc_node,
		lcd: {
			...gc_node.lcd,
			lcd: (s_path: string, g_init?: RequestInit) => gc_node.lcd.lcd(s_path, {
				...g_init,
				signal: g_init?.signal? AbortSignal.any([g_init.signal, d_abort.signal]): d_abort.signal,
			}),
		},
	};
	try {
		if(g_options.signal?.aborted) { on_abort(); return await dp_stop; }

		return await Promise.race([dp_stop, f_task(gc_scoped, d_abort.signal)]);
	}
	finally {
		clearTimeout(i_deadline);
		g_options.signal?.removeEventListener('abort', on_abort);
		d_abort.abort();
	}
};

/**
 * Starts monitoring the chain in anticipation of a new transaction with the given hash
 */
const monitor_tx = async(
	gc_node: CosmosClientLcdRpcWsStruct,
	sb16_txn: string,
	z_stream?: TendermintEventFilter | TendermintWs,
	xt_wait_before_polling=GC_NEUTRINO.WS_TIMEOUT*3,
	xt_polling_interval=GC_NEUTRINO.POLLING_INTERVAL,
	d_signal?: AbortSignal
): Promise<[
	fk_unlisten: EventUnlistener,
	dp_monitor: Promise<TxResponseTuple>,
	fke_monitor: {
		(w_return: TxResponseTuple): void;
		(w_return: Nilable<void>, e_reject: Error): void;
	},
	f_set_res: (sx_override: string) => void,
]> => {
	// create deferred promise
	const [dp_monitor, fke_monitor] = defer<TxResponseTuple>();
	// A monitor may fail while the caller is still awaiting broadcast.
	void dp_monitor.catch(() => __UNDEFINED);

	// event filter unlistener
	let f_unlisten: EventUnlistener | undefined;

	// if set, indicates that LCD query should be repeated with this timeout value
	let xt_polling: number | undefined;

	// fallback timeout
	let i_fallback: number | NodeJS.Timeout | undefined;

	let b_torn_down = false;
	const on_abort = () => f_shutdown(null, d_signal!.reason as Error);
	// teardown
	let f_teardown = () => {
		if(b_torn_down) return;
		b_torn_down = true;
		d_signal?.removeEventListener('abort', on_abort);
		clearTimeout(i_fallback);
		i_fallback = __UNDEFINED;
		xt_polling = __UNDEFINED;
		// unlisten events filter
		f_unlisten?.();

		// Dispose a wrapper created here, even when its underlying socket is shared.
		if(!(z_stream as TendermintEventFilter | undefined)?.when) k_tef?.dispose?.();
	};

	// shutdown
	// eslint-disable-next-line no-sequences
	let f_shutdown = (w_resolve: Nilable<TxResponseTuple>, e_reject?: Nilable<Error>) => (f_teardown(), fke_monitor(w_resolve as void, e_reject!));

	let c_failures = 0;
	const run_fallback = () => { void attempt_fallback_lcd_query().catch((e_error: unknown) => f_shutdown(null, e_error instanceof Error? e_error: Error('Transaction query failed'))); };

	// polling fallback using LCD query
	let attempt_fallback_lcd_query = async() => {
		// submit query request
		const [a_resolved, e_thrown] = await try_async(() => queryCosmosTxGetTx(gc_node.lcd, sb16_txn));

		// timeout was cancelled while querying; silently exit
		if(!i_fallback) return;

		// Retry transient reads only; never re-sign or re-broadcast a transaction.
		if(e_thrown || 429 === a_resolved?.[2].status || (a_resolved?.[2].status ?? 0) >= 500) {
			i_fallback = setTimeout(run_fallback, Math.min(30_000, xt_polling_interval * (2 ** Math.min(++c_failures, 5))));
			return;
		}

		c_failures = 0;

		// destructure resolved value
		const [g_res, g_err, d_res, s_res] = a_resolved!;

		// successful
		if(g_res) {
			// make fields compulsory
			const g_tx_res = g_res.tx_response as O.Compulsory<CosmosBaseAbciTxResponse>;

			// resolve
			f_shutdown(g_tx_res? [
				g_tx_res.code ?? 0,
				g_tx_res.raw_log || s_res,
				sb16_txn as CwHexUpper,
				assign({
					log: g_tx_res.raw_log,
					txhash: g_tx_res.txhash,
				}, g_tx_res),
				index_abci_events(g_tx_res.events || []),
				g_tx_res.data? hex_to_bytes(g_tx_res.data): __UNDEFINED,
			]: [
				-1,
				s_res,
				sb16_txn as CwHexUpper,
			]); return;
		}
		// error
		else if(g_err) {
			// destructure parsed response body
			const {
				code: xc_code,
				message: s_msg,
			} = g_err;

			// anything other than tx not found indicates a possible node error
			if(xc_code !== 5 && !(s_msg || '').includes('tx not found')) {
				// reject Promise
				f_shutdown(null, Error(`Unexpected query error to ${gc_node.lcd.id}: ${stringify_json(g_err)}`)); return;
			}
		}
		// invalid response body
		else {
			f_shutdown(null, Error(`Server at ${gc_node.lcd.id} returned ${d_res.status} code with invalid body: ${sx_res}`)); return;
		}

		// repeat
		if(xt_polling) i_fallback = setTimeout(run_fallback, xt_polling);
	};

	if(d_signal?.aborted) throw d_signal.reason;
	d_signal?.addEventListener('abort', on_abort, {once:true});

	// prep event filter
	let k_tef = z_stream as TendermintEventFilter;

	// normalize stream arg into event filter
	if(!(z_stream as TendermintEventFilter | undefined)?.when) {
		// attempt to create filter
		const [k_tef_local] = await try_async(
			() => TendermintEventFilter(gc_node.ws || gc_node.rpc.origin, SX_QUERY_TM_EVENT_TX, F_TEF_RESTART_ANY_ERRORS, z_stream as TendermintWs | undefined, d_signal)
		);

		if(b_torn_down) { k_tef_local?.dispose?.(); throw d_signal?.reason; }

		// timed out waiting to connect; start polling
		if(!k_tef_local) {
			i_fallback = setTimeout(run_fallback, xt_polling=xt_polling_interval);
		}
		// succeeded; set filter
		else {
			k_tef = k_tef_local!;
		}
	}

	// in case WebSocket is silently dead and polling hasn't already been scheduled
	if(!i_fallback) {
		// set polling rate
		xt_polling = xt_polling_interval;

		// start attempting fallback queries
		i_fallback = setTimeout(run_fallback, xt_wait_before_polling);
	}

	// prep broadcast response (result of CheckTx)
	let sx_res = '';

	// listen for tx hash event
	f_unlisten = k_tef?.when('tx.hash', sb16_txn, ({value:{TxResult:g_txres}}, h_events) => {
		// ref result struct
		const g_result = g_txres?.result as O.Compulsory<TendermintAbciExecTxResult>;

		// return parsed result
		f_shutdown(g_txres? [
			g_txres.result?.code ?? 0,
			g_result.log || sx_res,
			sb16_txn as CwHexUpper,
			assign({
				height: g_txres.height!,
				txhash: sb16_txn,
			}, g_result),
			h_events,
			safe_base64_to_bytes(g_result.data),
		]: [
			-1,
			sx_res,
			sb16_txn as CwHexUpper,
			__UNDEFINED,
			h_events,
		]);
	}, attempt_fallback_lcd_query);

	// return tuple
	return [() => {
		// cancel polling timeout
		i_fallback = clearTimeout(i_fallback) as undefined;

		// teardown
		f_teardown();
	}, dp_monitor, fke_monitor, (sx_override_res: string) => sx_res = sx_override_res];
};


/**
 * Starts monitoring the chain in anticipation of a new transaction with the given hash
 * @param gc_node 
 * @param sb16_txn 
 * @param z_stream 
 * @returns a {@link TxResponseTuple}
 * 
 * Which is a tuple of `[number, string,`{@link TxMeta `TxMeta`}`?, Uint8Array?, Dict<string[]>]`
 *  - [0]: `xc_code: number` - error code from chain, or non-OK HTTP status code from the LCD server.
 * 		A value of `0` indicates success. A value of `-1` indicates a JSON parsing error.
 *  - [1]: `sx_res: string` - raw response text from the initial broadcast request (result of CheckTx)
 *  - [2]: `g_meta?:`{@link TxMeta `TxMeta`} - information about the tx
 *  - [3]: `atu8_data?: Uint8Array` - on success, the tx response data
 *  - [4]: `h_events?: Dict<string[]>` - all event attributes indexed by their full key path
 */
export const expect_tx = async(
	gc_node: CosmosClientLcdRpcWsStruct,
	sb16_txn: string,
	z_stream?: TendermintEventFilter | TendermintWs,
	g_options: TxWaitOptions={}
): Promise<TxResponseTuple> => with_tx_wait(gc_node, sb16_txn, g_options, async(gc_scoped, d_signal) => {
	const [, dp_monitor] = await monitor_tx(gc_scoped, sb16_txn, z_stream, __UNDEFINED, __UNDEFINED, d_signal);
	return dp_monitor;
});


/**
 * Broadcast a transaction to the network for its result
 * @param gc_node - 
 * @param atu8_raw -  
 * @param sb16_txn -
 * @param z_stream - 
 * @returns a {@link TxResponseTuple}
 * 
 * Which is a tuple of `[number, string,`{@link TxMeta `TxMeta`}`?, Uint8Array?, Dict<string[]>]`
 * 
 *  - [0]: `xc_error: number` - error code from chain, or non-OK HTTP status code from the LCD server.
 * 		A value of `0` indicates success. A value of `-1` indicates a JSON parsing error.
 *  - [1]: `s_res: string` - raw response text from the initial broadcast request (result of CheckTx)
 *  		Implementing members may override this field to provide more relevant error text.
 *  - [2]: `sb16_txn: CwHexUpper` - the transaction hash of the attempted transaction
 *  - [3]: `g_meta?:`{@link TxMeta `TxMeta`} - information about the tx
 *  - [4]: `h_events?: Dict<string[]>` - all event attributes indexed by their full key path
 *  - [5]: `atu8_data?: Uint8Array` - on success, the raw tx response data bytes
 */
export const broadcast_result = async(
	gc_node: CosmosClientLcdRpcWsStruct,
	atu8_raw: Uint8Array,
	sb16_txn: string,
	z_stream?: TendermintEventFilter | TendermintWs,
	xt_wait_before_polling?: number,
	xt_polling_interval?: number,
	g_options: TxWaitOptions={}
): Promise<TxResponseTuple> => with_tx_wait(gc_node, sb16_txn, g_options, async(gc_scoped, d_signal) => {
	// start monitoring tx
	const [f_unlisten, dp_monitor, fke_monitor, f_set_res] = await monitor_tx(gc_scoped, sb16_txn, z_stream, xt_wait_before_polling, xt_polling_interval, d_signal);

	// attempt to submit tx
	const g_first = await Promise.race([
		dp_monitor.then(a_result => ({monitor:a_result})),
		try_async(() => submitCosmosTxBroadcastTx(gc_scoped.lcd, atu8_raw, XC_PROTO_COSMOS_TX_BROADCAST_MODE_SYNC)).then(a_result => ({broadcast:a_result})),
	]);
	if('monitor' in g_first) return g_first.monitor;
	const [a_broadcast, e_broadcast] = g_first.broadcast;
	if(!a_broadcast) {
		f_unlisten();
		fke_monitor(__UNDEFINED, e_broadcast as Error);
		return dp_monitor;
	}

	const [g_res,, d_res, sx_res_broadcast] = a_broadcast;

	// set value
	f_set_res(sx_res_broadcast);

	// not ok HTTP code, no parsed JSON, or non-zero response code
	if(!d_res.ok || !g_res || g_res.tx_response?.code) {
		// unlisten events filter
		f_unlisten?.();

		// some failures still contain enough to construct meta
		const g_meta = parse_json_safe<CosmosTxGetTxResponse>(sx_res_broadcast)?.tx_response;

		// resolve with error
		fke_monitor([
			d_res.ok? g_res?.tx_response?.code ?? -1: d_res.status,
			g_res?.tx_response?.raw_log || g_meta?.raw_log || sx_res_broadcast,
			sb16_txn as CwHexUpper,
			g_meta? assign({
				log: g_meta.raw_log,
			}, g_meta as TxMeta): __UNDEFINED,
		]);
	}

	// return monitor promise
	return dp_monitor;
});


/**
 * Query a Secret Contract method
 * @param k_contract 
 * @param h_query 
 * @returns tuple of `[number, string, JsonObject?]` where:
 *  - [0]: `xc_code: number` - error code from chain, or non-OK HTTP status code from the LCD server.
 * 		A value of `0` indicates success.
 *  - [1]: `s_error: string` - error message from chain or HTTP response body
 *  - [2]: `d_res: Response` - HTTP response
 *  - [3]: `h_answer?: JsonObject` - contract response as JSON object on success
 */

export const query_secret_contract_raw = async<
	g_interface extends ContractInterface,
	h_variants extends ContractInterface.MsgAndAnswer<g_interface, 'queries'>,
	g_variant extends h_variants[keyof h_variants],
>(
	k_contract: SecretContract<g_interface>,
	h_query: g_variant['msg']
): Promise<[xc_code: number, s_error: string, d_res: Response, h_answer?: g_variant['answer']]> => {
	const [xc_code, s_error, d_res, h_answer] = await k_contract.query(h_query);
	if(xc_code) return [xc_code, s_error, d_res];
	// ContractInterface types are erased; validate the envelope at this trust boundary.
	return [0, s_error, d_res, contract_response(h_answer)];
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
	h_query: SchemaObject,
	z_auth?: Nilable<AuthSecret>
): SchemaObject => {
	if('string' === typeof z_auth && z_auth) return {[si_method]: {...h_query, key:z_auth}};
	if(Array.isArray(z_auth)) return {[si_method]: {...h_query, viewer:{viewing_key:z_auth[0], ...(z_auth[1]? {address:z_auth[1]}: {})}}};
	if(z_auth) return {with_permit:{query:{[si_method]:h_query}, permit:z_auth}};
	return {[si_method]:h_query};
};


export type QueryContractInfer = <
	g_interface extends ContractInterface,
	h_variants extends ContractInterface.MsgAndAnswer<g_interface, 'queries'>=ContractInterface.MsgAndAnswer<g_interface, 'queries'>,
	si_method extends Extract<keyof h_variants, string>=Extract<keyof h_variants, string>,
	g_variant extends h_variants[si_method]=h_variants[si_method],
>(
	k_contract: SecretContract<g_interface>,
	si_method: si_method,
	...[h_args, z_auth]: CreateQueryArgsAndAuthParams<
		h_variants,
		si_method,
		ContractInterface extends g_interface? 1: 0
	>
) => Promise<[
		w_result: g_variant['response'] | undefined,
		xc_code_x: number,
		s_error: string,
		d_res: Response,
		h_answer?: g_variant['answer'],
]>;

/**
 * Query a Secret Contract method and automatically apply an auth secret if one is provided.
 * Additionally, unwrap the success response by accessing the input method name if one was returned.
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
export const query_secret_contract: QueryContractInfer = async(
	k_contract: SecretContract,
	si_method: string,
	...[h_args, z_auth]
): Promise<[w_result: JsonObject | undefined, xc_code_p: number, s_error: string, d_res: Response, h_answer?: SchemaObject]> => {
	// debug
	emit_diagnostic({operation:'query', stage:'start'});

	// query the contract
	const a4_response = await query_secret_contract_raw(k_contract, format_secret_query(si_method, contract_response(h_args || {}, 'query arguments'), z_auth));

	// debug
	emit_diagnostic({operation:'query', stage:'complete', code:a4_response[0]});

	// put unwrapped result in front
	return [
		a4_response[0]
			? __UNDEFINED
			: unwrap_contract_response(a4_response[3], si_method),
		...a4_response,
	];
};



/**
 * Execute a single Secret Contract method and wait for transaction confirmation.
 * @param k_contract - a {@link SecretContract} instance
 * @param k_wallet - the {@link CosmosSigner} of the sender
 * @param h_exec - the execution message as a plain object (to be JSON-encoded)
 * @param z_fees - either a gas price or an Array of {@link SlimCoin} describing the amounts and denoms of fees
 * @param z_limit - the u128 gas limit to set for the transaction
 * @param sa_granter - optional granter address to use to pay for gas fee
 * @param a_funds - optional Array of {@link SlimCoin} of funds to send into the contract with the tx
 * @param s_memo - optional memo field
 * @returns tuple of `[a2_result?: ExecResult, a6_response:`{@link TxResponseTuple `TxResponseTuple`}`]`
 *  - [0]: `a2_result?: ExecResult` - will be `undefined` if there was an error, otherwise a tuple where:
 *  -  - [0]: `g_res: undefined | JsonObject` - the contract's response parsed as JSON if it was parseable
 *  -  - [1]: `s_res: string` - the contract's raw response string
 *  - [1]: `a6_response: `{@link TxResponseTuple `TxResponseTuple`} - the response from broadcasting the transaction
 * 
 * @throws a {@link BroadcastResultErr}
 */
export const exec_secret_contract = async<
	g_interface extends ContractInterface,
	h_group extends ContractInterface.MsgAndAnswer<g_interface, 'executions'>=ContractInterface.MsgAndAnswer<g_interface, 'executions'>,
	as_methods extends Extract<keyof h_group, string>=Extract<keyof h_group, string>,
>(
	k_contract: SecretContract<g_interface>,
	k_wallet: CosmosSigner<'secret'>,
	h_exec: ContractInterface extends g_interface? JsonObject: {
		[si_each in as_methods]: h_group[si_each]['msg'];
	},
	z_limit: WeakUint128Str | bigint,
	z_fees?: [SlimCoin, ...SlimCoin[]] | number,
	sa_granter?: WeakSecretAccAddr | '',
	a_funds?: SlimCoin[],
	s_memo?: string
): Promise<[
	a_result: undefined | [
		g_res: (ContractInterface extends g_interface? JsonObject: h_group[as_methods]['answer']) | undefined,
		s_res: string,
	],
	a6_broadcast: TxResponseTuple,
]> => {
	// construct execution message and save nonce
	let [atu8_msg, atu8_nonce] = await k_contract.exec(h_exec, k_wallet.addr, a_funds);

	// sign in direct mode
	let [atu8_tx_raw, si_txn] = await create_and_sign_tx_direct(
		k_wallet,
		[atu8_msg],
		z_limit+'' as WeakUint128Str,
		z_fees,
		0,
		s_memo,
		sa_granter
	);

	// debug info
	emit_diagnostic({operation:'execute', stage:'start'});

	// broadcast to chain
	const a6_broadcast = await broadcast_result(k_wallet, atu8_tx_raw, si_txn);

	// detuple broadcast result
	const [xc_error, sx_res] = a6_broadcast;

	// invalid json
	if(xc_error < 0) return [__UNDEFINED, a6_broadcast];

	// decrypt response
	const [a_error, a_results] = await secret_response_decrypt(k_contract.wasm, a6_broadcast, [atu8_nonce]);

	// error
	if(xc_error) {
		// debug info
		emit_diagnostic({operation:'execute', stage:'complete', code:xc_error});

		// set error text
		a6_broadcast[1] = a_error?.[0] ?? sx_res;

		// entuple error
		return [__UNDEFINED, a6_broadcast];
	}

	// detuple results from single message response success
	const a_result = a_results?.[0]?.[0];
	if(!a_result) throw Error('Missing contract execution response');
	const [s_plaintext, g_answer] = a_result;
	if(__UNDEFINED !== g_answer) contract_response(g_answer);

	// debug info
	emit_diagnostic({operation:'execute', stage:'complete', code:0});

	// entuple results
	return [[g_answer, s_plaintext], a6_broadcast];
};


/**
 * Sign a query permit and return the encoded object ready for use in a query
 * @param k_wallet 
 * @param si_permit 
 * @param a_tokens 
 * @param a_permissions 
 * @returns 
 */
export const snip24_amino_sign = async(
	k_wallet: CosmosSigner,
	si_permit: string,
	a_tokens: WeakAccountAddr<'secret'>[],
	a_permissions: string[]
): Promise<Snip24QueryPermitSigned> => {
	// prep params
	const g_params: Snip24QueryPermitParams = {
		permit_name: si_permit,
		allowed_tokens: a_tokens,
		permissions: a_permissions,
	};

	// sign query permit
	const [atu8_signature, g_signed] = await sign_amino<[Snip24QueryPermitMsg]>(k_wallet, [{
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
