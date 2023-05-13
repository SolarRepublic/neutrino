import type {SecretBech32} from '../types';
import type {Coin} from '@cosmjs/amino';
import type {Dict} from '@solar-republic/belt';


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

export interface BasicAllowance {
	'@type': '/cosmos.feegrant.v1beta1.BasicAllowance';
	spend_limit: Coin[];
	expiration: string | null;
}

export interface PeriodicAllowance {
	'@type': '/cosmos.feegrant.v1beta1.PeriodicAllowance';
	basic: BasicAllowance | null;
	period: string | null;
	// period_spend_limit
}

export interface AllowanceResponse {
	granter: SecretBech32;
	grantee: SecretBech32;
	allowance: BasicAllowance;
}


export type RpcRequest<
	a_args extends any[]=[],
> = (...a_args: a_args) => [string] | [string, Dict];


export const SR_LCD_AUTH = '/cosmos/auth/v1beta1/';

export const SR_LCD_AUTHZ = '/cosmos/authz/v1beta1/';

export const SR_LCD_BANK = '/cosmos/bank/v1beta1/';

export const SR_LCD_COMPUTE = '/compute/v1beta1/';

export const SR_LCD_FEEGRANT = '/cosmos/feegrant/v1beta1/';


export const F_RPC_REQ_NO_ARGS: RpcRequest = () => [''];

export const lcd_query = <
	a_args extends any[],
	w_parsed,
>(
	f_req: RpcRequest<a_args>,
	f_res: (g_response: any) => w_parsed
) => async(p_origin: string, ...a_args: a_args): Promise<w_parsed> => {
	let [sr_append, h_args] = f_req(...a_args);

	if(h_args) {
		sr_append += '?'+new URLSearchParams(h_args);
	}

	// submit request
	const d_res = await fetch(p_origin+sr_append);

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
