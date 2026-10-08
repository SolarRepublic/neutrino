import type {CborValue} from '@blake.regalia/belt';
import type {Snip52Schema} from '@solar-republic/contractor';

import {__UNDEFINED, bytes_to_biguint_be} from '@blake.regalia/belt';
import {bech32_encode} from '@solar-republic/crypto';

// Bound work independently of input length: zero-width structs/arrays can otherwise
// allocate arbitrarily large trees without consuming any payload bytes.
export const NB_SNIP52_MAX_PAYLOAD = 1024 * 1024;
const N_MAX_VALUES = 16384;
const N_MAX_DEPTH = 32;

export const decode_snip52_data = (
	atu8_data: Uint8Array,
	g_schema: Snip52Schema.DataDescriptor
): [Snip52Schema.AnyValueSequenced, number] => {
	if(atu8_data.length > NB_SNIP52_MAX_PAYLOAD) throw Error('SNIP-52 payload exceeds limit');
	let ib_read = 0;
	let c_values = 0;
	const f_read = (nb: number) => {
		if(!Number.isSafeInteger(nb) || nb < 0 || nb > atu8_data.length - ib_read) throw Error('Truncated SNIP-52 data');
		const atu8_value = atu8_data.subarray(ib_read, ib_read + nb);
		ib_read += nb;
		return atu8_value;
	};

	const f_decode = (g_descriptor: Snip52Schema.DataDescriptor, n_depth: number): unknown => {
		if(n_depth > N_MAX_DEPTH || ++c_values > N_MAX_VALUES) throw Error('SNIP-52 schema exceeds limit');
		const m_type = /^(uint|bytes|address|struct)(\d*)(?:\[(\d+)\])?(?:\[(\d+)\])?$/.exec(g_descriptor?.type);
		if(!m_type) throw Error('Invalid SNIP-52 datatype');
		const [, s_type, s_size, s_dim1, s_dim2] = m_type;
		const nb_size = Number(s_size);
		if('uint' === s_type && (!s_size || nb_size < 8 || nb_size > 256 || nb_size % 8)) throw Error('Invalid SNIP-52 uint width');
		if('bytes' === s_type && (!s_size || !Number.isSafeInteger(nb_size))) throw Error('Invalid SNIP-52 bytes width');
		if(('address' === s_type || 'struct' === s_type) && s_size) throw Error('Invalid SNIP-52 datatype width');
		const a_members = (g_descriptor as {members?:Snip52Schema.DataDescriptor[]}).members;
		if('struct' === s_type && (!Array.isArray(a_members) || a_members.length > N_MAX_VALUES)) throw Error('Invalid SNIP-52 struct');
		const f_scalar = (): unknown => {
			if(++c_values > N_MAX_VALUES) throw Error('SNIP-52 schema exceeds limit');
			switch(s_type) {
				case 'uint': return bytes_to_biguint_be(f_read(nb_size / 8));
				case 'bytes': return f_read(nb_size);
				case 'address': return bech32_encode('secret', f_read(20));
				default: return a_members!.map(g_member => f_decode(g_member, n_depth + 1));
			}
		};

		const f_array = (s_dimension: string, f_value: () => unknown) => {
			const n_size = Number(s_dimension);
			if(!Number.isSafeInteger(n_size) || n_size < 1 || n_size > N_MAX_VALUES - c_values) throw Error('SNIP-52 array exceeds limit');
			return Array.from({length:n_size}, () => { c_values++; return f_value(); });
		};

		const f_inner = () => s_dim1 === __UNDEFINED? f_scalar(): f_array(s_dim1, f_scalar);
		return s_dim2 === __UNDEFINED? f_inner(): f_array(s_dim2, f_inner);
	};

	return [f_decode(g_schema, 0) as Snip52Schema.AnyValueSequenced, ib_read];
};

export const snip52_bloom_params = (n_m: number, n_k: number, s_hash: string): [number, bigint] => {
	const n_width = 'sha256' === s_hash? 256: 'sha512' === s_hash? 512: 0;
	const n_bits = Math.log2(n_m);
	// The spec extracts log2(m)-bit indices, so m must be a power of two.
	if(!n_width || !Number.isSafeInteger(n_m) || n_m < 8 || n_m > NB_SNIP52_MAX_PAYLOAD * 8
		|| !Number.isInteger(n_bits) || !Number.isSafeInteger(n_k) || n_k < 1 || n_k * n_bits > n_width) {
		throw Error('Invalid SNIP-52 bloom parameters');
	}

	return [n_width, BigInt(n_bits)];
};

