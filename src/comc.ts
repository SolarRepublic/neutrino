// import type {Dict, JsonValue} from '@blake.regalia/belt';

// import {uuid_v4} from '@blake.regalia/belt';

// type ComcRequest = [
// 	si_call: string,
// 	p_sender: `file:///${string}`,
// 	si_type: string,
// 	g_value: JsonValue,
// ];

// type ComcResult = [
// 	w_data: JsonValue,
// 	a_transfers: Transferable[],
// ];

// type ComcResponse = [
// 	si_call: string,
// 	xc_type: 0 | 1,
// 	a_result: ComcResult,
// ];


// export type ComcClient = <w_result extends JsonValue>(si_type: string, w_value: JsonValue) => Promise<w_result>;

// export const comcClient = (d_window: Window, p_target: '*' | `http${'' | 's'}://${string}`): ComcClient => {
// 	const h_calls: Dict<{
// 		[si_key in 0 | 1]: (w_result: ComcResult) => any;
// 	}> = {};

// 	addEventListener('message', ({data:a_response}: {data: ComcResponse}) => {
// 		// destructure response
// 		const [si_call, xc_type, w_result] = a_response;

// 		// response to known call
// 		h_calls[si_call]?.[xc_type]?.(w_result);
// 	});

// 	// return instante
// 	return (si_type: string, w_value: JsonValue, a_transfers?: Transferable[]) => new Promise((fk_resolve, fe_reject) => {
// 		const si_call = uuid_v4();

// 		h_calls[si_call] = [
// 			fk_resolve,
// 			fe_reject,
// 		];

// 		d_window.postMessage([
// 			si_call,
// 			location.href,
// 			si_type,
// 			w_value,
// 		] as ComcRequest, p_target, a_transfers);
// 	});
// };

// export type ComcRouter = Dict<(w_value: JsonValue) => Promise<ComcResult>>;

// export const comcHost = (h_router: ComcRouter) => {
// 	addEventListener('message', async(d_msg: MessageEvent<ComcRequest>) => {
// 		// untrusted event or not from top
// 		if(!d_msg.isTrusted || d_msg.source !== window.top) return;

// 		// destructure data
// 		const [
// 			si_call,
// 			p_sender,
// 			si_type,
// 			w_value,
// 		] = d_msg.data;

// 		// invalid types
// 		if(![si_call, p_sender, si_type].every(z => z && 'string' === typeof z)) {
// 			console.warn('Message must have non-empty strings for `cid`, `url`, and `type` properties');
// 			return;
// 		}

// 		// must be file:// URL
// 		if(!p_sender.startsWith('file://')) {
// 			console.warn(`Only file: protocols are allowed as sender`);
// 			return;
// 		}

// 		// parse sender
// 		try {
// 			new URL(p_sender);
// 		}
// 		catch(e_parse) {
// 			console.warn(`Failed to parse sender url`);
// 			return;
// 		}

// 		// unroute-able
// 		const f_handler = h_router[si_type];
// 		if('function' !== typeof f_handler) return;

// 		// prep responder
// 		const f_respond = (xc_type: 0 | 1, [w_result, a_transfers]: [w_result?: any, a_transfers?: Transferable[]]) => d_msg.source!.postMessage([
// 			si_call,
// 			xc_type,
// 			w_result || null,
// 		], {
// 			targetOrigin: '*',
// 			transfer: a_transfers || [],
// 		});

// 		// handle
// 		try {
// 			f_respond(0, await f_handler(w_value));
// 		}
// 		catch(e_handle) {
// 			f_respond(1, [(e_handle as Error)?.message || e_handle]);
// 		}
// 	});
// };
