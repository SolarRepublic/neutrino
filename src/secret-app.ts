
import type {CreateQueryArgsAndAuthParams, MergeTuple} from './inferencing.js';
import type {SecretContract} from './secret-contract.js';
import type {AuthSecret, TxResultWrapper, WeakSecretAccAddr} from './types.js';
import type {Wallet} from './wallet.js';

import type {JsonObject, Nilable} from '@blake.regalia/belt';
import type {ContractInterface} from '@solar-republic/contractor';
import type {SlimCoin} from '@solar-republic/types';

import {__UNDEFINED, odv, safe_json} from '@blake.regalia/belt';

import {exec_secret_contract, query_secret_contract_infer} from './app-layer.js';


export const exec_fees = (xg_limit: bigint|`${bigint}`, x_gas_price: number, s_denom='uscrt') => [[
	''+Math.ceil(Number(xg_limit) * x_gas_price), s_denom],
] as [SlimCoin];

type ConvertAuth<a_tuple extends [any?, any?]> = MergeTuple<a_tuple extends [any, any]
	? [h_args: a_tuple[0], xc_auth: 1]
	: undefined extends a_tuple[1]
		? [h_args: a_tuple[0], xc_auth?: 0]
		: [h_args: a_tuple[0], xc_auth: 1]>;

/**
 * Simple wrapper for querying and executing a Secret contract. Binds Wallet and SecretContract, as well
 * as an AuthSecret, gas price, and optional granter.
 */
export interface SecretApp<
	g_interface extends ContractInterface=ContractInterface,
> {
	price(xn_price: number): void;
	granter(sa_granter: WeakSecretAccAddr): void;

	/**
	 * Query a Secret Contract method and automatically apply an auth secret if one is provided.
	 * Additionally, unwrap the success response if one was returned.
	 * @param si_method - which query method to invoke
	 * @param h_args - the args value to pass in with the given query
	 * @param z_auth - optional {@link AuthSecret} to perform an authenticated query
	 * @returns tuple of `[JsonObject?, number, string, JsonObject?]` where:
	 *  - [0]: `w_result?: JsonObject` - parsed & unwrapped contract result on success
	 *  - [1]: `xc_code: number` - error code from chain, or non-OK HTTP status code from the LCD server.
	 * 		A value of `0` indicates success.
	 *  - [2]: `s_error: string` - error message from chain or HTTP response body
	 *  - [3]: `h_answer?: JsonObject` - contract response as JSON object on success
	 */
	query<
		h_variants extends ContractInterface.MsgAndAnswer<g_interface, 'queries'>=ContractInterface.MsgAndAnswer<g_interface, 'queries'>,
		si_method extends Extract<keyof h_variants, string>=Extract<keyof h_variants, string>,
		g_variant extends h_variants[si_method]=h_variants[si_method],
	>(
		si_method: si_method,
		...[h_args, z_auth]: CreateQueryArgsAndAuthParams<
			h_variants,
			si_method,
			ContractInterface extends g_interface? 1: 0
		>
	): Promise<[
		w_result: g_variant['response'] | undefined,
		xc_code: number,
		s_error: string,
		h_answer?: g_variant['answer'],
	]>;


	/**
	 * Executes the contract with given method, args, and limit. Automatically determines fee at set gas price.
	 * Automatically uses granter if set on instance using {@link SecretApp.granter}.
	 * @param si_method - which execution method to invoke
	 * @param h_exec - the args value to pass in with the given execution
	 * @param xg_limit - the gas limit to set for the transaction
	 * @param a_funds - optional Array of {@link SlimCoin} of funds to send into the contract with the tx
	 * @param s_memo - optional memo field
	 * @returns tuple of `[number, string, TxResponse?]`
	 *  - [0]: `w_result?: JsonValue` - parsed & unwrapped contract result on success
	 *  - [1]: `xc_code: number` - error code from chain, or non-OK HTTP status code from the LCD server.
	 * 		A value of `0` indicates success.
	 *  - [2]: `s_res: string` - message text. on success, will be the contract's response as a JSON string.
	 * 		on error, will be either the error string from HTTP response text, chain error message,
	 * 		or contract error as a JSON string.
	 *  - [3]: `g_tx_res?: `{@link TxResponse} - on success, the parsed transaction response JSON object
	 *  - [4]: `si_txn?: string` - the transaction hash if a broadcast attempt was made
	 * 
	 * @throws a {@link BroadcastResultErr}
	 */
	exec<
		h_group extends ContractInterface.MsgAndAnswer<g_interface, 'executions'>,
		as_methods extends Extract<keyof h_group, string>,
	>(
		si_method: as_methods,
		h_exec: ContractInterface extends g_interface? JsonObject: h_group[as_methods]['msg'],
		xg_limit: bigint,
		a_funds?: SlimCoin[],
		s_memo?: string
	): Promise<[
		w_result: h_group[as_methods]['response'] | undefined,
		xc_code: number,
		s_response: string,
		g_tx: TxResultWrapper['TxResult'] | undefined,
		si_txn: string | undefined,
	]>;
}

export const SecretApp = <
	g_interface extends ContractInterface,
>(
	k_wallet: Wallet<'secret'>,
	k_contract: SecretContract<g_interface>,
	xn_gas_price: number,
	sa_granter?: WeakSecretAccAddr
): SecretApp<g_interface> => ({
	price: (xn_price: number) => xn_gas_price = xn_price,
	granter: (sa_granter_new: WeakSecretAccAddr) => sa_granter = sa_granter_new,

	query: (
		si_method: string,
		h_args: Nilable<JsonObject>=__UNDEFINED,
		z_auth: Nilable<AuthSecret>=__UNDEFINED
	) => query_secret_contract_infer(
		k_contract as SecretContract,
		si_method,
		h_args || {},
		z_auth
	),

	exec: async(
		si_method: string,
		h_args: JsonObject,
		xg_limit: bigint,
		a_funds?: SlimCoin[],
		s_memo?: string
	) => {
		const [xc_code, s_res, g_tx, si_txn] = await exec_secret_contract(
			k_contract as SecretContract,
			k_wallet,
			{[si_method]:h_args},
			exec_fees(xg_limit, xn_gas_price),
			xg_limit+'' as `${bigint}`,
			sa_granter,
			a_funds,
			s_memo
		);

		const g_ans = safe_json<JsonObject>(s_res) || {};

		return [xc_code? __UNDEFINED: g_ans? odv(g_ans)[0] as JsonObject: g_ans, xc_code, s_res, g_tx, si_txn];
	},
});
