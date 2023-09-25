/* eslint-disable @typescript-eslint/naming-convention */
import type {AllowanceResponse} from './_root';
import type {WeakSecretAccAddr} from '../types';


import {SR_LCD_FEEGRANT, lcd_query} from './_root';


/**
 * Query specific feegrant allowance by granter & grantee pair
 */
export const queryFeegrantAllowance = lcd_query<
	[sa_granter: WeakSecretAccAddr, sa_grantee: WeakSecretAccAddr],
	AllowanceResponse
>(
	(sa_granter, sa_grantee) => [SR_LCD_FEEGRANT+'allowance/'+sa_granter+'/'+sa_grantee],
	g => g.allowance
);


/**
 * Query feegrant allowances by grantee
 */
export const queryFeegrantAllowances = lcd_query<
	[sa_grantee: WeakSecretAccAddr],
	AllowanceResponse[]
>(
	sa_grantee => [SR_LCD_FEEGRANT+'allowances/'+sa_grantee],
	g => g.allowances
);


/**
 * Query feegrant allowances by granter
 */
export const queryFeegrantIssued = lcd_query<
	[sa_granter: WeakSecretAccAddr],
	AllowanceResponse[]
>(
	sa_granter => [SR_LCD_FEEGRANT+'issued/'+sa_granter],
	g => g.allowances
);
