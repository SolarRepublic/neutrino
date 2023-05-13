export type SecretBech32<
	si_hrp extends `secret${string}`='secret',
> = `${si_hrp}1${string}`;

export interface ContractInfo {
	code_id: `${bigint}`;
	creator: SecretBech32;
	label: string;
}

export type HttpsUrl = `https://${string}`;
