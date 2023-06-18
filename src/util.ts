/* eslint-disable prefer-const */
import type {JsonString, JsonValue} from '@blake.regalia/belt';

import {buffer, oda} from '@blake.regalia/belt';

import {XG_8} from './constants';

/**
 * Attempts to parse the given JSON string, returning `undefined` on parse error instead of throwing
 * @param sx_json 
 * @returns 
 */
export const safe_json = <
	w_out extends JsonValue=JsonValue,
>(sx_json: string): w_out | undefined => {
	try {
		return JSON.parse(sx_json) as w_out;
	}
	catch(e_parse) {}
};

// eslint-disable-next-line @typescript-eslint/naming-convention,@typescript-eslint/no-unused-vars
export const random_32 = (_?: never): Uint8Array => crypto.getRandomValues(buffer(32));

export const die = (s_msg: string, w_data?: unknown): never => {
	throw oda(Error(s_msg), {data:w_data});
};


export const buffer_to_bigint_be = (atu8_bytes: Uint8Array): bigint => atu8_bytes.reduce((xg_out, xb_value) => (xg_out << XG_8) | BigInt(xb_value), 0n);

export const bigint_to_buffer_be = (xg_value: bigint, nb_size=32): Uint8Array => {
	let atu8_out = buffer(nb_size);

	let ib_write = nb_size;

	while(xg_value > 0n) {
		atu8_out[--ib_write] = Number(xg_value & 0xffn);
		xg_value >>= XG_8;
	}

	return atu8_out;
};
