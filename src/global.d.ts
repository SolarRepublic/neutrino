/* eslint-disable @typescript-eslint/naming-convention */
export * from '@blake.regalia/belt';

import type {CwBase64, CwHexLower} from '@solar-republic/types';

declare module '@blake.regalia/belt' {
	declare const text_to_base64: (s_text: string) => CwBase64;
	declare const bytes_to_hex: (atu8_buffer: Uint8Array) => CwHexLower;
	declare const bytes_to_base64_slim: (atu8_buffer: Uint8Array) => CwBase64;
	declare const bytes_to_base64: (atu8_buffer: Uint8Array) => CwBase64;
}
