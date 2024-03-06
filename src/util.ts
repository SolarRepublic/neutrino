/* eslint-disable prefer-const */

import {bytes} from '@blake.regalia/belt';

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
