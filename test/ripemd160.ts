import {buffer_to_base64, buffer_to_hex, text_to_buffer} from '@blake.regalia/belt';

import {ripemd160} from '../src/ripemd160';

(async() => {
	const atu8_digest = ripemd160(text_to_buffer('thequickbrownfoxjumpedoverthelazydogthequickbrownfoxjumpedoverthelazydog'));
	const sb16_digest = buffer_to_hex(atu8_digest);

	const sb16_expect = 'bacb2043ae0042817e63bd330a6048241620fded';
	console.log('expect: '+sb16_expect+'\nactual: '+sb16_digest);
})();
