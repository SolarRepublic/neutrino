import type {AsJson, Base64, JsonObject, Nilable, RemoveJsonInterfaces, Uint128} from '@blake.regalia/belt';
import type {AminoMsg, Coin, StdFee, StdSignDoc} from '@cosmjs/amino';

export type SecretBech32<
	si_hrp extends `secret${string}`='secret',
> = `${si_hrp}1${string}`;

export type SlimCoin = [
	sg_amount: Uint128,
	s_denom: 'uscrt',
];

export interface ContractInfo {
	code_id: Uint128;
	creator: SecretBech32;
	label: string;
}

export type HttpsUrl = `https://${string}`;

export interface PermitConfig extends JsonObject {
	permit_name: string;
	allowed_tokens: SecretBech32[];
	permissions: string[];
}

export interface QueryPermit extends JsonObject {
	params: PermitConfig & {
		chain_id: string;
	};
	signature: {
		pub_key: {
			type: 'tendermint/PubKeySecp256k1';
			value: Base64;
		};
		signature: Base64;
	};
}

export type MsgQueryPermit = TypedAminoMsg<'query_permit', PermitConfig>;

export interface TypedCoin extends Coin, JsonObject {
	readonly amount: Uint128;
}

export interface TypedStdFee extends JsonObject {
	readonly amount: TypedCoin[];
	readonly gas: Uint128;
	readonly granter?: SecretBech32;
	readonly payer?: SecretBech32;
}

export interface TypedAminoMsg<
	si_type extends string=string,
	g_value extends JsonObject=JsonObject,
> extends AminoMsg, JsonObject {
	readonly type: si_type;
	readonly value: g_value;
}

export interface TypedStdSignDoc<
	a_msgs extends readonly TypedAminoMsg[]=TypedAminoMsg[],
> extends StdSignDoc, JsonObject<a_msgs> {
	readonly account_number: Uint128;
	readonly sequence: Uint128;
	readonly fee: TypedStdFee;
	readonly msgs: a_msgs;
}

/**
 * There are 3 types of authenticated queries typically used on Secret Network.
 * 1. Viewing Keys - indicated here by `string`
 * 2. Query Permits - indicated here by `Record<string, string>`
 * 3. ViewerInfo struts - indicated here by `[viewing_key: string, addr: 'secret1${string}']`
 */
export type AuthSecret = string | QueryPermit | [sh_viewing_key: string, sa_address: SecretBech32];


export type SlimAuthInfo = [acc_num: Nilable<Uint128>, sequence: Nilable<Uint128>];
