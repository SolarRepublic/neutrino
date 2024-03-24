/* eslint-disable prefer-const */

import type {TendermintAbciEvent, TendermintAbciTxResult} from '@solar-republic/cosmos-grpc/tendermint/abci/types';

import {bytes, collapse, fold, type Dict, base64_to_text, each} from '@blake.regalia/belt';

export type StringFilter = string | string[] | Iterable<string> | RegExp | null | ((s_test: string) => boolean);

// eslint-disable-next-line @typescript-eslint/naming-convention,@typescript-eslint/no-unused-vars
export const random_32 = (_?: never): Uint8Array => crypto.getRandomValues(bytes(32));

/**
 * Tests the given string value against a filter that may be one of the following:
 *  - `string` - exact comparison
 *  - `Iterable<string>` - includes one of the items in the iteratable (e.g., Array, Set, etc.)
 *  - `RegExp` - matches the regular expression
 *  - `Function` - calls the given function with the string value as the sole argument and evaluates return value for falsy-ness
 *  - `null` - always passes
 *  - other - dangerous, do not use. casts the item to a string and then compares
 * @param s_value 
 * @param z_filter 
 * @returns 
 */
export const string_matches_filter = (
	s_value: string,
	z_filter: StringFilter
): boolean => null === z_filter || ('string' === typeof z_filter
	? s_value === z_filter
	: z_filter instanceof RegExp
		? z_filter.test(s_value)
		: 'function' === typeof z_filter
			? !!z_filter(s_value)
			: z_filter?.[Symbol.iterator]
				? (Array.isArray(z_filter)? z_filter: [...z_filter]).includes(s_value)
				// eslint-disable-next-line @typescript-eslint/no-base-to-string
				: s_value === z_filter+'');


/**
 * Converts a list of ABCI events to a dict of string values
 * @param a_events - the list of events
 * @param h_events - optional dict to merge into
 * @returns the dict
 */
export const index_abci_events = (
	a_events: TendermintAbciEvent[],
	h_events: Dict<string[]>={}
): Dict<string[]> => (
	// coalesce indexed events
	each(a_events, ({type:s_type, attributes:a_attrs}) => {
		// each attribute
		each(a_attrs!, (g_attr) => {
			// add to indexed list
			(h_events[s_type+'.'+base64_to_text(g_attr.key!)] ||= []).push(base64_to_text(g_attr.value!));
		});
	// eslint-disable-next-line no-sequences
	}),
	h_events
);
