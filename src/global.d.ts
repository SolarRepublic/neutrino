import type {Base64, HexLower} from '@solar-republic/contractor';

declare module '@blake.regalia/belt' {
	function buffer_to_base64(atu8_buffer: Uint8Array): Base64;
	function buffer_to_hex(atu8_buffer: Uint8Array): HexLower;
	function text_to_base64(s_text: string): Base64;
}
