import type {AllowanceResponse} from './_root';
import type {SecretBech32} from '../types';

import {SR_LCD_FEEGRANT, lcd_query} from './_root';

export const allowance = lcd_query<
	[sa_granter: SecretBech32, sa_grantee: SecretBech32],
	AllowanceResponse
>(
	(sa_granter, sa_grantee) => [SR_LCD_FEEGRANT+'allowance/'+sa_granter+'/'+sa_grantee],
	g => g.allowance
);

export const allowances = lcd_query<
	[sa_grantee: SecretBech32],
	AllowanceResponse[]
>(
	sa_grantee => [SR_LCD_FEEGRANT+'allowances/'+sa_grantee],
	g => g.allowances
);

