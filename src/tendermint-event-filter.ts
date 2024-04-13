import type {JsonRpcResponse, TendermintEvent, TxResultWrapper} from './types';
import type {StringFilter} from './util';
import type {Dict, JsonObject, Promisable} from '@blake.regalia/belt';
import type {TrustedContextUrl} from '@solar-republic/types';

import {parse_json_safe, entries, remove, try_sync, values, is_function, die} from '@blake.regalia/belt';

import {TendermintWs, type TendermintWsRestartParam} from './tendermint-ws';
import {string_matches_filter} from './util';

export type EventListener<
	g_data extends JsonObject=TxResultWrapper,
> = (g_data: g_data, h_events: Dict<string[]>) => Promisable<void>;

export type EventUnlistener = () => void;

export const SX_QUERY_TM_EVENT_TX = `tm.event='Tx'`;

export type TendermintEventFilter<
	g_data extends JsonObject=TxResultWrapper,
> = {
	/**
	 * Returns the current {@link WebSocket}.
	 */
	ws(): WebSocket;

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
		f_restarted?: ((d_ws: WebSocket) => Promisable<void>) | undefined,
	): EventUnlistener;
};

/**
 * Opens a new JSON-RPC WebSocket subscribing the the Tendermint Event stream and returns an instance allowing
 * callers to add listeners by filtering for specific events.
 * 
 * To terminate the connecting, callers should close the WebSocket via `.ws.close()`.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const TendermintEventFilter = async<
	g_data extends JsonObject=TxResultWrapper,
>(
	p_rpc: TrustedContextUrl,
	sx_query=SX_QUERY_TM_EVENT_TX,
	z_restart?: TendermintWsRestartParam | undefined,
	z_ws?: TendermintWs | typeof WebSocket
): Promise<TendermintEventFilter<g_data>> => {
	// dict of filters by event key
	const h_filters: Dict<Readonly<[
		z_filter: StringFilter,
		f_listener: EventListener<g_data>,
		f_restarted: ((d_ws: WebSocket) => Promisable<void>) | undefined,
	]>[]> = {};

	// subscribe to Tx events
	const k_ws = z_ws instanceof TendermintWs
		? z_ws as TendermintWs
		: await TendermintWs(p_rpc, sx_query, (d_event) => {
			// parse event JSON
			const g_result = parse_json_safe<JsonRpcResponse<TendermintEvent<g_data>>>(d_event.data)?.result;

			// ignore null events and parsing errors
			if(g_result) {
				// prep values
				let a_values: string[];

				// each filter
				for(const [si_key, a_parties] of entries(h_filters)) {
					// values exist
					// eslint-disable-next-line no-cond-assign
					if(a_values=g_result.events[si_key]) {
						// each interested party
						FINDING_PARTIES:
						for(const [z_filter, f_listener] of a_parties) {
							// each value
							for(const s_value of a_values) {
								// matches filter
								if(string_matches_filter(s_value, z_filter)) {
									// call listener
									// eslint-disable-next-line @typescript-eslint/no-floating-promises
									try_sync(() => f_listener(g_result.data.value, g_result.events));

									// continue with next party
									continue FINDING_PARTIES;
								}
							}
						}
					}
				}
			}
		}, z_restart? d_event => async(d_ws) => {
			// each filter
			for(const a_parties of values(h_filters)) {
				// each party
				for(const a_party of a_parties) {
					// notify restart handler if defined
					void try_sync(() => a_party[2]?.(d_ws));
				}
			}

			// forward restart signal to restart handler
			const z_returned = is_function(z_restart)? await z_restart(d_event): z_restart;

			// apply callback if returned
			if(is_function(z_returned)) void z_returned(d_ws);
		}: z_restart, z_ws as typeof WebSocket | undefined);

	// properties and methods
	return {
		// the WebSocket
		ws: () => k_ws.ws(),

		// adds event listeners
		when(si_key, z_value, f_listener, f_restarted): EventUnlistener {
			// construct party tuple
			const a_party = [z_value, f_listener, f_restarted] as const;

			// upsert filter key
			const a_filters = h_filters[si_key] ??= [];

			// add party to filter
			a_filters.push(a_party);

			// return unlistener
			return () => remove(a_filters, a_party);
		},
	};
};
