import type {ContractInfo, SecretBech32} from '../types';

import type {HexLower, Uint128} from '@blake.regalia/belt';

import {base64_to_buffer, buffer_to_base64} from '@blake.regalia/belt';

import {SR_LCD_COMPUTE, lcd_query} from './_root';

export const info = lcd_query<
	[sa_contract: SecretBech32],
	ContractInfo
>(
	sa_contract => [SR_LCD_COMPUTE+'info/'+sa_contract],
	g => g.ContractInfo
);

export const query = lcd_query<
	[sa_contract: SecretBech32, atu8_query: Uint8Array],
	Uint8Array
>(
	(sa_contract, atu8_query) => [SR_LCD_COMPUTE+'query/'+sa_contract, {
		query: buffer_to_base64(atu8_query),
	}],
	g => base64_to_buffer(g.data as string)
);

export const code_hash_by_contract_addr = lcd_query<
	[sa_contract: SecretBech32],
	HexLower
>(
	sa_contract => [SR_LCD_COMPUTE+'code_hash/by_contract_address/'+sa_contract],
	g => g.code_hash
);

export const code_hash_by_code_id = lcd_query<
	[si_code: Uint128],
	HexLower
>(
	si_code => [SR_LCD_COMPUTE+'code_hash/by_code_id/'+si_code],
	g => g.code_hash
);

export const contract_addr = lcd_query<
	[si_label: string],
	SecretBech32
>(
	si_label => [SR_LCD_COMPUTE+'contract_address/'+si_label],
	g => g.contract_address
);

