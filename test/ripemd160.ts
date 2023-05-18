import {hex_to_buffer, text_to_buffer} from '@blake.regalia/belt';

import chai, {expect} from 'chai';
import chai_bites from 'chai-bites';
chai.use(chai_bites);

import {describe} from './helper';

import {ripemd160} from '../src/ripemd160';

const A_VECTORS = [
	{
		message: 'thequickbrownfoxjumpedoverthelazydogthequickbrownfoxjumpedoverthelazydog',
		digest: 'bacb2043ae0042817e63bd330a6048241620fded',
	},
];

A_VECTORS.forEach((g_vector, i_vector) => {
	void describe(`Vector #${i_vector+1}`, ({it}) => {
		void it('digest', () => {
			const atu8_digest = ripemd160(text_to_buffer(g_vector.message));

			expect(atu8_digest).to.equalBytes(hex_to_buffer(g_vector.digest));
		});
	});
});
