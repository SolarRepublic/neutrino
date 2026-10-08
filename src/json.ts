import type {JsonObject, JsonValue} from '@blake.regalia/belt';

import {__UNDEFINED} from '@blake.regalia/belt';

/** Omit undefined object properties; reject values which JSON would silently change. */
export function to_wire_json(w_input: unknown, b_sort_keys=false): JsonValue {
	const as_visiting = new Set<object>();
	const f_visit = (w_value: unknown): JsonValue => {
		if(null === w_value || 'string' === typeof w_value || 'boolean' === typeof w_value) return w_value;
		if('number' === typeof w_value && Number.isFinite(w_value)) return w_value;
		if('object' !== typeof w_value || !w_value) throw Error('Invalid JSON value');
		if(as_visiting.has(w_value)) throw Error('Cyclic JSON value');
		as_visiting.add(w_value);
		try {
			if(Array.isArray(w_value)) return Array.from(w_value, f_visit);
			const w_prototype: unknown = Object.getPrototypeOf(w_value);
			if(w_prototype !== Object.prototype && null !== w_prototype) throw Error('Expected a plain JSON object');
			const h_result: JsonObject = {};
			const a_entries = Object.entries(w_value);
			if(b_sort_keys) a_entries.sort(([s_a], [s_b]) => s_a < s_b? -1: s_a > s_b? 1: 0);
			for(const [s_key, w_item] of a_entries) {
				if(__UNDEFINED !== w_item) Object.defineProperty(h_result, s_key, {value:f_visit(w_item), enumerable:true, writable:true, configurable:true});
			}

			return h_result;
		}
		finally { as_visiting.delete(w_value); }
	};

	return f_visit(w_input);
}

/** Validate the JSON object envelope, not the contract-specific fields erased by TypeScript. */
export function contract_response(w_value: unknown, s_context='contract response'): JsonObject {
	if(!w_value || 'object' !== typeof w_value || Array.isArray(w_value)) throw Error(`Expected a JSON object for ${s_context}`);
	return w_value as JsonObject;
}

/** Renamed response keys are accepted only when the envelope is unambiguous. */
export function unwrap_contract_response(w_answer: unknown, si_method: string): JsonObject {
	const h_answer = contract_response(w_answer);
	const a_keys = Object.keys(h_answer);
	const s_key = Object.hasOwn(h_answer, si_method)? si_method: 1 === a_keys.length? a_keys[0]: __UNDEFINED;
	if(!s_key) throw Error('Missing or ambiguous contract response key');
	return contract_response(h_answer[s_key]);
}
