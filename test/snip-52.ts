import './helper.js';

import type {NaiveBase64} from '@blake.regalia/belt';

import type {Snip24, Snip52} from '@solar-republic/contractor';

import type {SecretContract} from '../src/secret-contract.js';
import type {CwBase64, WeakUintStr} from '@solar-republic/types';

import {bytes_to_hex, text_to_base64, base64_to_bytes} from '@blake.regalia/belt';


import {bech32_encode} from '@solar-republic/crypto';

import {connect} from './live.js';
import {exec_secret_contract, query_secret_contract} from '../src/app-layer.js';
import {snip52_seed_update_sign, subscribe_snip52_channels} from '../src/snip-52.js';

const SI_COMMAND = process.argv[2] as 'init' | 'trigger' | 'update' | 'export' ?? 'subscribe';

(async function() {
	const {
		k_wallet,
		k_contract: k_connected,
		sa_granter,
		g_permit,
		g_executables,
		atu8_sk,
	} = await connect();

	// This live fixture also exposes custom execution methods.
	const k_contract: SecretContract = k_connected;

	async function channel_info() {
		const [g_res_list] = await query_secret_contract(k_contract as SecretContract<Snip52>, 'list_channels');

		// get first channel
		const si_channel = g_res_list!['channels'][0];

		// get its info using viewing key
		const [g_res_info, xc_code, s_error] = await query_secret_contract(k_contract as SecretContract<Snip52>, 'channel_info', {
			channels: [si_channel],
		}, ['password123', k_wallet.addr]);
		// <{
		// 	channel: string;
		// 	seed: NaiveBase64;
		// 	counter: WeakUintStr;
		// 	as_of_block: WeakUintStr;
		// 	cddl?: string;
		// }>

		console.log(g_res_info, xc_code, s_error);

		return g_res_info;
	}

	await {
		export() {
			console.log(bytes_to_hex(atu8_sk));
		},

		async init() {
			await g_executables.viewing_key();
		},

		async subscribe() {
			await channel_info();

			await subscribe_snip52_channels(k_wallet.rpc.origin, k_contract, g_permit, {
				tx(g_data: unknown) {
					const atu8_sender = base64_to_bytes((g_data as Map<string, string>).get('sender')!);

					const sa_sender = bech32_encode('secret', atu8_sender);

					console.log(`Received from ${sa_sender}`);
				},
			});
		},

		async trigger() {
			const a_response = await exec_secret_contract(k_contract, k_wallet, {
				tx: {
					channel: 'tx',
				},
			}, '50000', [['2500', 'uscrt']], sa_granter);

			console.log(`Trigger notif: `, ...a_response);
		},

		async update() {
			// fetch current seed
			const {seed:sb64_seed} = (await channel_info())!;

			// sign new doc
			const g_update = await snip52_seed_update_sign(k_wallet, k_contract.addr, sb64_seed as CwBase64);

			// execute update
			const a_response = await exec_secret_contract(k_contract, k_wallet, {
				update_seed: {
					signed_doc: g_update,
				},
			}, '50000', [['2500', 'uscrt']], sa_granter);

			console.log(`Update seed: `, ...a_response);
		},

		async update_invalid() {
			// fetch current seed
			const {seed:sb64_seed} = (await channel_info())!;

			// sign new doc
			const g_update = await snip52_seed_update_sign(k_wallet, k_contract.addr, text_to_base64('not-seed') as unknown as CwBase64);

			// execute update
			const a_response = await exec_secret_contract(k_contract, k_wallet, {
				update_seed: {
					signed_doc: g_update,
				},
			}, '50000', [['2500', 'uscrt']], sa_granter);

			console.log(`Update invalid seed: `, ...a_response);
		},
	}[SI_COMMAND]();
})();
