/* eslint-disable @typescript-eslint/naming-convention */
import type {AccountResponse} from './_root';
import type {WeakSecretAccAddr} from '../types';

import {lcd_query} from './_root';

export const queryAuthAccounts = lcd_query<
	[sa_account?: WeakSecretAccAddr | ''],
	AccountResponse[]
>(
	sa_account => ['/cosmos/auth/v1beta1/accounts'+(sa_account? '/'+sa_account: '')],
	g => g.accounts ?? [g.account]
);
