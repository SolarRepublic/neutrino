import type {JsonValue, Nilable} from '@solar-republic/belt';

import {aes128SivDecrypt, aes128SivEncrypt} from '@solar-republic/aes-128-siv-js';
import {
	buffer,
	ATU8_NIL,
	base64_to_buffer,
	buffer_to_text,
	text_to_buffer,
} from '@solar-republic/belt';


import {crypto_scalarmult, crypto_scalarmult_base} from './x25519';

const ATU8_SALT_HKDF = base64_to_buffer('AAAAAAAAAAAAAkvq2N9pmQhSwgLbDgCXwaEupjfX6W0=');


const concat2 = (atu8_a: Uint8Array, atu8_b: Uint8Array) => {
	const atu8_out = buffer(atu8_a.length + atu8_b.length);
	atu8_out.set(atu8_a);
	atu8_out.set(atu8_b, atu8_a.length);
	return atu8_out;
};

const random = () => crypto.getRandomValues(buffer(32));


export class SecretWasm {
	static parse(sb64_msg: string): [Uint8Array, Uint8Array, Uint8Array] {
		const atu8_msg = base64_to_buffer(sb64_msg);

		return [
			// nonce
			atu8_msg.subarray(0, 32),

			// public key
			atu8_msg.subarray(32, 64),

			// ciphertext
			atu8_msg.subarray(64),
		];
	}

	#_atu8_pk: Uint8Array;
	#_atu8_tx_ikm: Uint8Array;

	constructor(atu8_consensus_pk: Uint8Array, atu8_seed?: Nilable<Uint8Array>) {
		atu8_seed = atu8_seed || random();

		if(32 !== atu8_consensus_pk.byteLength) throw new Error(`Invalid consensus key length`);
		if(32 !== atu8_seed.byteLength) throw new Error(`Invalid seed length`);

		// copy seed to new private key
		const atu8_sk = atu8_seed.slice();

		// derive curve25119 public key
		const atu8_pk = this.#_atu8_pk = crypto_scalarmult_base(atu8_sk);

		// turn secret key into correct format
		atu8_sk[0] &= 0xf8;
		atu8_sk[31] &= 0x7f;
		atu8_sk[31] |= 0x40;

		// remove sign bit from public key
		atu8_pk[31] &= 0x7f;

		// produce tx ikm
		this.#_atu8_tx_ikm = crypto_scalarmult(atu8_sk, atu8_consensus_pk);
	}

	async txKey(atu8_nonce=random()): Promise<Uint8Array> {
		const atu8_input = concat2(this.#_atu8_tx_ikm, atu8_nonce);

		const dk_input = await crypto.subtle.importKey('raw', atu8_input, 'HKDF', false, ['deriveBits']);

		const ab_encryption = await crypto.subtle.deriveBits({
			name: 'HKDF',
			hash: 'SHA-256',
			salt: ATU8_SALT_HKDF,
			info: ATU8_NIL,
		}, dk_input, 256);

		return buffer(ab_encryption);
	}

	async encodeMsg(sb16_code_hash: string, g_msg: JsonValue, nb_msg_block?: number): Promise<Uint8Array> {
		// construct payload
		const atu8_payload = text_to_buffer(sb16_code_hash.toUpperCase()+JSON.stringify(g_msg));

		// pad to make multiple of block size
		const nb_payload = atu8_payload.byteLength;
		const nb_target = nb_msg_block? Math.ceil(nb_payload / nb_msg_block) * nb_msg_block: nb_payload;

		// pad the end with spaces
		const atu8_padding = text_to_buffer(' '.repeat(nb_target - nb_payload));

		// construct plaintext
		const atu8_plaintext = concat2(atu8_payload, atu8_padding);

		// generate nonce
		const atu8_nonce = random();

		// derive transaction encryption key
		const atu8_txk = await this.txKey(atu8_nonce);

		// encrypt
		const atu8_ciphertext = await aes128SivEncrypt(atu8_txk, atu8_plaintext);

		// produce final output bytes
		return concat2(atu8_nonce, concat2(this.#_atu8_pk, atu8_ciphertext));
	}

	async decrypt(atu8_ciphertext: Uint8Array, atu8_nonce: Uint8Array): Promise<Uint8Array> {
		// derive transaction encryption key
		const atu8_txk = await this.txKey(atu8_nonce);

		// decrypt ciphertext
		return await aes128SivDecrypt(atu8_txk, atu8_ciphertext);
	}

	async decodeMsg(sb64_msg: string): Promise<[string, string, Uint8Array]> {
		const [
			atu8_nonce,
			atu8_pk,
			atu8_ciphertext,
		] = SecretWasm.parse(sb64_msg);

		const atu8_plaintext = await this.decrypt(atu8_ciphertext, atu8_nonce);

		const sx_exec = buffer_to_text(atu8_plaintext);

		return [
			// contents
			sx_exec.slice(64),

			// code hash
			sx_exec.slice(0, 64),

			// nonce
			atu8_nonce,
		];
	}
}
