/// <reference types="@solar-republic/contractor" />
/* eslint-disable prefer-const */
import type {SecretContract} from './secret-contract';
import type {AuthSecret, HttpsUrl, MsgNotificationSeedUpdate, NotificationSeedUpdate, NotificationSeedUpdateConfig, TendermintEvent, JsonRpcResponse, TxResult, WeakSecretAccAddr} from './types';

import type {Wallet} from './wallet';
import type {Base64, CborValue, SecretAccAddr, Snip52ChannelDict} from '@solar-republic/contractor/datatypes';
import type {Snip20, Snip52} from '@solar-republic/contractor/snips';

import type {ContractInterface} from '@solar-republic/contractor/typings';

import {hmac, base64_to_buffer, text_to_buffer, buffer_to_base64, sha256, ode, ofe, type JsonObject} from '@blake.regalia/belt';

import {query_contract_infer, subscribe_tendermint_events} from './app-layer';
import {cborDecode} from './cbor';
import {chacha20_poly1305_open} from './chacha20-poly1305';
import {XN_16} from './constants';
import {bigint_to_buffer_be, buffer_to_bigint_be, die, safe_json} from './util';
import {sign_amino} from './wallet';

export type NotificationCallback = (z_data: CborValue) => void;

type Channels<g_interface extends ContractInterface> = g_interface['config']['snip52_channels'];

/**
 * Subscribes to the set of channels given by a dict of callbacks, each of which will be invoked for every
 * new notification emitted on that channel. 
 * Returns an unsubscribe callback once all subscriptions have been confirmed.
 * @param p_rpc 
 * @param k_contract 
 * @param z_auth 
 * @param h_channels 
 */
export const subscribe_snip52_channels = async<
	g_interface extends ContractInterface,
	h_channels extends Channels<g_interface>,
	// as_channels extends g_interface['config'] extends {snip52_channels: infer h_channels}? keyof h_channels: never,
	as_channels extends keyof h_channels,
>(
	p_rpc: HttpsUrl,
	k_contract: SecretContract<g_interface>,
	z_auth: Exclude<AuthSecret, string>,
	h_channels: {
		[si_channel in as_channels]: (w_data: h_channels[si_channel]) => void;
	}
): Promise<() => void> => {
	// const h_resolved = {} as Record<Extract<keyof typeof h_channels, string>, [
	// 	Base64,
	// 	[
	// 		string, Uint8Array, bigint, bigint,
	// 		() => Promise<Base64>,
	// 		typeof h_channels[Extract<keyof typeof h_channels, string>],
	// 	],
	// ]>;

	const h_resolved = {} as Record<Base64, [
		string, Uint8Array, bigint, bigint,
		() => Promise<Base64>,
		typeof h_channels[Extract<keyof typeof h_channels, string>],
	]>;

	// fetch channel info for all requested channels at once
	let [g_result, xc_code, s_error] = await query_contract_infer(k_contract as SecretContract<Snip52>, 'channel_info', {
		channels: Object.keys(h_channels),
	}, z_auth);

	if(!g_result) throw die(s_error);

	// each channel
	for(const g_channel of g_result.channels) {
		const si_channel = g_channel.channel as Extract<keyof typeof h_channels, string>;

		// parse seed
		let atu8_seed = base64_to_buffer(g_channel.seed+'');  // TODO: add typings to utility function

		// counter mode
		if('counter' === g_channel.mode) {
			// step counter back by one for initial call to next_id
			let xg_counter = BigInt(g_channel.counter) -1n;

			// create function to generate next id
			let next_id = async() => buffer_to_base64(await hmac(atu8_seed, text_to_buffer(si_channel+':'+(xg_counter += 1n))));

			// derive next notification id
			let si_notification = await next_id();

			// prep channel hash
			let xg_hash = buffer_to_bigint_be((await sha256(text_to_buffer(si_channel))).subarray(0, 12));

			// ensure it is a match with the next expected
			if(si_notification !== g_channel.next_id) die('Failed to derive accurate notification ID');

			h_resolved[si_notification] = [
				si_channel,
				atu8_seed,
				xg_counter,
				xg_hash,
				next_id,
				h_channels[si_channel],
			];
		}
		// // txhash mode
		// else if('txhash' === g_result.mode) {
		// 	// // create function to generate next id
		// 	// let next_id = async(si_tx: string) => buffer_to_base64(await hmac(atu8_seed, text_to_buffer(si_channel+':'+si_tx)));
		// }

		throw die('nop');
	}
	// })));

	// on contract execution
	const d_ws = subscribe_tendermint_events(p_rpc, `wasm.contract_address='${k_contract.addr}'`, async(d_event) => {
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
				// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
				fk_notification(cborDecode(atu8_message)[0] as any);

				// remove notification and move onto next
				delete h_resolved[si_notification as Base64];
				h_resolved[await next_id()] = [si_channel, atu8_seed, xg_counter + 1n, xg_hash, next_id, fk_notification];
			}
		}
	});

	// unsubscribe callback: close websocket
	return () => d_ws.close();
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
