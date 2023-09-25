/* eslint-disable @typescript-eslint/naming-convention */
import type {WeakSecretAccAddr} from '../types';

import type {Dict} from '@blake.regalia/belt';
import type {Coin} from '@cosmjs/amino';

import {F_IDENTITY} from '@blake.regalia/belt';

import {F_RPC_REQ_NO_ARGS, SR_LCD_BANK, lcd_query} from './_root';

export const queryBankBalances = lcd_query<
	[sa_account: WeakSecretAccAddr, si_denom?: string],
	Coin[]
>(
	(sa_account, si_denom='') => [
		SR_LCD_BANK+'balances/'+sa_account+(si_denom? '/by_denom': ''),
		si_denom
			? {
				denom: si_denom,
			}: {},
	],
	g => g.balances ?? [g.balance]
);

export const queryBankSpendableBalances = lcd_query<
	[sa_account: WeakSecretAccAddr],
	Coin[]
>(
	sa_account => [SR_LCD_BANK+'spendable_balances/'+sa_account],
	g => g.balances
);

export const queryBankParams = lcd_query<
	[],
	Dict
>(
	F_RPC_REQ_NO_ARGS,
	F_IDENTITY
);
