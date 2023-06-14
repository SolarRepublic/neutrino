import {buffer_to_hex, text_to_buffer} from '@blake.regalia/belt';

import {poly1305} from '../src/poly1305';


// const atu8_key = new Uint8Array(32);
// atu8_key.set([0x36, 0xe5, 0xf6, 0xb5, 0xc5, 0xe0, 0x60, 0x70, 0xf0, 0xef, 0xca, 0x96, 0x22, 0x7a, 0x86, 0x3e]);

// const atu8_plaintext = text_to_buffer('Any submission to the IETF intended by the Contributor for publication as all or part of an IETF Internet-Draftor RFC and any statement made within the context of an IETF activity is considered an "IETF Contribution". Suchstatements include oral statements in IETF sessions, as well aswritten and electronic communications made at any time or place, which are addressed to');

const atu8_key = Uint8Array.from([
	0x85, 0xd6, 0xbe, 0x78, 0x57, 0x55, 0x6d, 0x33, 0x7f, 0x44, 0x52, 0xfe, 0x42, 0xd5, 0x06, 0xa8,
	0x01, 0x03, 0x80, 0x8a, 0xfb, 0x0d, 0xb2, 0xfd, 0x4a, 0xbf, 0xf6, 0xaf, 0x41, 0x49, 0xf5, 0x1b,
]);

const atu8_plaintext = text_to_buffer('Cryptographic Forum Research Group');

debugger;
const atu8_cipher = poly1305(atu8_key, atu8_plaintext);

console.log(buffer_to_hex(atu8_cipher));
