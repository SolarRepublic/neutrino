import type {AllowanceResponse} from './_root';
import type {SecretBech32} from '../types';

import {Protobuf, any} from 'src/protobuf-writer';

import {SR_LCD_FEEGRANT, lcd_query} from './_root';

export const queryFeegrantAllowance = lcd_query<
	[sa_granter: SecretBech32, sa_grantee: SecretBech32],
	AllowanceResponse
>(
	(sa_granter, sa_grantee) => [SR_LCD_FEEGRANT+'allowance/'+sa_granter+'/'+sa_grantee],
	g => g.allowance
);

export const queryFeegrantAllowances = lcd_query<
	[sa_grantee: SecretBech32],
	AllowanceResponse[]
>(
	sa_grantee => [SR_LCD_FEEGRANT+'allowances/'+sa_grantee],
	g => g.allowances
);

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
