import type {SecretBech32, SlimCoin} from 'src/types';

import {Protobuf, any, coin, timestamp} from '../protobuf-writer.js';

export const anyBasicAllowance = (a_limits: SlimCoin[], xt_expiration?: number): Uint8Array => {
	const k_writer = Protobuf();

	a_limits.map(a_coin => k_writer.v(10).b(coin(a_coin)));

	if(xt_expiration) {
		k_writer.b(timestamp(xt_expiration));
	}

	return any('/cosmos.feegrant.v1beta1.BasicAllowance', k_writer.o());
};

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
