/* eslint-disable prefer-const */
import type {JsonRpcResponse} from './types';
import type {NaiveJsonString, Promisable} from '@blake.regalia/belt';
import type {TrustedContextUrl} from '@solar-republic/types';

import {assign, is_error, is_function, parse_json_safe, stringify_json, try_async} from '@blake.regalia/belt';

import {GC_NEUTRINO} from './config';


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
	xt_timeout=GC_NEUTRINO.WS_TIMEOUT
): Promise<WebSocket> => new Promise((fk_resolve, fe_reject) => {
	// if WebSocket doens't open within allotted timeframe, probe and die
	let i_open = setTimeout(async() => {
		// // send probe request with automatic timeout
		// const d_res = await fetch(p_rpc.replace(/^ws/, 'http')+'/websocket', {
		// 	headers: {
		// 		'Connection': 'Upgrade',
		// 		'Upgrade': 'websocket',
		// 		'Sec-WebSocket-Version': '13',
		// 		'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',  // for some reason, implementations only support using the sample key from the spec 🤯
		// 	},
		// 	signal: AbortSignal.timeout(xt_timeout),
		// });

		// // did not get expected HTTP response status code, or unknown reason for timeout
		// fe_reject(Error(101 === d_res.status
		// 	? `Bad response status ${d_res.status} while probing WebSocket endpoint ${p_rpc}: ${(await d_res.text()).trim()}\nheaders: ${JSON.stringify(d_res.headers, null, '  ')}`
		// 	: `Timed out while waiting for otherwise healthy WebSocket to open at ${p_rpc}`));

		// send probe request with automatic timeout
		const [d_res, e_fetch] = await try_async(() => fetch(p_rpc.replace(/^ws/, 'http')+'/status', {
			signal: AbortSignal.timeout(xt_timeout),
		}));

		// fetch error
		if(is_error(e_fetch)) {
			// abort/timeout
			if(['AbortError', 'TimeoutError'].includes(e_fetch.name)) {
				fe_reject(Error(`Timed out while attempting to reach ${p_rpc}`));
			}
			else {
				fe_reject(e_fetch);
			}
		}
		// request returned
		else if(d_res) {
			// did not get expected HTTP response status code, or unknown reason for timeout
			fe_reject(Error((d_res.ok
				? `Unable to diagnose misbehaving WebSocket endpoint at ${p_rpc} in current environment`
				: `Bad response status ${d_res.status} while probing WebSocket endpoint ${p_rpc}: ${(await d_res.text()).trim()}`
			)+`\nheaders: ${JSON.stringify(d_res.headers, null, '  ')}`));
		}
	}, xt_timeout);

	// create WebSocket
	return assign(
		// normalize protocol from http(s) => ws and append /websocket to path
		new dc_ws(p_rpc.replace(/^http/, 'ws')+'/websocket'), {
			// first message should be subscription confirmation
			onmessage(g_msg) {
				// parse message
				const g_data = parse_json_safe<JsonRpcResponse<Record<string, never>>>(g_msg.data as NaiveJsonString);

				// expect confirmation
				if('0' !== g_data?.id || '{}' !== stringify_json(g_data?.result)) {
					// reject
					fe_reject(g_data);  // eslint-disable-line @typescript-eslint/prefer-promise-reject-errors

					// close socket
					this.close(); return;
				}

				// each subsequent message
				this.onmessage = fk_message;

				// resolve now that subscription has been confirmed
				fk_resolve(this);
			},

			// open event
			onopen() {
				// cancel open timeout
				clearTimeout(i_open);

				// subscribe to event
				this.send(stringify_json({
					id: '0',
					method: 'subscribe',
					params: {
						query: sx_query,
					},
				}));
			},

			// error event
			onerror(d_event: ErrorEvent) {
				fe_reject(Error(d_event.message));
			},
		} as Pick<WebSocket, 'onmessage' | 'onopen'>);
});


// eslint-disable-next-line @typescript-eslint/naming-convention
export const TendermintWs = async(
	p_rpc: TrustedContextUrl,
	sx_query: string,
	fk_message: (d_event: MessageEvent<NaiveJsonString>) => any,
	z_restart?: TendermintWsRestartParam,
	dc_ws?: typeof WebSocket
): Promise<TendermintWs> => {
	let d_ws!: WebSocket;

	// cache whether the restart arg is a function
	let b_restart_fn = is_function(z_restart);

	// connector
	let f_reconnect = async() => assign(d_ws=await subscribe_tendermint_events(p_rpc, sx_query, fk_message, dc_ws), {
		// close event
		async onclose(d_event) {
			// notify caller
			const z_restart_ans = b_restart_fn? await (z_restart as Exclude<TendermintWsRestartParam, boolean | number>)(d_event): z_restart;

			// truthy value means user wants to restart WebSocket
			if(z_restart_ans) {
				// start reconnecting
				await f_reconnect();

				// user wants to receive new WebSocket once its open
				if(is_function(z_restart_ans)) void (z_restart_ans as (d_ws: WebSocket) => Promisable<void>)(d_ws);
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
