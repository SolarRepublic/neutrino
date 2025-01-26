import type {TxMeta} from './app-layer';
import type {AsJson, Dict, JsonObject, JsonValue, Nilable} from '@blake.regalia/belt';
import type {SecretAccAddr} from '@solar-republic/contractor';
import type {CosmosClientLcd} from '@solar-republic/cosmos-grpc';
import type {TendermintAbciTxResult} from '@solar-republic/cosmos-grpc/tendermint/abci/types';
import type {WeakUint128Str, TrustedContextUrl, CwUint32, WeakSecretAccAddr, Snip24QueryPermitSigned, RemoteServiceDescriptor, CwHexUpper} from '@solar-republic/types';


export type CosmosQueryError = AsJson<{
	code: CwUint32;
	message: string;
	details: unknown[];
}>;

export type ContractInfo = {
	code_id: WeakUint128Str;
	creator: SecretAccAddr;
	label: string;
};



export type AuthSecret_ViewerInfo = [sh_key: string, sa_viewer?: WeakSecretAccAddr];

/**
 * There are 3 types of authenticated queries typically used on Secret Network.
 * 1. Viewing Keys - indicated here by `string`
 * 2. Query Permits - indicated here by `Record<string, string>`
 * 3. ViewerInfo struts - indicated here by `[viewing_key: string, addr: 'secret1${string}']`
 */
export type AuthSecret = string | Snip24QueryPermitSigned | AuthSecret_ViewerInfo;


export type SlimAuthInfo = [acc_num: Nilable<WeakUint128Str>, sequence: Nilable<WeakUint128Str>];

/**
 * Describes a pattern of requests to some remote service with partial options to use with each request
 */
export type RemoteServiceArg<p_urls extends string=never> = (TrustedContextUrl | p_urls) | RemoteServiceDescriptor<p_urls>;

/**
 * Bundles LCD and RPC endpoint URLs together
 */
export interface CosmosClientLcdRpcStruct {
	/**
	 * The LCD endpoint the struct is configured for
	 */
	lcd: CosmosClientLcd;

	/**
	 * RPC endpoint used for confirming broadcasted transactions
	 */
	rpc: RemoteServiceDescriptor;
}

/**
 * Extends the {@link CosmosClientLcdRpcStruct} with an option to override the WebSocket URL
 */
export type CosmosClientLcdRpcWsStruct = CosmosClientLcdRpcStruct & {
	/**
	 * URL to override the RPC when subscribing to /websocket
	 */
	ws?: TrustedContextUrl;
};

/**
 * JSON-RPC response
 */
export type JsonRpcResponse<
	w_result extends JsonObject,
> = {
	jsonrpc: '2.0';
	id: string | number;
	result?: w_result;
	error?: {
		code: number;
		message: string;
		data?: JsonValue;
	};
};


export type TendermintEvent<
	w_value extends JsonObject=JsonObject,
> = {
	query: string;
	data: {
		type: `tendermint/event/${string}`;
		value: w_value;
	};
	events: Dict<string[]>;
};


export type TxResultWrapper = {
	TxResult: TendermintAbciTxResult;
};
