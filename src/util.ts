import type {JsonValue} from '@blake.regalia/belt';

export const safe_json = <
	w_out extends JsonValue=JsonValue
>(sx_json: string): w_out | void => {
	try {
		return JSON.parse(sx_json);
	}
	catch(e_parse) {}
};