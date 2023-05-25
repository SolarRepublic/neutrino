import type {AccountResponse} from './_root';
import type {SecretBech32} from '../types';

import {lcd_query} from './_root';

export const queryAuthAccounts = lcd_query<
	[sa_contract?: SecretBech32 | ''],
	AccountResponse[]
>(
	sa_account => ['/cosmos/auth/v1beta1/accounts'+(sa_account? '/'+sa_account: '')],
	g => g.accounts ?? [g.account]
);
