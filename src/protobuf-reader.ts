
export type Field = number | DecodedProtobuf;

export type DecodedProtobuf = Uint8Array | Field[][];

export const decode_protobuf = (atu8_data: Uint8Array): DecodedProtobuf => {
	let varint = () => {
		let xn_out = 0;
		let xi_shift = -7;

		for(;;) {
			// read the byte
			let xb_read = atu8_data[ib_read++];

			// OR into place
			xn_out |= (xb_read & 0x7f) << (xi_shift += 7);

			// terminal byte
			if(!(xb_read & 0x80)) return xn_out;
		}
	};

	let ib_read = 0;

	let i_field = 0;
	let a_out = [];

	for(; ib_read<atu8_data.length;) {
		let xn_field_and_type = varint();
		let xn_field = (xn_field_and_type >> 3) - 1;
		let xn_type = xn_field_and_type & 0x07;

		// not the expected field index or expected type
		if(xn_field < i_field || xn_field > i_field + 1 || xn_type > 2) {
			return atu8_data;
		}

		// length-delimited
		// @ts-expect-error no-args
		(a_out[i_field = xn_field] || (a_out[i_field] = [])).push([
			// varint
			varint,

			// i64
			_ => 'i64',

			// len (string, bytes, embedded, etc.)
			// eslint-disable-next-line @typescript-eslint/no-loop-func
			(_) => {
				let nb_read = varint();
				let ib_start = ib_read;
				ib_read += nb_read;
				return decode_protobuf(atu8_data.subarray(ib_start, ib_read));
			},
		][xn_type]());
	}

	return a_out;
};
