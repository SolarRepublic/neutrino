import './helper';

import type {Base64, Uint128} from '@blake.regalia/belt';

import {buffer_to_hex, text_to_base64, base64_to_buffer} from '@blake.regalia/belt';


import {connect} from './live';
import {exec_contract, query_contract_infer} from '../src/app-layer';
import {bech32_encode} from '../src/bech32';
import {sign_seed_update, subscribe_snip52_channel} from '../src/snip-52';


const SI_COMMAND = process.argv[2] as 'init' | 'trigger' | 'update' | 'export' ?? 'subscribe';

(async function() {
	const {
		k_wallet,
		k_contract,
		sa_granter,
		g_permit,
		g_executables,
		atu8_sk,
	} = await connect();

	async function channel_info() {
		const [g_res_list] = await query_contract_infer<{
			channels: string[];
		}>(k_contract, 'list_channels');

		// get first channel
		const si_channel = g_res_list!.channels[0];

		// get its info using viewing key
		const [g_res_info, xc_code, s_error] = await query_contract_infer<{
			channel: string;
			seed: Base64;
			counter: Uint128;
			as_of_block: Uint128;
			cddl?: string;
		}>(k_contract, 'channel_info', {
			channel: si_channel,
		}, ['password123', k_wallet.addr]);

		console.log(g_res_info, xc_code, s_error);

		return g_res_info;
	}

	await {
		export() {
			console.log(buffer_to_hex(atu8_sk));
		},

		async init() {
			await g_executables.viewing_key();
		},

		async subscribe() {
			await channel_info();

			await subscribe_snip52_channel(k_wallet.rpc, k_contract, 'tx', g_permit, (g_data) => {
				const atu8_sender = base64_to_buffer((g_data as Map<string, string>).get('sender')!);

				const sa_sender = bech32_encode('secret', atu8_sender);

				console.log(`Received from ${sa_sender}`);
			});
		},

		async trigger() {
			const a_response = await exec_contract(k_contract, k_wallet, {
				tx: {
					channel: 'tx',
				},
			}, [['2500', 'uscrt']], '50000', '', sa_granter);

			console.log(`Trigger notif: `, ...a_response);
		},

		async update() {
			// fetch current seed
			const {seed:sb64_seed} = (await channel_info())!;

			// sign new doc
			const g_update = await sign_seed_update(k_wallet, k_contract.addr, sb64_seed);

			// execute update
			const a_response = await exec_contract(k_contract, k_wallet, {
				update_seed: {
					signed_doc: g_update,
				},
			}, [['2500', 'uscrt']], '50000', '', sa_granter);

			console.log(`Update seed: `, ...a_response);
		},

		async update_invalid() {
			// fetch current seed
			const {seed:sb64_seed} = (await channel_info())!;

			// sign new doc
			const g_update = await sign_seed_update(k_wallet, k_contract.addr, text_to_base64('not-seed'));

			// execute update
			const a_response = await exec_contract(k_contract, k_wallet, {
				update_seed: {
					signed_doc: g_update,
				},
			}, [['2500', 'uscrt']], '50000', '', sa_granter);

			console.log(`Update invalid seed: `, ...a_response);
		},
	}[SI_COMMAND]();
})();
