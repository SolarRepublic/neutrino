import type {A} from 'ts-toolbelt';

export type Base64 = A.Type<string, 'base64'>;

export type Hexadecimal = A.Type<string, 'hex'>;

export type SecretBech32<
	si_hrp extends `secret${string}`='secret',
> = `${si_hrp}1${string}`;

export interface ContractInfo {
	code_id: `${bigint}`;
	creator: SecretBech32;
	label: string;
}

export type HttpsUrl = `https://${string}`;

export interface PermitConfig {
	permit_name: string;
	allowed_tokens: SecretBech32[];
	permissions: string[];
}

export interface QueryPermit {
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
