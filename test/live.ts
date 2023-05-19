import type {SecretBech32, HttpsUrl} from '../src/types';

import type {Dict} from '@blake.regalia/belt';

import {text_to_buffer} from '@blake.regalia/belt';

import './helper';



import {exec_contract, query_contract, query_contract_infer, retry, sign_query_permit} from '../src/app-layer';
import {allowances} from '../src/lcd/feegrant';
import {spendable_balances} from '../src/main';
import {ent_to_sk} from '../src/secp256k1';
import {SecretContract} from '../src/secret-contract';
import {random_32} from '../src/util';
import {Wallet} from '../src/wallet';

const h_env = process.env;

const SI_CHAIN = h_env['NFP_CHAIN']!;

const P_LCD_ENDPOINT = h_env['NFP_LCD'] as HttpsUrl;

const SA_CONTRACT = h_env['NFP_CONTRACT'] as SecretBech32;

const SA_GRANTER = h_env['NFP_GRANTER'] as SecretBech32 | undefined;


(async function() {
	// create seed for query/execution session (all zeros here)
	const atu8_seed = random_32();

	// create private key from entropy
	const atu8_ent = new Uint8Array(await crypto.subtle.digest('SHA-384', text_to_buffer('nfp-test-account:0')));
	const atu8_sk = ent_to_sk(atu8_ent.subarray(0, 40));

	// instantiate wallet
	const k_wallet = await Wallet(atu8_sk, SI_CHAIN, P_LCD_ENDPOINT);

	console.log(`Wallet account: ${k_wallet.addr}`);

	// account balance
	{
		console.log('Spendable balance: ', ...await spendable_balances(P_LCD_ENDPOINT, k_wallet.addr));
	}


	// prepare to interact with contract
	const k_contract = await SecretContract(P_LCD_ENDPOINT, SA_CONTRACT, atu8_seed);

	// query for token info
	{
		const a_response = await query_contract(k_contract, {
			token_info: {},
		});

		console.log('Token info query response: ', ...a_response);
	}


	// find feegrants
	const a_allowances = await allowances(P_LCD_ENDPOINT, k_wallet.addr);

	let sa_granter: SecretBech32 | '' = '';
	for(const g_allowance of a_allowances) {
		sa_granter = g_allowance.granter;

		console.log('Found feegrant from: ', sa_granter, ' for ', g_allowance.allowance);
	}

	// set a viewing key
	{
		const a_response = await retry(() => exec_contract(k_contract, k_wallet, {
			set_viewing_key: {
				key: 'password123',
			},
		}, [['2500', 'uscrt']], '50000', '', sa_granter), (z_exec, c_attempts) => {
			// retry-able
			if(((z_exec as Dict)?.['message'] || '').includes('timed out')) {
				if(c_attempts < 5) {
					return [6e3];
				}
			}
		});

		console.log('Set viewing key execution response: ', ...a_response);
	}

	// sign a query permit
	const g_permit = await sign_query_permit(k_wallet, 'test', [k_contract.addr], ['balance', 'owner']);

	// query contract
	{
		const a_response = await query_contract_infer(k_contract, g_permit, 'balance');

		console.log(`Authenticated token balance query response with permit: `, ...a_response);
	}
})();
