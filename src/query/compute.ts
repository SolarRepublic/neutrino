/* eslint-disable @typescript-eslint/naming-convention */
import type {ContractInfo, WeakSecretAccAddr, WeakUint128} from '../types';

import type {HexLower, SecretAccAddr} from '@solar-republic/contractor';

import {base64_to_buffer, buffer_to_base64} from '@blake.regalia/belt';

import {SR_LCD_COMPUTE, lcd_query} from './_root';

export const queryComputeInfo = lcd_query<
	[sa_contract: WeakSecretAccAddr],
	ContractInfo
>(
	sa_contract => [SR_LCD_COMPUTE+'info/'+sa_contract],
	g => g.contract_info
);

export const queryComputeQuery = lcd_query<
	[sa_contract: WeakSecretAccAddr, atu8_query: Uint8Array],
	Uint8Array
>(
	(sa_contract, atu8_query) => [SR_LCD_COMPUTE+'query/'+sa_contract, {
		query: buffer_to_base64(atu8_query),
	}],
	g => base64_to_buffer(g.data as string)
);

export const queryComputeCodeHashByContractAddr = lcd_query<
	[sa_contract: WeakSecretAccAddr],
	HexLower
>(
	sa_contract => [SR_LCD_COMPUTE+'code_hash/by_contract_address/'+sa_contract],
	g => g.code_hash
);

export const queryComputeCodeHashByCodeId = lcd_query<
	[si_code: WeakUint128],
	HexLower
>(
	si_code => [SR_LCD_COMPUTE+'code_hash/by_code_id/'+si_code],
	g => g.code_hash
);

export const queryComputeContractAddr = lcd_query<
	[si_label: string],
	SecretAccAddr
>(
	si_label => [SR_LCD_COMPUTE+'contract_address/'+si_label],
	g => g.contract_address
);

