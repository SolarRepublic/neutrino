
const gf = (init?) => {
	let i; const r = new Float64Array(16);
	if(init) for(i = 0; i < init.length; i++) r[i] = init[i];
	return r;
};

const _9 = new Uint8Array(32); _9[0] = 9;
const _121665 = gf([0xdb41, 1]);

const car25519 = (o) => {
	let i; let v; let c = 1;
	for(i = 0; i < 16; i++) {
		v = o[i] + c + 65535;
		c = Math.floor(v / 65536);
		o[i] = v - c * 65536;
	}

	o[0] += c-1 + 37 * (c-1);
};

const sel25519 = (p, q, b) => {
	let t; const c = ~(b-1);
	for(let i = 0; i < 16; i++) {
		t = c & (p[i] ^ q[i]);
		p[i] ^= t;
		q[i] ^= t;
	}
};

const pack25519 = (o, n) => {
	let i, j, b;
	const m = gf(); const t = gf();
	for(i = 0; i < 16; i++) t[i] = n[i];
	car25519(t);
	car25519(t);
	car25519(t);
	for(j = 0; j < 2; j++) {
		m[0] = t[0] - 0xffed;
		for(i = 1; i < 15; i++) {
			m[i] = t[i] - 0xffff - ((m[i-1]>>16) & 1);
			m[i-1] &= 0xffff;
		}

		m[15] = t[15] - 0x7fff - ((m[14]>>16) & 1);
		b = (m[15]>>16) & 1;
		m[14] &= 0xffff;
		sel25519(t, m, 1-b);
	}

	for(i = 0; i < 16; i++) {
		o[2*i] = t[i] & 0xff;
		o[2*i+1] = t[i]>>8;
	}
};

const unpack25519 = (o, n) => {
	let i;
	for(i = 0; i < 16; i++) o[i] = n[2*i] + (n[2*i+1] << 8);
	o[15] &= 0x7fff;
};

const A = (o, a, b) => {
	for(let i = 0; i < 16; i++) o[i] = a[i] + b[i];
};

const Z = (o, a, b) => {
	for(let i = 0; i < 16; i++) o[i] = a[i] - b[i];
};

const AZ = (o, a, b) => {
	A(o, a, b);
	Z(a, a, b);
};

function M(o, a, b) {
	let i; let j; const t = new Float64Array(31);
	for(i = 0; i < 31; i++) t[i] = 0;
	for(i = 0; i < 16; i++) {
		for(j = 0; j < 16; j++) {
			t[i+j] += a[i] * b[j];
		}
	}

	for(i = 0; i < 15; i++) {
		t[i] += 38 * t[i+16];
	}

	for(i = 0; i < 16; i++) o[i] = t[i];
	car25519(o);
	car25519(o);
}

const S = (o, a) => {
	M(o, a, a);
};

const inv25519 = (o, i) => {
	const c = gf();
	let a;
	for(a = 0; a < 16; a++) c[a] = i[a];
	for(a = 253; a >= 0; a--) {
		S(c, c);
		if(a !== 2 && a !== 4) M(c, c, i);
	}

	for(a = 0; a < 16; a++) o[a] = c[a];
};

export const crypto_scalarmult = (n, p) => {
	const q = new Uint8Array(32);
	const z = new Uint8Array(32);
	const x = new Float64Array(80); let r; let i;
	const a = gf(); const b = gf(); const c = gf();
	const d = gf(); const e = gf(); const f = gf();
	for(i = 0; i < 31; i++) z[i] = n[i];
	z[31]=(n[31]&127)|64;
	z[0]&=248;
	unpack25519(x, p);
	for(i = 0; i < 16; i++) {
		b[i]=x[i];
		d[i]=a[i]=c[i]=0;
	}

	a[0]=d[0]=1;
	for(i=254; i>=0; --i) {
		r=(z[i>>>3]>>>(i&7))&1;
		sel25519(a, b, r);
		sel25519(c, d, r);
		// A(e, a, c);
		// Z(a, a, c);
		AZ(e, a, c);
		// A(c, b, d);
		// Z(b, b, d);
		AZ(c, b, d);
		S(d, e);
		S(f, a);
		M(a, c, a);
		M(c, b, e);
		// A(e, a, c);
		// Z(a, a, c);
		AZ(e, a, c);
		S(b, a);
		Z(c, d, f);
		M(a, c, _121665);
		A(a, a, d);
		M(c, c, a);
		M(a, d, f);
		M(d, b, x);
		S(b, e);
		sel25519(a, b, r);
		sel25519(c, d, r);
	}

	for(i = 0; i < 16; i++) {
		x[i+16]=a[i];
		x[i+32]=c[i];
		x[i+48]=b[i];
		x[i+64]=d[i];
	}

	const x32 = x.subarray(32);
	const x16 = x.subarray(16);
	inv25519(x32, x32);
	M(x16, x16, x32);
	pack25519(q, x16);
	return q;
};

export const crypto_scalarmult_base = n => crypto_scalarmult(n, _9);

