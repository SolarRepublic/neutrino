/// <reference types="@solar-republic/contractor" />
/* eslint-disable prefer-const */
import type {CborValue} from './cbor';
import type {SecretContract} from './secret-contract';
import type {AuthSecret, HttpsUrl, MsgNotificationSeedUpdate, NotificationSeedUpdate, NotificationSeedUpdateConfig, TendermintEvent, JsonRpcResponse, TxResult, WeakSecretAccAddr} from './types';

import type {Wallet} from './wallet';
import type {Base64, SecretAccAddr} from '@solar-republic/contractor/datatypes';
import type {SecretContractInterface, Snip52} from '@solar-republic/contractor/snips';

import {hmac, base64_to_buffer, text_to_buffer, buffer_to_base64, sha256, ode, ofe} from '@blake.regalia/belt';

import {query_contract_infer, subscribe_tendermint_events} from './app-layer';
import {cborDecode} from './cbor';
import {chacha20_poly1305_open} from './chacha20-poly1305';
import {XN_16} from './constants';
import {bigint_to_buffer_be, buffer_to_bigint_be, die, safe_json} from './util';
import {sign_amino} from './wallet';

export type NotificationCallback = (z_data: CborValue) => void;



export const subscribe_snip52_channels = async(
	p_rpc: HttpsUrl,
	k_contract: SecretContract<Snip52>,
	z_auth: Exclude<AuthSecret, string>,
	h_channels: Record<string, NotificationCallback>
): Promise<void> => {
	const h_resolved = ofe(await Promise.all(ode(h_channels).map(async([si_channel, fk_notification]) => {
		let [g_result, xc_code, s_error] = await query_contract_infer(k_contract, 'channel_info', {
			channel: si_channel,
		}, z_auth);

		if(!g_result) throw die(s_error);

		// parse seed
		let atu8_seed = base64_to_buffer(g_result.seed+'');  // TODO: add typings to utility function

		// counter mode
		if('counter' === g_result.mode) {
			let {
				counter: sg_counter,
				next_id: si_next,
			} = g_result;

			// step counter back by one for initial call to next_id
			let xg_counter = BigInt(sg_counter) -1n;

			// create function to generate next id
			let next_id = async() => buffer_to_base64(await hmac(atu8_seed, text_to_buffer(si_channel+':'+(xg_counter += 1n))));

			// derive next notification id
			let si_notification = await next_id();

			// prep channel hash
			let xg_hash = buffer_to_bigint_be((await sha256(text_to_buffer(si_channel))).subarray(0, 12));

			// ensure it is a match with the next expected
			if(si_notification !== si_next) die('Failed to derive accurate notification ID');

			return [
				si_notification,
				[
					si_channel,
					atu8_seed,
					xg_counter,
					xg_hash,
					next_id,
					fk_notification,
				] as const,
			] as [Base64, [string, Uint8Array, bigint, bigint, typeof next_id, typeof fk_notification]];
		}
		// // txhash mode
		// else if('txhash' === g_result.mode) {
		// 	// // create function to generate next id
		// 	// let next_id = async(si_tx: string) => buffer_to_base64(await hmac(atu8_seed, text_to_buffer(si_channel+':'+si_tx)));
		// }

		throw die('nop');
	})));

	// on contract execution
	subscribe_tendermint_events(p_rpc, `wasm.contract_address='${k_contract.addr}'`, async(d_event) => {
		// parse message frame
		const g_jsonrpc_result = safe_json<JsonRpcResponse<TendermintEvent<TxResult>>>(d_event.data as string)!.result;
		let h_events = g_jsonrpc_result.events;

		// check each channel
		for(let si_notification in h_resolved) {
			let [si_channel, atu8_seed, xg_counter, xg_hash, next_id, fk_notification] = h_resolved[si_notification as Base64];

			// notification received
			let a_received = h_events?.['wasm.'+si_notification];
			if(a_received) {
				// construct aad
				let g_tx = g_jsonrpc_result.data.value.TxResult;
				let atu8_aad = text_to_buffer(g_tx.height+':'+h_events['tx.acc_seq'][0].split('/')[0]);

				// decode payload
				let atu8_payload = base64_to_buffer(a_received[0]);

				// create nonce
				let atu8_nonce = bigint_to_buffer_be(xg_hash ^ xg_counter, 12);

				// decrypt notification data, splitting payload between tag and ciphertext
				const atu8_message = chacha20_poly1305_open(atu8_seed, atu8_nonce, atu8_payload.subarray(-XN_16), atu8_payload.subarray(0, -XN_16), atu8_aad);

				// call listener with decrypted data
				fk_notification(cborDecode(atu8_message)[0]);

				// remove notification and move onto next
				delete h_resolved[si_notification as Base64];
				h_resolved[await next_id()] = [si_channel, atu8_seed, xg_counter + 1n, xg_hash, next_id, fk_notification];
			}
		}
	});
};


export const sign_seed_update = async(
	k_wallet: Wallet,
	sa_contract: WeakSecretAccAddr,
	sb64_previous: Base64
): Promise<NotificationSeedUpdate> => {
	// prep params
	const g_params: NotificationSeedUpdateConfig = {
		contract: sa_contract as SecretAccAddr,
		previous_seed: sb64_previous,
	};

	// sign query permit
	const [atu8_signature, g_signed] = await sign_amino<[MsgNotificationSeedUpdate]>(k_wallet, [{
		type: 'notification_seed',
		value: g_params,
	}], [['0', 'uscrt']], '1', ['0', '0']);

	// encode notification seed update
	return {
		params: {
			...g_signed.msgs[0].value,
			chain_id: k_wallet.ref,
		},
		signature: {
			pub_key: {
				type: 'tendermint/PubKeySecp256k1',
				value: buffer_to_base64(k_wallet.pk33),
			},
			signature: buffer_to_base64(atu8_signature),
		},
	};
};
