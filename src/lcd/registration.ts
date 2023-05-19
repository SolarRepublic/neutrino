import type {Base64} from '@blake.regalia/belt';

import {base64_to_buffer} from '@blake.regalia/belt';

import {lcd_query} from './_root';

export const tx_key = lcd_query<
	[],
	Uint8Array
>(
	() => ['/registration/v1beta1/tx-key'],
	g => base64_to_buffer(g.key as Base64)
);
