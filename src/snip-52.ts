import {bytes_to_base64} from './encoding.js';
/* eslint-disable prefer-const */
import type {Pop} from 'ts-toolbelt/out/List/Pop';

import type {CosmosSigner} from './cosmos-signer.js';
import type {SecretContract} from './secret-contract.js';
import type {AuthSecret, TxResultWrapper} from './types.js';

import type {CborValue, Dict, Promisable} from '@blake.regalia/belt';
import type {Snip52, ContractInterface, Snip52Schema} from '@solar-republic/contractor';
import type {TendermintAbciTxResult} from '@solar-republic/cosmos-grpc/tendermint/abci/types';
import type {CwBase64, CwSecretAccAddr, Snip52NotificationSeedUpdateMsg, Snip52NotificationSeedUpdateParams, Snip52NotificationSeedUpdateSigned, TrustedContextUrl, WeakSecretAccAddr} from '@solar-republic/types';

import {hmac, base64_to_bytes, text_to_bytes, sha256, biguint_to_bytes_be, bytes_to_biguint_be, die, is_string, entries, bytes, hex_to_bytes, create, assign, sha512, hkdf, SI_HASH_ALGORITHM_SHA512} from '@blake.regalia/belt';



import {query_secret_contract} from './app-layer.js';
import {chacha20_poly1305_open} from './chacha20-poly1305.js';
import {XN_16} from './constants.js';
import {sign_amino} from './cosmos-signer.js';
import {decode_snip52_cbor, decode_snip52_data as decode_data, snip52_bloom_params, NB_SNIP52_MAX_PAYLOAD} from './snip-52-codec.js';
import {SX_QUERY_TM_EVENT_TX, TendermintEventFilter} from './tendermint-event-filter.js';

export type NotificationCallback = (z_data: CborValue) => void;

type Channels<g_interface extends ContractInterface> = g_interface['config']['snip52_channels'];

const xor_bytes = (atu8_a: Uint8Array, atu8_b: Uint8Array) => bytes(atu8_a.map((xb, ib) => xb ^ atu8_b[ib]));

type ChannelData = [
	si_channel: string,
	atu8_seed: Uint8Array,
	atu8_hash: Uint8Array,
	f_get_id: (s_salt: string) => Promise<CwBase64>,
	f_notify: (w_data: any, g_tx: TendermintAbciTxResult, h_events: Dict<string[]>) => unknown,
	xg_counter?: bigint,
];

const H_BLOOM_HASH_FUNCTIONS: Dict<(atu8_data: Uint8Array<ArrayBuffer>) => Promise<Uint8Array<ArrayBuffer>>> = assign(create(null), {
	sha256,
	sha512,
});

/**
 * Generates the bloom mode callback
 */
type Snip52BloomCallback<g_data, w_return> = (
	z_data: g_data,
	atu8_data: Uint8Array,
	g_tx: TendermintAbciTxResult,
	h_events: Dict<string[]>
) => w_return;

/**
 * Subscribes to the set of channels given by a dict of callbacks, each of which will be invoked for every
 * new notification emitted on that channel. 
 * Returns a Promise resolving to a callback that removes the listener. Promise resolves once all subscriptions
 * have been confirmed.
 * @param z_remote - either the URL to an RPC endpoint or an existing {@link TendermintEventFilter} instance
 * @param k_contract 
 * @param z_auth 
 * @param h_channels 
 */
export const subscribe_snip52_channels = async<
	g_interface extends ContractInterface,
	h_channels extends Channels<g_interface>=Channels<g_interface>,
	as_channels extends keyof h_channels=keyof h_channels,
