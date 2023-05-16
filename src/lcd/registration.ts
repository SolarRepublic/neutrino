import {base64_to_buffer} from '@blake.regalia/belt';

import {lcd_query} from './_root';

export const txKey = lcd_query<
	[],
	Uint8Array
>(
	() => ['/registration/v1beta1/tx-key'],
	g => base64_to_buffer(g.key)
);
