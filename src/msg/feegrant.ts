import type {SecretBech32} from 'src/types';

import {Protobuf, any} from '../protobuf-writer.js';

export const msgGrantAllowance = (
	sa_granter: SecretBech32,
	sa_grantee: SecretBech32,
	atu8_allowance: Uint8Array
): Uint8Array => {
	// construct body
	const kb_body = Protobuf()
		.v(10).s(sa_granter)
		.v(18).s(sa_grantee)
		.v(26).b(atu8_allowance);

	// construct as direct message
	return any('/cosmos.feegrant.v1beta1.MsgGrantAllowance', kb_body.o());
};
