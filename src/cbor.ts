/* eslint-disable prefer-const */
import type {Arrayable} from '@blake.regalia/belt';

import {buffer_to_text, dataview} from '@blake.regalia/belt';

export type CborPrimitive = boolean | number | bigint | string | Uint8Array;
export type CborValue = Arrayable<CborPrimitive> | Map<CborValue, CborValue>;

export const cborDecode = (atu8_data: Uint8Array, ib_read=0): [
	w_item: CborValue,
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

	/* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/no-unused-vars */
	let a_parsers = [
		// uint
		(_?: any) => xn_value,

		// negative int
		(_?: any) => -xn_value - 1,

		// byte string
		(_?: any) => atu8_data.subarray(ib_read, ib_read+=xn_value),

		// text string
		(_?: any) => buffer_to_text(a_parsers[2]()),

		// array
		(a_items: any[]=[]) => {
			for(let i_item=0; i_item<xn_value; i_item++) {
				[a_items[i_item], ib_read] = cborDecode(atu8_data, ib_read);
			}

			return a_items;
		},

		// map
		(hm_out=new Map()) => {
			for(let i_item=0, z_key, z_value; i_item<xn_value; i_item++) {
				[z_key, ib_read] = cborDecode(atu8_data, ib_read);
				[z_value, ib_read] = cborDecode(atu8_data, ib_read);

				// save entry to map
				hm_out.set(z_key, z_value);
			}

			return hm_out;
		},
	] as const;
	/* eslint-enable */

	return [
		a_parsers[xc_major](),
		ib_read,
	];
};
