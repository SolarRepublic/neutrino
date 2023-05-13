import type {ContractInfo, SecretBech32} from '../types';

import {base64_to_buffer, buffer_to_base64} from '@solar-republic/belt';

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
	g => base64_to_buffer(g.data)
);

export const codeHashByContractAddr = lcd_query<
	[sa_contract: SecretBech32],
	string
>(
	sa_contract => [SR_LCD_COMPUTE+'code_hash/by_contract_address/'+sa_contract],
	g => g.code_hash
);

export const codeHashByCodeId = lcd_query<
	[si_code: `${bigint}`],
	string
>(
	si_code => [SR_LCD_COMPUTE+'code_hash/by_code_id/'+si_code],
	g => g.code_hash
);

export const contractAddr = lcd_query<
	[si_label: string],
	SecretBech32
>(
	si_label => [SR_LCD_COMPUTE+'contract_address/'+si_label],
	g => g.contract_address
);

