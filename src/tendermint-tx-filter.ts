import type {JsonRpcResponse, TendermintEvent} from './types';
import type {StringFilter} from './util';
import type {Dict} from '@blake.regalia/belt';
import type {TendermintAbciTxResult} from '@solar-republic/cosmos-grpc/tendermint/abci/types';
import type {TrustedContextUrl} from '@solar-republic/types';

import {parse_json_safe, entries, remove} from '@blake.regalia/belt';

import {subscribe_tendermint_events} from './app-layer';
import {string_matches_filter} from './util';

export type TxListener = (g_txres: TendermintAbciTxResult, h_events: Dict<string[]>) => void;

export type TxUnlistener = () => void;

export type TendermintTxEventFilter = {
	/**
	 * {@link WebSocket} created during construction.
	 */
	ws: WebSocket;

	/**
	 * Adds a listener to be called when the specified event key is seen and has at least one value matching
	 * the given filter. Returns a function that can be called to remove the listener.
	 * @param si_key - the event attribute key to find
	 * @param z_filter - a {@link StringFilter} to test against each attribute value when searching for a match
	 * @param f_listener - the callback to execute when a match is found
	 */
	when(
		si_key: string,
		z_filter: StringFilter,
		f_listener: TxListener,
	): void;
};

/**
 * Opens a new JSON-RPC WebSocket subscribing the the Tendermint Event stream and returns an instance allowing
 * callers to add listeners by filtering for specific events.
 * 
 * To terminate the connecting, callers should close the WebSocket via `.ws.close()`.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const TendermintTxEventFilter = async(
	p_rpc: TrustedContextUrl,
	sx_query=`tm.event='Tx'`
): Promise<TendermintTxEventFilter> => {
	const h_filters: Dict<Readonly<[
		z_filter: StringFilter,
		f_listener: TxListener,
	]>[]> = {};

	// subscribe to Tx events
	const d_ws = await subscribe_tendermint_events(p_rpc, sx_query, (d_event) => {
		// parse event JSON
		const g_result = parse_json_safe<JsonRpcResponse<TendermintEvent<TendermintAbciTxResult>>>(d_event.data)?.result;

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
								f_listener(g_result.data.value, g_result.events);

								// continue with next party
								continue FINDING_PARTIES;
							}
						}
					}
				}
			}
		}
	});

	// properties and methods
	return {
		// the WebSocket
		ws: d_ws,

		// adds event listeners
		when(si_key: string, z_value: StringFilter, f_listener: TxListener): TxUnlistener {
			const a_party = [z_value, f_listener] as const;

			const a_filters = h_filters[si_key] ??= [];

			a_filters.push(a_party);

			return () => remove(a_filters, a_party);
		},
	};
};
