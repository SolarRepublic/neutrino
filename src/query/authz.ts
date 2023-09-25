import type {WeakSecretAccAddr} from '../types';

import type {Dict} from '@blake.regalia/belt';

import {lcd_query} from './_root';

export const queryAuthzGrants = lcd_query<
	[sa_granter: WeakSecretAccAddr, sa_grantee: WeakSecretAccAddr, si_msg_type: string],
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
