/* eslint-disable @typescript-eslint/naming-convention */
import type {CwBase64, CwHexLower} from '@solar-republic/types';

declare module '@blake.regalia/belt' {
	declare const buffer_to_base64: (atu8_buffer: Uint8Array) => CwBase64;
	declare const buffer_to_hex: (atu8_buffer: Uint8Array) => CwHexLower;
	declare const text_to_base64: (atu8_buffer: Uint8Array) => CwBase64;
}
