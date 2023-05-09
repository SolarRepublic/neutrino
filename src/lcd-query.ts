import type {A, F} from 'ts-toolbelt';

import type {ContractInfo, SecretBech32} from './types';
import type {Coin} from '@cosmjs/amino';
import type {Dict, JsonObject} from '@solar-republic/belt';

import {
	F_IDENTITY,
	base64_to_buffer,
	buffer_to_base64,
	ode,
} from '@solar-republic/belt';

type RpcRequest = (...a_args: any[]) => [string] | [string, Dict];

type RpcLeaf = [
	RpcRequest,
	(g_response: JsonObject) => any,
	RpcMap?,
];

type RpcMap = {
	[key: string]: RpcMap | RpcLeaf;
};


const F_DEFAULT: RpcRequest = () => [''];
const F_APPEND_PATH: RpcRequest = s_arg => ['/'+s_arg];

// interface GrantAuthorization {
// 	granter: SecretBech32;
// 	grantee: SecretBech32;
// 	authorization: Authorization;
// 	expiration: string;
// }

export interface AccountResponse {
	'@type': string;
	address: SecretBech32;
	pub_key: {
		'@type': '/cosmos.crypto.secp256k1.PubKey';
		key: string;
	};
	account_number: `${bigint}`;
	sequence: `${bigint}`;
}

const H_QUERIES = {
	cosmos: {
		auth: {
			v1beta1: {
				accounts: [
					(sa_account: SecretBech32) => sa_account? ['/'+sa_account]: [],
					g => (g.accounts ?? [g.account]) as AccountResponse[],
				],
			},
		},

		authz: {
			v1beta1: {
				grants: [
					(sa_granter: SecretBech32, sa_grantee: SecretBech32, si_msg_type='') => ['', {
						granter: sa_granter,
						grantee: sa_grantee,
						...si_msg_type && {msg_type_url:si_msg_type},
					}],
					g => g.grants,
					// {
					// 	granter: [

					// 	],
					// },
				],
			},
		},

		// distribution: {
		// 	v1beta1: {
		// 		// validators: [
		// 		// 	(sa_validator: SecretBech32<'valoper'>, )
		// 		// ],

		// 		// delegators: [],

		// 		// community_pool: [],

		// 		// foundation_tax: [],

		// 		// restake_threshold: [],

		// 		// restake_entries: [],
		// 	},
		// },

		bank: {
			v1beta1: {
				balances: [
					(sa_account: SecretBech32, si_denom='') => ['/'+sa_account+(si_denom? '/by_denom': ''), si_denom? {
						denom: si_denom,
					}: null],
					g => (g.balances ?? [g.balance]) as Coin[],
				],

				spendable_balances: [
					F_APPEND_PATH as (sa_account: SecretBech32) => [string],
					g => g.balances as Coin[],
				],

				params: [
					F_DEFAULT,
					F_IDENTITY as () => Dict,
				],
			},
		},
	},

	compute: {
		v1beta1: {
			info: [
				F_APPEND_PATH as (sa_contract: SecretBech32) => [string],
				g => g.ContractInfo as ContractInfo,
			],

			query: [
				(sa_contract: SecretBech32, atu8_query: Uint8Array) => ['/'+sa_contract, {
					query: buffer_to_base64(atu8_query),
				}],
				g => base64_to_buffer(g.data),
			],

			code_hash: {
				by_contract_address: [
					F_APPEND_PATH as (sa_contract: string) => [string],
					g => g.code_hash as string,
				],

				by_code_id: [
					F_APPEND_PATH as (si_code: `${bigint}`) => [string],
					g => g.code_hash as string,
				],
			},

			contract_address: [
				F_APPEND_PATH as (si_label: string) => [string],
			],
		},
	},

	registration: {
		v1beta1: {
			txKey: [
				F_DEFAULT,
				g => base64_to_buffer(g.key),
			],
		},
	},
} as const;


type QueryMap = typeof H_QUERIES;

type ModuleMethod<z_descriptor> = z_descriptor extends readonly [F.Function, F.Function]
	? F.Function<
		F.Parameters<z_descriptor[0]>,
		Promise<F.Return<z_descriptor[1]>>
	>
	: ModuleApi<z_descriptor>;

type ModuleApi<h_methods> = h_methods extends {cosmos: any}
	? ModuleApi<h_methods['cosmos']> & ModuleApi<Omit<h_methods, 'cosmos'>>
	: h_methods extends {v1beta1: any}
		? ModuleApi<h_methods['v1beta1']>
		: {
			-readonly [si_method in keyof h_methods]: A.Compute<ModuleMethod<h_methods[si_method]>>;
		};

export type LcdQueryClient = ModuleApi<QueryMap> & {
	_p_origin: string;
};

export const queryClient = (p_origin: string): LcdQueryClient => {
	const h_modules = {
		_p_origin: p_origin,
	} as LcdQueryClient;

	(function unfurl(h_set: RpcMap, a_path=['']) {
		for(const [si_part, w_value] of ode(h_set)) {
			const a_local = [...a_path, si_part];

			if(Array.isArray(w_value)) {
				const sr_path = a_local.join('/');
				const f_req = w_value[0] || F_DEFAULT;
				const f_res = w_value[1];

				// unfurl sub-methods
				if(w_value[2]) {
					unfurl(w_value[2], a_local);
				}

				const f_method = async(...a_args) => {
					let [sr_append, h_args] = f_req(...a_args);
					if(h_args) {
						sr_append += '?'+new URLSearchParams(h_args);
					}

					// submit request
					const d_res = await fetch(p_origin+sr_path.replace(/[A-Z]/g, s => '-'+s.toLowerCase())+sr_append);

					// resolve as text
					const sx_res = await d_res.text();

					// parse json
					const g_res = JSON.parse(sx_res);

					// error
					if(g_res.code) {
						throw new Error(`Error ${g_res.code}: ${g_res.message}`);
					}

					// process response
					return f_res(g_res);
				};

				let h_node = h_modules;
				for(const si_sub of a_path.filter(s => !/^(cosmos|v\d+(beta\d*)?)$/.test(s)).slice(1)) {
					h_node = h_node[si_sub] = h_node[si_sub] || {};
				}

				h_node[si_part] = f_method;
			}
			else {
				unfurl(w_value, a_local);
			}
		}
	})(H_QUERIES as unknown as RpcMap);

	return h_modules;
};
