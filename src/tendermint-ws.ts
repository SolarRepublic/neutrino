/* eslint-disable prefer-const */
import type {NaiveJsonString, Promisable} from '@blake.regalia/belt';
import type {TrustedContextUrl} from '@solar-republic/types';

import {assign, is_function} from '@blake.regalia/belt';

import {subscribe_tendermint_events} from './app-layer';

export type TendermintWs = {
	/**
	 * Returns the current {@link WebSocket}.
	 */
	ws(): WebSocket;
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export const TendermintWs = async(
	p_rpc: TrustedContextUrl,
	sx_query: string,
	fk_message: (d_event: MessageEvent<NaiveJsonString>) => any,
	fk_restart?: (d_event: CloseEvent) => Promisable<boolean | 1 | ((d_ws: WebSocket) => Promisable<void>)>
): Promise<TendermintWs> => {
	let d_ws!: WebSocket;

	let f_reconnect = async() => assign(d_ws=await subscribe_tendermint_events(p_rpc, sx_query, fk_message), {
		// close event
		async onclose(d_event) {
			// notify caller
			const z_restart = await fk_restart?.(d_event);

			// truthy value means user wants to restart WebSocket
			if(z_restart) {
				// start reconnecting
				await f_reconnect();

				// user wants to receive new WebSocket once its open
				if(is_function(z_restart)) void z_restart(d_ws);
			}
		},
	} satisfies Partial<WebSocket>);

	// initiate first connection
	await f_reconnect();

	// return struct that allows caller to retrieve current WebSocket
	return {
		ws: () => d_ws,
	};
};
