
import type {JsonRpcResponse} from './types.js';
import type {NaiveJsonString, Promisable} from '@blake.regalia/belt';
import type {TrustedContextUrl} from '@solar-republic/types';

import {__UNDEFINED, is_function, parse_json_safe, stringify_json} from '@blake.regalia/belt';

import {GC_NEUTRINO} from './config.js';


export type TendermintWsRestartParam = boolean | 0 | 1 | ((d_event: CloseEvent | undefined) => Promisable<
		boolean | 0 | 1 | (
			(d_ws: WebSocket) => Promisable<void>
		)
>);

export type TendermintWs = {
	/**
	 * Returns the current {@link WebSocket}.
	 */
	ws(): WebSocket;
	/** Stop reconnecting and close owned resources. */
	dispose?(): void;
	/** Subscribe across socket replacements without replacing another consumer. */
	listen?(f_message: (d_event: MessageEvent<NaiveJsonString>) => unknown, f_restarted?: (d_ws: WebSocket) => unknown): () => void;
};



/**
 * Opens a new Tendermint JSONRPC WebSocket and immediately subscribes using the given query.
 * Returns a Promise that resolves once a subscription confirmation message is received.
 * Users should close the WebSocket when no longer needed
 * @param p_rpc - RPC endpoint as an HTTPS base URL without trailing slash, e.g., "https://rpc.provider.net"
 * @param sx_query - the Tendermint query to filter events by, e.g., "tm.event='Tx'"
 * @param fk_message - callback for each message
 * @returns - the WebSocket instance
 */
export const subscribe_tendermint_events = (
	p_rpc: TrustedContextUrl | `wss://${string}`,
	sx_query: string,
	fk_message: (d_event: MessageEvent<NaiveJsonString>) => any,
	dc_ws=WebSocket,
	xt_timeout=GC_NEUTRINO.WS_TIMEOUT,
	d_signal?: AbortSignal
): Promise<WebSocket> => new Promise((fk_resolve, fe_reject) => {
	const d_ws = new dc_ws(p_rpc.replace(/^http/, 'ws').replace(/\/+$/, '')+'/websocket');
	let b_settled = false;
	const f_fail = (e_error: Error) => {
		if(b_settled) return;
		b_settled = true;
		d_signal?.removeEventListener('abort', f_abort);
		clearTimeout(z_open_timer);
		d_ws.onmessage = d_ws.onopen = d_ws.onclose = null;
		fe_reject(e_error);
		d_ws.close();
	};

	const f_abort = () => f_fail(Error('WebSocket subscription aborted'));
	// Covers both connecting and waiting for the subscription acknowledgement.
	const z_open_timer = setTimeout(() => f_fail(Error(`Timed out subscribing to ${p_rpc}`)), xt_timeout);
	d_ws.onopen = () => {
		try {
			d_ws.send(stringify_json({jsonrpc:'2.0', id:'0', method:'subscribe', params:{query:sx_query}}));
		}
		catch(e_error) { f_fail(e_error as Error); }
	};

	d_ws.onmessage = (g_msg) => {
		const g_data = parse_json_safe<JsonRpcResponse<Record<string, never>>>(g_msg.data as NaiveJsonString);
		if(String(g_data?.id) !== '0' || g_data?.error || !g_data?.result || Array.isArray(g_data.result) || typeof g_data.result !== 'object' || Object.keys(g_data.result).length !== 0) {
			f_fail(Error('Invalid WebSocket subscription acknowledgement')); return;
		}

		b_settled = true;
		d_signal?.removeEventListener('abort', f_abort);
		clearTimeout(z_open_timer);
		d_ws.onmessage = fk_message;
		d_ws.onclose = null;
		fk_resolve(d_ws);
	};

	d_ws.onerror = () => f_fail(Error(`WebSocket error at ${p_rpc}`));
	d_ws.onclose = () => f_fail(Error(`WebSocket closed before subscription at ${p_rpc}`));
	d_signal?.addEventListener('abort', f_abort, {once:true});
	if(d_signal?.aborted) f_abort();
});


// eslint-disable-next-line @typescript-eslint/naming-convention
export const TendermintWs = async(
	p_rpc: TrustedContextUrl,
	sx_query: string,
	fk_message: (d_event: MessageEvent<NaiveJsonString>) => any,
	z_restart?: TendermintWsRestartParam,
	dc_ws?: typeof WebSocket,
	d_signal?: AbortSignal
): Promise<TendermintWs> => {
	let d_ws!: WebSocket;
	let b_disposed = false;
	const d_abort = new AbortController();
	const d_lifetime = d_signal? AbortSignal.any([d_signal, d_abort.signal]): d_abort.signal;
	const as_listeners = new Set<readonly [(d_event: MessageEvent<NaiveJsonString>) => unknown, (((d_ws: WebSocket) => unknown) | undefined)?]>();
	// WebSocket event handlers do not observe returned promises.
	const f_observe = (f_call: () => unknown) => { void Promise.resolve().then(f_call).catch(() => { /* Native event dispatch cannot observe rejections. */ }); };

	const f_dispatch = (d_event: MessageEvent<NaiveJsonString>) => {
		f_observe(() => fk_message(d_event));
		for(const [f_message] of as_listeners) f_observe(() => f_message(d_event));
	};

	const f_connect = async(): Promise<void> => {
		const d_next = await subscribe_tendermint_events(p_rpc, sx_query, f_dispatch, dc_ws, GC_NEUTRINO.WS_TIMEOUT, d_lifetime);
		if(b_disposed) { d_next.close(); return; }

		d_ws = d_next;
		d_ws.onclose = d_event => f_observe(async() => {
			if(b_disposed) return;
			const z_decision = is_function(z_restart)? await z_restart(d_event): z_restart;
			if(!z_decision || b_disposed) return;
			try { await f_connect(); }
			catch{
				// One reconnect attempt per close; notify failure without an unbounded retry loop.
				if(!b_disposed && is_function(z_restart)) await z_restart(__UNDEFINED);
				return;
			}

			if(b_disposed) return;
			const d_current = d_ws;
			for(const [, f_restarted] of as_listeners) f_observe(() => f_restarted?.(d_current));
			if(is_function(z_decision)) await z_decision(d_ws);
		});
	};

	await f_connect();
	return {
		ws: () => d_ws,
		listen(f_message, f_restarted) {
			if(b_disposed) throw Error('WebSocket is disposed');
			const a_listener = [f_message, f_restarted] as const;
			as_listeners.add(a_listener);
			return () => { as_listeners.delete(a_listener); };
		},
		dispose() {
			b_disposed = true;
			d_abort.abort();
			as_listeners.clear();
			d_ws.onclose = d_ws.onmessage = null;
			d_ws.close();
		},
	};
};
