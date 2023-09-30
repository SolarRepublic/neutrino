/* eslint-disable prefer-const, no-sequences, @typescript-eslint/naming-convention */
import type {CborValue} from '@solar-republic/contractor';

import {buffer_to_text, dataview} from '@blake.regalia/belt';

import {buffer_to_bigint_be} from './util';

export const cborDecode = <
	w_expected extends CborValue,
>(atu8_data: Uint8Array, ib_read=0): [
	w_item: w_expected,
	ib_read: number,
] => {
	let xb_initial = atu8_data[ib_read++];
	let xc_additioanl = xb_initial & 0x1f;
	let xc_major = xb_initial >> 5;

	// only used in next if block, but placed in outer scope join declaration sequence
	let nb_ahead = 1 << (xc_additioanl - 24);
	let dv_data = dataview(atu8_data.buffer);

	// default to low uint value
	let xn_value = xc_additioanl;
	if(xc_additioanl > 23) {
		// read network-order bytes
		xn_value = dv_data['getUint'+(8*nb_ahead) as 'getUint32'](ib_read);
		ib_read += nb_ahead;
	}

	/* eslint-disable @typescript-eslint/no-unused-vars */
	let f_bytes = (_?: any) => atu8_data.subarray(ib_read, ib_read+=xn_value);

	let a_parsers = [
		// uint
		(_?: any) => xn_value,

		// negative int
		(_?: any) => -xn_value - 1,

		// byte string
		f_bytes,

		// text string
		(_?: any) => buffer_to_text(a_parsers[2]()),

		// array
		(a_items: CborValue[]=[]) => {
			for(let i_item=0; i_item<xn_value; i_item++) {
				[a_items[i_item], ib_read] = cborDecode(atu8_data, ib_read);
			}

			return a_items;
		},

		// map
		(hm_out=new Map<CborValue, CborValue>()) => {
			for(let i_item=0, z_key, z_value; i_item<xn_value; i_item++) {
				[z_key, ib_read] = cborDecode(atu8_data, ib_read);
				[z_value, ib_read] = cborDecode(atu8_data, ib_read);

				// save entry to map
				hm_out.set(z_key, z_value);
			}

			return hm_out;
		},

		// tagged item
		(__?: any) => [
			// date/time string
			(_?: any) => buffer_to_text(f_bytes()),

			// epoch-based date/time as number of seconds (integer or float)
			(xn_timestamp=0) => ([xn_timestamp, ib_read] = cborDecode<number>(atu8_data, ib_read), xn_timestamp),

			// unsigned bigint
			(_?: any) => buffer_to_bigint_be(f_bytes()),

			// negative bigint
			(_?: any) => -buffer_to_bigint_be(f_bytes()) - 1n,
		][xc_additioanl](),
	] as const;
	/* eslint-enable */

	return [
		a_parsers[xc_major]() as w_expected,
		ib_read,
	];
};