>(
	z_remote: TrustedContextUrl | TendermintEventFilter,
	k_contract: SecretContract<g_interface>,
	z_auth: Exclude<AuthSecret, string>,
	h_channels: {
		[si_channel in as_channels]?: h_channels[si_channel] extends {cbor: CborValue}
			// direct notification with CBOR data
			? (<
				w_data extends h_channels[si_channel]['cbor'],
			>(
				w_data: w_data,
				g_tx: TendermintAbciTxResult,
				h_events: Dict<string[]>
			) => Promisable<void>)
			: h_channels[si_channel] extends {schema: Snip52Schema.Element}
				// bloom callback
				? Snip52BloomCallback<Snip52Schema.ParseDescriptorSequenced<h_channels[si_channel]['schema']> | undefined, void>
				// unknown, union of both; defer generic to function call
				: (<
					w_data extends CborValue=CborValue,
				>(w_data: w_data) => Promisable<void>)
				| (<
					g_descriptor extends Snip52Schema.Element,
				>(
					z_data: Snip52Schema.ParseDescriptorSequenced<g_descriptor>,
					atu8_data: Uint8Array,
					g_tx: TendermintAbciTxResult,
					h_events: Dict<string[]>
				) => Promisable<void>);
	}
) => {
	// dict of next notification IDs for channels operating in counter mode
	const h_resolved = Object.create(null) as Record<CwBase64, ChannelData>;

	// prep list of channels to check operating in txhash mode
	const a_dynamic = [] as ChannelData[];

	// prep list of channels to check operating in txhash mode
	const h_blooms: Dict<(
		si_txn: string,
		atu8_value: Uint8Array,
		g_data: TxResultWrapper,
		h_events: Dict<string[]>
	) => Promise<void>> = Object.create(null) as Dict<never>;

	// fetch channel info for all requested channels at once
	let [g_result,, s_error] = await query_secret_contract(k_contract as SecretContract<Snip52>, 'channel_info', {
		channels: Object.keys(h_channels),
	}, z_auth);

	// query failed
	if(!g_result) die(`While requesting channels from ${k_contract.addr}: ${s_error}`);

	// parse seed
	let atu8_seed = base64_to_bytes(g_result.seed+'');
	if(atu8_seed.length !== 32) throw Error('Invalid SNIP-52 seed');

	// each channel
	for(const g_channel of g_result.channels) {
		const si_channel = g_channel.channel as Extract<keyof typeof h_channels, string>;
		if(!Object.hasOwn(h_channels, si_channel) || typeof h_channels[si_channel] !== 'function') throw Error('Unexpected SNIP-52 channel');

		// prep channel hash
		let atu8_hash = (await sha256(text_to_bytes(si_channel))).subarray(0, 12);

		// notification ID generator
		let f_notification_id = async(s_salt: string) => await hmac(atu8_seed, text_to_bytes(si_channel+':'+s_salt));

		// notification ID as string
		let f_next_id = async(s_salt: string) => bytes_to_base64(await f_notification_id(s_salt));

		// prep common part of channel data
		const a_data: Pop<ChannelData> = [
			si_channel,
			atu8_seed,
			atu8_hash,
			f_next_id,
			h_channels[si_channel] as ChannelData[4],
		];

		// counter mode
		if('counter' === g_channel.mode) {
			// step counter back by one for initial call to next_id
			if(!/^\d+$/.test(g_channel.counter) || BigInt(g_channel.counter) > 0xffffffffffffffffn) throw Error('Invalid SNIP-52 counter');
			let xg_counter = BigInt(g_channel.counter) -1n;

			// derive next notification id
			let si_notification = await f_next_id(++xg_counter+'');

			// ensure it is a match with the next expected
			if(si_notification !== g_channel.next_id) die('Failed to derive accurate notification ID');

			// save notification
			h_resolved[si_notification] = [...a_data, xg_counter];
		}
		// txhash mode
		else if('txhash' === g_channel.mode) {
			// add to list
			a_dynamic.push(a_data);
		}
		// bloom
		else if('bloom' === g_channel.mode) {
			// destructure params
			const {
				m: n_param_m,
				k: n_param_k,
				h: s_param_h,
			} = g_channel.parameters;

			// convert k param to bigint
			const xg_param_k = BigInt(n_param_k);

			// compute number of bits needed for m param
			const [n_hash_width, xg_bits] = snip52_bloom_params(n_param_m, n_param_k, s_param_h);

			// prep mask for bottom bits
			const xg_mask_lo = (1n << xg_bits) - 1n;

			// size of each packet in bytes
			const nb_packet = (g_channel.data as Snip52Schema.PacketDescriptor).packet_size;

			// create bloom filter checker
			h_blooms[si_channel] = async(si_txn, atu8_value, {TxResult:g_tx}, h_events) => {
				if(atu8_value.length < n_param_m / 8 || atu8_value.length > NB_SNIP52_MAX_PAYLOAD) throw Error('Invalid SNIP-52 bloom payload length');
				// create filter as bigint
				const xg_filter = bytes_to_biguint_be(atu8_value.subarray(0, (n_param_m / 8) | 0));

				// create notification id
				const atu8_notification_id = await f_notification_id(si_txn);

				// hash id
				const xg_superhash = bytes_to_biguint_be(await H_BLOOM_HASH_FUNCTIONS[s_param_h](atu8_notification_id));

				// check against filter
				FILTER_CHECK: {
					// each hash
					for(let xg_hash=0n; xg_hash<xg_param_k; xg_hash++) {
						// 1 << bitsToUintBe(sliceBits(bloomHash, i*9, (i+1)*9))
						const xg_toggle = 1n << ((xg_superhash >> (BigInt(n_hash_width) - xg_bits - (xg_hash * xg_bits))) & xg_mask_lo);

						// one of the hashes doesn't match; not meant for this recipient
						if(!(xg_filter & xg_toggle)) break FILTER_CHECK;
					}

					// ref data portion
					const atu8_data = atu8_value.subarray(n_param_m / 8);

					// depending on datatype
					const g_schema = g_channel.data;
					const s_datatype = g_schema.type;

					// prep data result
					let z_data: Snip52Schema.AnyValueSequenced | undefined;

					// packets[M]
					const m_packets = /^packet\[(\d+)\]$/.exec(s_datatype);
					if(m_packets) {
						const n_packets = Number(m_packets[1]);
						if(!Number.isSafeInteger(nb_packet) || nb_packet < 1 || nb_packet > 255 * 64 || !Number.isSafeInteger(n_packets) || n_packets < 1 || (nb_packet + 8) * n_packets !== atu8_data.length) throw Error('Invalid SNIP-52 packet length');
						// prep expected packet id
						const xg_packet_id = bytes_to_biguint_be(atu8_notification_id.subarray(0, 8));

						// each packet
						for(let ib_read=8; ib_read<(nb_packet+8)*+m_packets[1]; ib_read+=nb_packet+8) {
							// found matching packet id
							if(xg_packet_id === bytes_to_biguint_be(atu8_data.subarray(ib_read-8, ib_read))) {
								// create packet ikm
								const atu8_ikm = atu8_notification_id.subarray(8, 32);

								// derive packet key
								const atu8_key = nb_packet > 24
									? await hkdf(atu8_ikm, nb_packet*8, bytes(64), bytes(), SI_HASH_ALGORITHM_SHA512)
									: atu8_ikm.subarray(0, nb_packet);

								// extract packet ciphertext
								const atu8_ciphertext = atu8_data.subarray(ib_read, ib_read+nb_packet);

								// decrypt packet
								const atu8_plaintext = xor_bytes(atu8_ciphertext, atu8_key);

								// decode packet
								[z_data] = decode_data(atu8_plaintext, (g_schema as Snip52Schema.PacketDescriptor).data);

								// stop searching for packet
								break;
							}
						}

						// packet was not found
					}
					// decode as unencrypted data
					else {
						[z_data] = decode_data(atu8_data, g_schema as Snip52Schema.DataDescriptor);
					}

					// received notification
					await f_notify_safe(() => (h_channels[si_channel] as Snip52BloomCallback<typeof z_data, Promisable<void>>)(z_data, atu8_data, g_tx, h_events));
				}
			};
		}
		// unknown
		else {
			console.warn('Unknown SNIP-52 channel mode: '+(g_channel as {mode: string}).mode);
		}
	}

	// User callback failures must not prevent authenticated counter advancement.
	const f_notify_safe = async(f_notify: () => unknown) => {
		try { await f_notify(); }
		catch{ /* Listener owns its application error reporting. */ }
	};

	const f_apply = async(
		si_notification: string,
		[, atu8_key, atu8_hash,, fk_notification]: ChannelData,
		f_salt: () => Uint8Array,
		{TxResult:g_tx}: TxResultWrapper,
		h_events: Dict<string[]>
	) => {
		// notification received
		let a_received = h_events['wasm.snip52:'+si_notification];
		if(a_received) {
			// ref tx hash
			let si_tx = h_events['tx.hash'][0];

			// construct aad
			let atu8_aad = text_to_bytes(g_tx.height+':'+si_tx);

			// create nonce
			let atu8_nonce = xor_bytes(atu8_hash, f_salt());

			// each notification
			for(const sb64_received of a_received) {
				// decode payload
				if(sb64_received.length > NB_SNIP52_MAX_PAYLOAD * 4 / 3 + 4) throw Error('SNIP-52 payload exceeds limit');
				let atu8_payload = base64_to_bytes(sb64_received);
				if(atu8_payload.length < XN_16) throw Error('Truncated SNIP-52 notification');

				// decrypt notification data, splitting payload between tag and ciphertext
				let atu8_message = chacha20_poly1305_open(atu8_key, atu8_nonce, atu8_payload.subarray(-XN_16), atu8_payload.subarray(0, -XN_16), atu8_aad);

				// call listener with decrypted data
				const w_message = decode_snip52_cbor(atu8_message);
				await f_notify_safe(() => fk_notification(w_message, g_tx, h_events));
			}
		}
	};

	const k_filter = is_string(z_remote)? await TendermintEventFilter(z_remote, SX_QUERY_TM_EVENT_TX): z_remote;
	let b_disposed = false;
	let dp_queue = Promise.resolve();
	// Bound duplicate retention; this is not a durable reconnect cursor.
	const as_seen = new Set<string>();
	const f_unlisten = k_filter.when('wasm.contract_address', k_contract.addr, ({value:g_data}, h_events) => {
		const dp_event = dp_queue.then(async() => {
			if(b_disposed) return;
			const si_hash = h_events['tx.hash']?.[0];
			if(!si_hash || !/^[\da-f]{64}$/i.test(si_hash)) throw Error('Invalid SNIP-52 transaction hash');
			const si_event = g_data.TxResult.height + ':' + si_hash;
			if(as_seen.has(si_event)) return;
		// Drain successive counter IDs within one transaction before processing the next.
			for(let [si_notification, a_data] of entries(h_resolved)) {
				while(h_events['wasm.snip52:'+si_notification]) {
					const xg_counter = a_data[5]!;
					await f_apply(si_notification, a_data, () => biguint_to_bytes_be(xg_counter, 12), g_data, h_events);
					delete h_resolved[si_notification];
					if(0xffffffffffffffffn === xg_counter) break;
					a_data[5] = xg_counter + 1n;
					si_notification = await a_data[3](a_data[5]+'');
					h_resolved[si_notification] = a_data;
				}
			}

		// ref transaction hash
			const si_txn = h_events['tx.hash'][0];

		// compute salt
			const atu8_salt = hex_to_bytes(si_txn).subarray(0, 12);

		// check each channel operating in txhash mode
			for(const a_data of a_dynamic) {
			// compute notification ID
				const si_notification = await a_data[3](si_txn);

			// apply notification
				await f_apply(si_notification, a_data, () => atu8_salt, g_data, h_events);
			}

		// check each channel operating in bloom mode
			for(const [si_channel, f_attempt] of entries(h_blooms)) {
			// lookup payloads
				for(const sb64_payload of h_events[`wasm.snip52:#${si_channel}`] || []) {
				// Bound allocation before base64 decoding.
					if(sb64_payload.length > NB_SNIP52_MAX_PAYLOAD * 4 / 3 + 4) throw Error('SNIP-52 payload exceeds limit');
					const atu8_value = base64_to_bytes(sb64_payload);

				// check filter and decode data if applicable
					await f_attempt(si_txn, atu8_value, g_data, h_events);
				}
			}

			as_seen.add(si_event);
			if(as_seen.size > 1024) as_seen.delete(as_seen.values().next().value!);
		});
		// A malformed event must not poison processing of subsequent notifications.
		dp_queue = dp_event.catch(() => { /* Keep later events processable. */ });
		return dp_event;
	});
	return () => {
		if(b_disposed) return;
		b_disposed = true;
		f_unlisten();
		if(is_string(z_remote)) k_filter.dispose?.();
	};
};


export const snip52_seed_update_sign = async(
	k_wallet: CosmosSigner,
	sa_contract: WeakSecretAccAddr,
	sb64_previous: CwBase64
): Promise<Snip52NotificationSeedUpdateSigned> => {
	// prep params
	const g_params: Snip52NotificationSeedUpdateParams = {
		contract: sa_contract as CwSecretAccAddr,
		previous_seed: sb64_previous,
	};

	// sign query permit
	const [atu8_signature, g_signed] = await sign_amino<[Snip52NotificationSeedUpdateMsg]>(k_wallet, [{
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
				value: bytes_to_base64(k_wallet.pk33),
			},
			signature: bytes_to_base64(atu8_signature),
		},
	};
};
