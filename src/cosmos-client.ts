// import type { Promisable } from '@blake.regalia/belt';
// import { __UNDEFINED, is_boolean, is_function, is_number, is_object, is_string, is_undefined, timeout, try_async } from '@blake.regalia/belt';
// import { queryCosmosAuthAccount } from '@solar-republic/cosmos-grpc/cosmos/auth/v1beta1/query';
// import { HttpsUrl, TrustedContextUrl } from '@solar-republic/types';

// export type RetryableRequestWrapper = ((z_req: RequestInfo | URL, z_init: RequestInit, i_attempt: number) => Promise<Response | RetryParams>);

// type RequestDescriptor = TrustedContextUrl
// 	| URL
// 	| ({origin: string} & RequestInit)
// 	;

// type RequestParams = RequestDescriptor
// 	| RetryableRequestWrapper
// 	;

// type RetryParams = Promisable<boolean | number | [
// 	xt_wait: number,
// ]>;

// type RetryHandler = (e_fail: unknown, i_retry: number) => RetryParams;

// export type ExpoentialBackoffParams = [
// 	xt_backoff?: number,
// 	xt_maximum?: number,
// 	n_max_attempts?: number,
// 	x_growth?: number,
// ];

// export const exponential_backoff = ([
// 	xt_backoff=0,
// 	xt_maximum=Infinity,
// 	n_max_attempts=Infinity,
// 	x_growth=2,
// ]: ExpoentialBackoffParams) => (i_attempt: number) => (i_attempt >= n_max_attempts)
// 	? __UNDEFINED
// 	: Math.min(xt_maximum, xt_backoff * (x_growth ** i_attempt));

// export type ResponseChecker = (a_backoff?: ExpoentialBackoffParams) => ((d_res: Response, i_retry: number) => RetryParams);

// export const response_is_429: ResponseChecker = (
// 	a_backoff=[],
// 	f_backoff=exponential_backoff(a_backoff)
// ) => (d_res, i_retry) => 429 === d_res.status
// 	? f_backoff(i_retry)
// 	: false;

// export const response_is_5xx: ResponseChecker = (
// 	a_backoff=[],
// 	f_backoff=exponential_backoff(a_backoff)
// ) => (d_res, i_retry, xc_status=d_res.status) => xc_status >= 500 && xc_status < 600
// 	? f_backoff(i_retry)
// 	: false;

// export const response_is_429_or_5xx: ResponseChecker = (
// 	a_backoff=[],
// 	f_backoff=exponential_backoff(a_backoff)
// ) => (d_res, i_retry, xc_status=d_res.status) => 429 === xc_status || (xc_status >= 500 && xc_status < 600)
// 	? f_backoff(i_retry)
// 	: false;



// export const retry_when_response = (f_test: (d_res: Response, i_retry: number) => RetryParams) => async(z_req, z_init, i_retry) => {
// 	// attempt request
// 	const d_res = await fetch(z_req, z_init);

// 	// check if retry is needed
// 	return await f_test(d_res, i_retry);
// };

// /**
//  * Creates and returns a function that implements `fetch` but with the ability to automatically retry
//  * on certain exceptions or responses, with optional exponential backoff.
//  * @param z_desc - the request descriptor, see {@link RequestDescriptor}
//  * @param f_retry - an optional retry handler to be used when fetch function throws, see {@link RetryHandler}
//  * @returns a function idential to `fetch`
//  */
// export const retryable_fetcher = (
// 	z_desc?: RetryableRequestWrapper | undefined,
// 	f_retry?: RetryHandler
// ): (typeof fetch) => async(z_req, z_init) => {
// 	// attempt counter
// 	let c_attempts = 0;

// 	// retry loop
// 	for(;;) {
// 		// attempt the request
// 		const [z_res, e_fail] = await try_async(() => (z_desc ?? fetch)(z_req, z_init, c_attempts));

// 		// determine if retry is needed
// 		const z_retry = e_fail
// 			// request failed, ask for retry
// 			? await f_retry?.(e_fail, c_attempts++) || 0
// 			// user returned retry params
// 			: !(z_res instanceof Response)
// 				// retry with returned params
// 				? z_res
// 				// do not retry
// 				: __UNDEFINED;

// 		// retry wanted
// 		if(!is_undefined(z_retry)) {
// 			// wait for given time
// 			await timeout(is_number(z_retry)? z_retry: 0);

// 			// retry
// 			continue;
// 		}

// 		// throw error
// 		if(e_fail) throw e_fail;

// 		// done
// 		return z_res as Response;
// 	}
// };



// /**
//  * Convenience method for creating a basic fetcher that retries on 429 and 5xx with exponential backoff.
//  * If exponential backoff params are omitted, fetcher defaults to waiting up to 30 seconds maximum between
//  * retries, with a backoff param of 200ms, allowing up to 10 attempts in total.
//  * @param a_backoff 
//  * @returns 
//  */
// export const basic_retryable_fetcher = (a_backoff: ExpoentialBackoffParams=[200, 30e3, 10]) => retryable_fetcher(retry_when_response(response_is_429_or_5xx(a_backoff)));


// export const cosmos_client = (z_desc: RequestDescriptor, f_fetcher: typeof fetch=basic_retryable_fetcher()) => {
// 	// prep request init object
// 	let g_init: RequestInit | undefined;

// 	// deduce origin
// 	let p_origin = is_string(z_desc)
// 		? z_desc.replace(/\/+$/, '')
// 		: z_desc instanceof URL
// 			? z_desc.origin+z_desc.pathname
// 			: (g_init=z_desc, z_desc.origin);

// 	// return client struct
// 	return {
// 		lcd: (s_append: string, g_ammend?: RequestInit) => f_fetcher(p_origin+s_append, {...g_init, ...g_ammend}),
// 	};
// };

// const y_client = cosmos_client('http://10.0.0.23:26657');

// queryCosmosAuthAccount(y_client);
