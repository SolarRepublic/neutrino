import {buffer} from '@blake.regalia/belt';

const float = (nl_size=16) => new Float64Array(nl_size);

const ATU8_BASE = buffer(32);

const ATF64_121665 = float();

ATU8_BASE[0] = 9;

ATF64_121665.set([0xdb41, 1]);

const car25519 = (atf64_out: Float64Array) => {
	let i_f: number;
	let x_v: number;
	let xn_c = 1;

	for(i_f=0; i_f<16; i_f++) {
		x_v = atf64_out[i_f] + xn_c + 65535;
		xn_c = Math.floor(x_v / 65536);
		atf64_out[i_f] = x_v - (xn_c * 65536);
	}

	atf64_out[0] += xn_c - 1 + (37 * (xn_c - 1));
};

const sel25519 = (atf64_p: Float64Array, atf64_q: Float64Array, xn_b: number) => {
	let i_f: number;
	let xn_t: number;
	let xn_c = ~(xn_b - 1);

	for(i_f=0; i_f<16; i_f++) {
		xn_t = xn_c & (atf64_p[i_f] ^ atf64_q[i_f]);
		atf64_p[i_f] ^= xn_t;
		atf64_q[i_f] ^= xn_t;
	}
};


const add = (atf64_out: Float64Array, atf64_a: Float64Array, atf64_b: Float64Array) => {
	for(let i_f=0; i_f<16; i_f++) {
		atf64_out[i_f] = atf64_a[i_f] + atf64_b[i_f];
	}
};


const sub = (atf64_out: Float64Array, atf64_a: Float64Array, atf64_b: Float64Array) => {
	for(let i_f=0; i_f<16; i_f++) {
		atf64_out[i_f] = atf64_a[i_f] - atf64_b[i_f];
	}
};

const add_sub = (atf64_out: Float64Array, atf64_a: Float64Array, atf64_b: Float64Array) => (
	add(atf64_out, atf64_a, atf64_b),
	sub(atf64_a, atf64_a, atf64_b)
);

const mul = (atf64_out: Float64Array, atf64_a: Float64Array, atf64_b: Float64Array) => {
	let i_f: number;
	let i_ff: number;
	let atf64_t = float(31);

	for(i_f=0; i_f<16; i_f++) {
		for(i_ff=0; i_ff<16; i_ff++) {
			atf64_t[i_f+i_ff] += atf64_a[i_f] * atf64_b[i_ff];
		}
	}

	for(i_f=0; i_f<15; i_f++) {
		atf64_t[i_f] += 38 * atf64_t[i_f+16];
	}

	atf64_out.set(atf64_t.subarray(0, 16));

	car25519(atf64_out);
	car25519(atf64_out);
};

const square = (atu8_out: Float64Array, atu8_a: Float64Array) => mul(atu8_out, atu8_a, atu8_a);

export const crypto_scalarmult = (atu8_n: Uint8Array, atu8_p: Uint8Array): Uint8Array => {
	let atu8_q = buffer(32);
	let atu8_z = atu8_n.map(x => x);
	let atf64_x = float(80);
	let xn_r: number;
	let i_f: number;
	let i_ff: number;
	let atf64_a = float();
	let atf64_b = float();
	let atf64_c = float();
	let atf64_d = float();
	let atf64_e = float();
	let atf64_f = float();

	atu8_z[31] = (atu8_n[31] & 127) | 64;
	atu8_z[0] &= 248;


	// unpack
	for(i_f=0; i_f<16; i_f++) {
		atf64_x[i_f] = atu8_p[2*i_f] + (atu8_p[(2*i_f) + 1] << 8);
	}

	atf64_x[15] &= 0x7fff;

	atf64_b.set(atf64_x.subarray(0, 16));

	atf64_a[0] = atf64_d[0] = 1;

	for(i_f=254; i_f>=0; --i_f) {
		xn_r = (atu8_z[i_f >>> 3] >>> (i_f & 7)) & 1;
		sel25519(atf64_a, atf64_b, xn_r);
		sel25519(atf64_c, atf64_d, xn_r);

		// A(e, a, c);
		// Z(a, a, c);
		add_sub(atf64_e, atf64_a, atf64_c);

		// A(c, b, d);
		// Z(b, b, d);
		add_sub(atf64_c, atf64_b, atf64_d);

		square(atf64_d, atf64_e);
		square(atf64_f, atf64_a);
		// M(atf64_d, atf64_e, atf64_a);
		// M(atf64_f, atf64_a, atf64_a);

		mul(atf64_a, atf64_c, atf64_a);
		mul(atf64_c, atf64_b, atf64_e);

		// A(e, a, c);
		// Z(a, a, c);
		add_sub(atf64_e, atf64_a, atf64_c);

		square(atf64_b, atf64_a);
		// M(atf64_b, atf64_a, atf64_a);

		sub(atf64_c, atf64_d, atf64_f);
		mul(atf64_a, atf64_c, ATF64_121665);
		add(atf64_a, atf64_a, atf64_d);
		mul(atf64_c, atf64_c, atf64_a);
		mul(atf64_a, atf64_d, atf64_f);
		mul(atf64_d, atf64_b, atf64_x);

		square(atf64_b, atf64_e);
		// M(atf64_b, atf64_e, atf64_e);

		sel25519(atf64_a, atf64_b, xn_r);
		sel25519(atf64_c, atf64_d, xn_r);
	}

	[atf64_a, atf64_c, atf64_b, atf64_d].map((atf64, i_block) => atf64_x.set(atf64, ++i_block * 16));

	let atf64_x32 = atf64_x.subarray(32);
	let atf64_x16 = atf64_x.subarray(16);

	atf64_c.set(atf64_x32.subarray(0, 16));

	for(i_f=253; i_f>=0; i_f--) {
		square(atf64_c, atf64_c);
		// M(atu8_c, atu8_c, atu8_c);

		if(2 !== i_f && 4 !== i_f) mul(atf64_c, atf64_c, atf64_x32);
	}

	atf64_x32.set(atf64_c);


	mul(atf64_x16, atf64_x16, atf64_x32);


	// pack
	atf64_b.set(atf64_x16.subarray(0, 16));

	car25519(atf64_b);
	car25519(atf64_b);
	car25519(atf64_b);

	for(i_ff=0; i_ff<2; i_ff++) {
		atf64_a[0] = atf64_b[0] - 0xffed;
		for(i_f=1; i_f<15; i_f++) {
			atf64_a[i_f] = atf64_b[i_f] - 0xffff - ((atf64_a[i_f-1] >> 16) & 1);
			atf64_a[i_f-1] &= 0xffff;
		}

		atf64_a[15] = atf64_b[15] - 0x7fff - ((atf64_a[14] >> 16) & 1);
		xn_r = (atf64_a[15] >> 16) & 1;
		atf64_a[14] &= 0xffff;
		sel25519(atf64_b, atf64_a, 1 - xn_r);
	}

	for(i_f=0; i_f<16; i_f++) {
		atu8_q[2*i_f] = atf64_b[i_f] & 0xff;
		atu8_q[(2*i_f) + 1] = atf64_b[i_f]>>8;
	}


	return atu8_q;
};

export const crypto_scalarmult_base = (atu8_n: Uint8Array): Uint8Array => crypto_scalarmult(atu8_n, ATU8_BASE);
