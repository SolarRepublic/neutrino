import type {JsonRpcResponse, TendermintEvent, TxResultWrapper} from './types.js';
import type {StringFilter} from './util.js';
import type {Dict, Promisable} from '@blake.regalia/belt';
import type {TrustedContextUrl} from '@solar-republic/types';

import {__UNDEFINED, parse_json_safe, entries, remove, values, is_function} from '@blake.regalia/belt';

import {TendermintWs} from './tendermint-ws.js';
import {string_matches_filter} from './util.js';


export type TendermintEventDataTx = {
	type: `tendermint/event/Tx`;
	value: TxResultWrapper;
};

export type EventListener<
	g_data extends TendermintEvent['data']=TendermintEventDataTx,
> = (g_data: g_data, h_events: Dict<string[]>) => Promisable<void>;

export type EventUnlistener = () => void;

export type JsonRpcErrorHandler = (
	d_event: CloseEvent | undefined,
	e_error?: Error
) => Promisable<
	void | undefined | boolean | 0 | 1 | (
		(d_ws: WebSocket) => Promisable<void>
	)
>;

export const SX_QUERY_TM_EVENT_TX = `tm.event='Tx'`;

export type TendermintEventFilter<
	g_data extends TendermintEvent['data']=TendermintEventDataTx,
> = {
	/**
	 * Returns the current {@link WebSocket}.
	 */
	ws(): WebSocket;
	/** Detach listeners and close the socket only if this filter created it. */
	dispose?(): void;

	/**
	 * Adds a listener to be called when the specified event key is seen and has at least one value matching
	 * the given filter. Returns a function that can be called to remove the listener.
	 * @param si_key - the event attribute key to find
	 * @param z_filter - a {@link StringFilter} to test against each attribute value when searching for a match
	 * @param f_listener - the callback to execute when a match is found
	 * @param f_restarted - optional handler for when the socket restarts
	 */
	when(
		si_key: string,
		z_filter: StringFilter,
		f_listener: EventListener<g_data>,
		f_restarted?: (d_ws: WebSocket) => Promisable<void>,
	): EventUnlistener;
};

/**
 * Opens a new JSON-RPC WebSocket subscribing the the Tendermint Event stream and returns an instance allowing
 * callers to add listeners by filtering for specific events.
 * 
 * To terminate the connecting, callers should call `.dispose()`. Shared sockets remain open.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const TendermintEventFilter = async<
	g_data extends TendermintEvent['data']=TendermintEventDataTx,
>(
	p_rpc: TrustedContextUrl,
	sx_query=SX_QUERY_TM_EVENT_TX,
	f_errors?: JsonRpcErrorHandler,
	z_ws?: TendermintWs | typeof WebSocket,
	d_signal?: AbortSignal
): Promise<TendermintEventFilter<g_data>> => {
	const h_filters: Dict<Readonly<[
		z_filter: StringFilter,
		f_listener: EventListener<g_data>,
		f_restarted: ((d_ws: WebSocket) => Promisable<void>) | undefined,
	]>[]> = Object.create(null) as Dict<never>;
	let b_disposed = false;
	const f_report = async(e_error: unknown) => {
		try { await f_errors?.(__UNDEFINED, e_error instanceof Error? e_error: Error('Event listener failed')); }
		catch{ /* Error reporting must not create unhandled rejections. */ }
	};

	const f_restarted_all = async(d_ws: WebSocket) => {
		for(const a_parties of values(h_filters)) {
			for(const a_party of [...a_parties]) {
				try { await a_party[2]?.(d_ws); }
				catch(e_error) { await f_report(e_error); }
			}
		}
	};

	const f_dispatch = async(d_event: MessageEvent<string>) => {
		if(b_disposed) return;
		try {
			const g_message = parse_json_safe<JsonRpcResponse<TendermintEvent<g_data['value']>>>(d_event.data);
			const g_result = g_message?.result;
			if(!g_result?.data || !g_result.events || typeof g_result.events !== 'object') {
				throw Error(g_message?.error? `JSON-RPC error code ${g_message.error.code}`: 'Malformed Tendermint event');
			}

			for(const [si_key, a_parties] of entries(h_filters)) {
				const a_values = g_result.events[si_key];
				if(!Array.isArray(a_values) || !a_values.every(s => 'string' === typeof s)) continue;
				// Snapshot: self-removal must not skip the next listener.
				for(const [z_filter, f_listener] of [...a_parties]) {
					if(b_disposed) return;
					try {
						if(a_values.some(s => string_matches_filter(s, z_filter))) await f_listener(g_result.data as g_data, g_result.events);
					}
					catch(e_error) { await f_report(e_error); }
				}
			}
		}
		catch(e_error) { await f_report(e_error); }
	};

	let dp_queue = Promise.resolve();
	const f_receive = (d_event: MessageEvent<string>) => {
		dp_queue = dp_queue.then(() => f_dispatch(d_event));
		return dp_queue;
	};

	const b_shared = is_function((z_ws as {ws:unknown})?.ws);
	const k_ws = b_shared? z_ws as TendermintWs: await TendermintWs(p_rpc, sx_query, f_receive, async(d_event) => {
		// Decide BEFORE reconnecting; false means stop.
		const z_decision = await f_errors?.(d_event);
		if(!z_decision) return false;
		return async(d_ws) => {
			await f_restarted_all(d_ws);
			if(is_function(z_decision)) await z_decision(d_ws);
		};
	}, z_ws as typeof WebSocket | undefined, d_signal);
	let f_detach = () => { /* No shared listener to detach yet. */ };

	if(b_shared) {
		if(k_ws.listen) {f_detach = k_ws.listen(f_receive, f_restarted_all);}
		else {
			// Legacy handles can attach to the current socket; only managed handles
			// with listen() can follow subsequent socket replacements.
			const d_ws = k_ws.ws();
			d_ws.addEventListener('message', f_receive);
			f_detach = () => d_ws.removeEventListener('message', f_receive);
		}
	}

	return {
		ws: () => k_ws.ws(),
		dispose() {
			if(b_disposed) return;
			b_disposed = true;
			f_detach();
			for(const si_key of Object.keys(h_filters)) delete h_filters[si_key];
			if(!b_shared) k_ws.dispose?.();
		},
		when(si_key, z_value, f_listener, f_restarted): EventUnlistener {
			if(b_disposed) throw Error('Event filter is disposed');
			const a_party = [z_value, f_listener, f_restarted] as const;
			const a_filters = h_filters[si_key] ??= [];
			a_filters.push(a_party);
			return () => { remove(a_filters, a_party); };
		},
	};
};


export const F_TEF_RESTART_SOCKET_FAILURE_BUT_IGNORE_RPC_ERRORS: JsonRpcErrorHandler = d_event => !!d_event;
export const F_TEF_RESTART_ANY_ERRORS: JsonRpcErrorHandler = () => 1;
