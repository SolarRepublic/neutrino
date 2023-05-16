import type {SecretBech32} from '../types';

import type {Dict} from '@blake.regalia/belt';

import {lcd_query} from './_root';

export const grants = lcd_query<
	[sa_granter: SecretBech32, sa_grantee: SecretBech32, si_msg_type: string],
	Dict
>(
	(sa_granter, sa_grantee, si_msg_type='') => ['/cosmos/authz/v1beta1/grants', {
		granter: sa_granter,
		grantee: sa_grantee,
		...si_msg_type && {
			msg_type_url: si_msg_type,
		},
	}],
	g => g.grants
);
