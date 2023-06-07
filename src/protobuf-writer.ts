import type {L} from 'ts-toolbelt';

import type {SlimCoin} from './types';

import {buffer, text_to_buffer} from '@blake.regalia/belt';

type NodeValue = number | bigint | number[] | Uint8Array;

type Encoder<
	w_node extends NodeValue=NodeValue,
> = (atu8_out: Uint8Array, ib_write: number, w_value: w_node) => any;

type BufNode = [
	write: Encoder<any>,
	value: NodeValue,
	length: number,
	next?: BufNode | null,
];

type Nester = (k_writer: ProtoWriter, ...a_args: any[]) => ProtoWriter;


export interface ProtoWriter {
	v(xn_value: number): this;
	g(xg_value: bigint): this;
	b(atu8_bytes: Uint8Array | number[]): this;
	s(s_data: string): this;
	n<f_nester extends Nester>(f_call: f_nester, ...a_args: L.Tail<Parameters<f_nester>>): ProtoWriter;
	o(): Uint8Array;
}

const encode_varint32: Encoder<number> = (atu8_out, ib_write, n_value) => {
	while(n_value > 127) {
		atu8_out[ib_write++] = (n_value & 0x7f) | 0x80;
		n_value >>>= 7;
	}

	atu8_out[ib_write] = n_value;
};

const encode_biguint: Encoder<bigint> = (atu8_out, ib_write, xg_value) => {
	while(xg_value > 127n) {
		atu8_out[ib_write++] = Number(xg_value & 0x7fn) | 0x80;
		xg_value >>= 7n;
	}

	atu8_out[ib_write] = Number(xg_value);
};

const encode_bytes: Encoder<Uint8Array> = (atu8_out, ib_write, atu8_data) => atu8_out.set(atu8_data, ib_write);

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Protobuf = (): ProtoWriter => {
	// @ts-expect-error low-opt
	// eslint-disable-next-line prefer-const
	let a_head: BufNode = [];
	// eslint-disable-next-line prefer-const
	let a_tail: BufNode = a_head;

	// eslint-disable-next-line @typescript-eslint/naming-convention
	const push = (a_node: BufNode) => {
		// add to cumulative length
		cb_buffer += a_node[2];

		// set pointer to next node in linked list
		a_tail[3] = a_node;

		// advance floating tail
		a_tail = a_node;

		// for chaining
		return g_self;
	};

	let cb_buffer = 0;

	const g_self: ProtoWriter = {
		v: xn_value => push([
			encode_varint32,
			xn_value,
			xn_value < 0x80? 1
				: xn_value < 0x4000? 2
					: xn_value < 0x200000? 3
						: xn_value < 0x10000000? 4
							: 5,
		]),

		g: (xg_value) => {
			// count how many bytes are needed to store this biguint
			let nb_biguint = 1;
			let xg_copy = xg_value;
			while(xg_copy > 127n) {
				nb_biguint++;
				xg_copy >>= 7n;
			}

			return push([
				encode_biguint,
				xg_value,
				nb_biguint,
			]);
		},

		b: (atu8_bytes) => {
			const nb_bytes = atu8_bytes.length;

			g_self.v(nb_bytes);

			return push([
				encode_bytes,
				atu8_bytes,
				nb_bytes,
			]);
		},

		s: s_data => g_self.b(s_data? text_to_buffer(s_data): [0]),

		// eslint-disable-next-line @typescript-eslint/naming-convention
		n: (f_call, ...a_args) => g_self.b(f_call(Protobuf(), ...a_args).o()),

		o(): Uint8Array {
			// eslint-disable-next-line prefer-const
			let atu8_out = buffer(cb_buffer);

			// write offset
			let ib_write = 0;

			// node pointer
			let a_node = a_head[3];

			// iterate thru linked list
			while(a_node) {
				const [f_encode, w_value, nb_length, a_next] = a_node;

				// commit node to output
				f_encode(atu8_out, ib_write, w_value);

				// advance write head by internal length
				ib_write += nb_length;

				// traverse linked list
				a_node = a_next;
			}

			return atu8_out;
		},
	};

	return g_self;
};

export const any = (si_type: string, atu8_value: Uint8Array): Uint8Array => Protobuf()
	.v(10).s(si_type)
	.v(18).b(atu8_value)
	.o();

export const coin = (a_coin: SlimCoin): Uint8Array => Protobuf()
	.v(10).s(a_coin[1])
	.v(18).s(a_coin[0])
	.o();

export const timestamp = (xt_timestamp: number) => Protobuf()
	.v(8).v(xt_timestamp)
	.o();