/** Decode definite-length CBOR with allocation/depth bounds; trailing padding is allowed by SNIP-52. */
export const decode_snip52_cbor = (atu8_data: Uint8Array): CborValue => {
	if(atu8_data.length > NB_SNIP52_MAX_PAYLOAD) throw Error('SNIP-52 payload exceeds limit');
	const dv_data = new DataView(atu8_data.buffer, atu8_data.byteOffset, atu8_data.byteLength);
	let ib_read = 0;
	let c_items = 0;
	const f_take = (nb: number) => {
		if(!Number.isSafeInteger(nb) || nb < 0 || nb > atu8_data.length - ib_read) throw Error('Truncated SNIP-52 CBOR');
		const ib_start = ib_read;
		ib_read += nb;
		return ib_start;
	};

	const f_decode = (n_depth: number): unknown => {
		if(n_depth > N_MAX_DEPTH || ++c_items > N_MAX_VALUES) throw Error('SNIP-52 CBOR exceeds limit');
		const xb_initial = dv_data.getUint8(f_take(1));
		const n_major = xb_initial >> 5;
		const n_info = xb_initial & 31;
		if(7 === n_major) {
			if(n_info >= 20 && n_info <= 23) return [false, true, null, __UNDEFINED][n_info - 20];
			if(26 === n_info) return dv_data.getFloat32(f_take(4));
			if(27 === n_info) return dv_data.getFloat64(f_take(8));
			if(25 === n_info) {
				const n_bits = dv_data.getUint16(f_take(2));
				const n_exp = (n_bits >> 10) & 31;
				const n_fraction = n_bits & 1023;
				return (n_bits & 32768? -1: 1) * (31 === n_exp? n_fraction? NaN: Infinity: n_exp? (1 + (n_fraction / 1024)) * (2 ** (n_exp - 15)): n_fraction * (2 ** -24));
			}

			throw Error('Unsupported SNIP-52 CBOR simple value');
		}

		let xg_value: bigint;
		if(n_info < 24) xg_value = BigInt(n_info);
		else if(24 === n_info) xg_value = BigInt(dv_data.getUint8(f_take(1)));
		else if(25 === n_info) xg_value = BigInt(dv_data.getUint16(f_take(2)));
		else if(26 === n_info) xg_value = BigInt(dv_data.getUint32(f_take(4)));
		else if(27 === n_info) xg_value = dv_data.getBigUint64(f_take(8));
		else throw Error('Indefinite-length SNIP-52 CBOR is unsupported');
		if(n_major < 2) {
			const xg_int = n_major? -1n - xg_value: xg_value;
			return xg_int >= BigInt(Number.MIN_SAFE_INTEGER) && xg_int <= BigInt(Number.MAX_SAFE_INTEGER)? Number(xg_int): xg_int;
		}

		if(6 === n_major) {
			if(xg_value > 3n) throw Error('Unsupported SNIP-52 CBOR tag');
			const w_value = f_decode(n_depth + 1);
			if(xg_value < 2n) {
				if(0n === xg_value? typeof w_value !== 'string': typeof w_value !== 'number' && typeof w_value !== 'bigint') throw Error('Invalid SNIP-52 CBOR date tag');
				return w_value;
			}

			if(!(w_value instanceof Uint8Array)) throw Error('Invalid SNIP-52 CBOR bignum');
			const xg_integer = bytes_to_biguint_be(w_value);
			return 2n === xg_value? xg_integer: -1n - xg_integer;
		}

		const n_length = Number(xg_value);
		if(2 === n_major || 3 === n_major) {
			const ib_start = f_take(n_length);
			const atu8_value = atu8_data.subarray(ib_start, ib_read);
			return 2 === n_major? atu8_value: new TextDecoder('utf-8', {fatal:true}).decode(atu8_value);
		}

		if(n_length > N_MAX_VALUES - c_items) throw Error('SNIP-52 CBOR collection exceeds limit');
		if(4 === n_major) return Array.from({length:n_length}, () => f_decode(n_depth + 1));
		const hm_values = new Map();
		for(let i_item=0; i_item<n_length; i_item++) hm_values.set(f_decode(n_depth + 1), f_decode(n_depth + 1));
		return hm_values;
	};

	return f_decode(0) as CborValue;
};
