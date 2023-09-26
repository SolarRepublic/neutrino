import type {SecretContract} from './secret-contract';
import type {AuthSecret, SlimCoin} from './types';
import type {Wallet} from './wallet';

import type {SecretAccAddr} from '@solar-republic/contractor/datatypes';

import {__UNDEFINED, type JsonObject} from '@blake.regalia/belt';

import {exec_contract, query_contract_infer} from './app-layer';

export const exec_fees = (xg_limit: bigint|`${bigint}`, x_gas_price: number, s_denom='uscrt') => [[
	''+Math.ceil(Number(xg_limit) * x_gas_price), s_denom],
] as [SlimCoin];

/**
 * Simple wrapper for querying and executing a Secret contract. Binds Wallet and SecretContract, as well
 * as an AuthSecret, gas price, and optional granter.
 */
export interface SecretApp {
	price(xn_price: number): void;

	query(
		si_method: string,
		h_args: JsonObject,
		xc_auth: 0|1,
	): ReturnType<typeof query_contract_infer>;

	exec(
		h_exec: JsonObject,
		xg_limit: bigint,
		a_funds?: SlimCoin[],
		s_memo?: string
	): ReturnType<typeof exec_contract>;
}

export const SecretApp = (
	k_wallet: Wallet,
	k_contract: SecretContract,
	xn_gas_price: number,
	z_auth: AuthSecret,
	sa_granter?: SecretAccAddr
): SecretApp => ({
	price: (xn_price: number) => xn_gas_price = xn_price,

	query: (
		si_method: string,
		h_args: JsonObject={},
		xc_auth: 0|1=0
	) => query_contract_infer(
		k_contract,
		si_method,
		h_args,
		xc_auth? z_auth: __UNDEFINED
	),

	exec: (
		h_exec: JsonObject,
		xg_limit: bigint,
		a_funds?: SlimCoin[],
		s_memo?: string
	) => exec_contract(
		k_contract,
		k_wallet,
		h_exec,
		exec_fees(xg_limit, xn_gas_price),
		xg_limit+'' as `${bigint}`,
		sa_granter,
		a_funds,
		s_memo
	),
});
