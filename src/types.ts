import type {Dict, JsonObject, JsonString, Nilable} from '@blake.regalia/belt';
import type {AminoMsg, Coin, StdSignDoc} from '@cosmjs/amino';
import type {SecretAccAddr, Uint128, Base64, QueryPermit} from '@solar-republic/contractor';


export type WeakSecretAccAddr = `secret1${string}`;

export type WeakUint128 = `${bigint}`;

export type SlimCoin = [
	sg_amount: WeakUint128,
	s_denom: 'uscrt',
];

export type ContractInfo = {
	code_id: WeakUint128;
	creator: SecretAccAddr;
	label: string;
};

export type HttpsUrl = `https://${string}`;

export type PermitConfig = {
	permit_name: string;
	allowed_tokens: SecretAccAddr[];
	permissions: string[];
};

export type NotificationSeedUpdateConfig = {
	contract: SecretAccAddr;
	previous_seed: Base64;
};

export type SignedAminoDoc<
	h_config extends JsonObject,
> = {
	params: h_config & {
		chain_id: string;
	};
	signature: {
		pub_key: {
			type: 'tendermint/PubKeySecp256k1';
			value: Base64;
		};
		signature: Base64;
	};
};

// export type QueryPermit = SignedAminoDoc<PermitConfig>;

export type NotificationSeedUpdate = SignedAminoDoc<NotificationSeedUpdateConfig>;

export type MsgQueryPermit = TypedAminoMsg<'query_permit', PermitConfig>;

export type MsgNotificationSeedUpdate = TypedAminoMsg<'notification_seed', NotificationSeedUpdateConfig>;

export interface TypedCoin extends Coin, JsonObject {
	readonly amount: Uint128;
}

export interface TypedStdFee extends JsonObject {
	readonly amount: TypedCoin[];
	readonly gas: Uint128;
	readonly granter?: SecretAccAddr;
	readonly payer?: SecretAccAddr;
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


export type AuthSecret_ViewerInfo = [sh_key: string, sa_viewer?: WeakSecretAccAddr];

/**
 * There are 3 types of authenticated queries typically used on Secret Network.
 * 1. Viewing Keys - indicated here by `string`
 * 2. Query Permits - indicated here by `Record<string, string>`
 * 3. ViewerInfo struts - indicated here by `[viewing_key: string, addr: 'secret1${string}']`
 */
export type AuthSecret = string | QueryPermit | AuthSecret_ViewerInfo;


export type SlimAuthInfo = [acc_num: Nilable<WeakUint128>, sequence: Nilable<WeakUint128>];

/**
 * Bundles LCD and RPC endpoint URLs together
 */
export interface LcdRpcStruct {
	/**
	 * The LCD endpoint the struct is configured for
	 */
	lcd: HttpsUrl;

	/**
	 * RPC endpoint used for confirming broadcasted transactions
	 */
	rpc: HttpsUrl;
}


export type JsonRpcResponse<
	w_result extends JsonObject,
> = {
	jsonrpc: '2.0';
	id: string;
	result: w_result;
};

export type TendermintEvent<
	w_value extends JsonObject,
> = {
	query: string;
	data: {
		type: `tendermint/event/${string}`;
		value: w_value;
	};
	events: Dict<string[]>;
};

export type TxResult = {
	TxResult: {
		height: Uint128;
		index: number;
		tx: Base64;
		result: {
			code?: number;
			data: Base64;
			log: JsonString;
			gas_wanted: Uint128;
			gas_used: Uint128;
			events: {
				type: string;
				attributes: {
					key: Base64;
					value: Base64;
					index?: boolean;
				}[];
			}[];
		};
	};
};
