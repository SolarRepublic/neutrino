import type {CwBase64, CwHexLower} from '@solar-republic/types';

import {text_to_base64 as belt_text_to_base64, bytes_to_base64 as belt_bytes_to_base64, bytes_to_base64_slim as belt_bytes_to_base64_slim, bytes_to_hex as belt_bytes_to_hex} from '@blake.regalia/belt';

// The codecs establish these encoding brands locally, without redeclaring Belt exports.
export const text_to_base64 = (...a_args: Parameters<typeof belt_text_to_base64>): CwBase64 => belt_text_to_base64(...a_args) as CwBase64;
export const bytes_to_base64 = (...a_args: Parameters<typeof belt_bytes_to_base64>): CwBase64 => belt_bytes_to_base64(...a_args) as CwBase64;
export const bytes_to_base64_slim = (...a_args: Parameters<typeof belt_bytes_to_base64_slim>): CwBase64 => belt_bytes_to_base64_slim(...a_args) as CwBase64;
export const bytes_to_hex = (...a_args: Parameters<typeof belt_bytes_to_hex>): CwHexLower => belt_bytes_to_hex(...a_args) as CwHexLower;
