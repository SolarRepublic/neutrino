import type {JsonValue} from '@blake.regalia/belt';

import {buffer} from '@blake.regalia/belt';

export const safe_json = <
	w_out extends JsonValue=JsonValue,
>(sx_json: string): w_out | void => {
	try {
		return JSON.parse(sx_json);
	}
	catch(e_parse) {}
};

// eslint-disable-next-line @typescript-eslint/naming-convention,@typescript-eslint/no-unused-vars
export const random_32 = (_?: never): Uint8Array => crypto.getRandomValues(buffer(32));
