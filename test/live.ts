import type {SecretBech32} from '../src/types';

import {buffer_to_base64, text_to_buffer} from '@solar-republic/belt';


import {ent_to_sk} from '@solar-republic/secp256k1-js';

import {queryClient} from '../src/lcd-query';

import {secretContract} from '../src/secret-contract';
import {wallet} from '../src/wallet';

// polyfill crypto global for node.js env
globalThis.crypto = globalThis.crypto || (await import('crypto')).webcrypto;

const SA_SSCRT = 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek';

const SA_GRANTER = process.env.NFP_GRANTER as SecretBech32 | undefined;

(async function() {
	// instantiate query client
	const k_querier = queryClient('https://lcd.secret.express');


	// create seed for query/execution session
	const atu8_seed = new Uint8Array(32);

	// prepare to interact with contract
	const k_contract = await secretContract(k_querier, SA_SSCRT, atu8_seed);

	// query for token info
	const g_result = await k_contract.query({
		token_info: {},
	});

	console.log(`Query response: `, g_result);


	// create private key from entropy
	const atu8_ent = new Uint8Array(await crypto.subtle.digest('SHA-384', text_to_buffer('nfp-test-account:0')));
	const atu8_sk = ent_to_sk(atu8_ent.subarray(0, 40));

	// instantiate wallet
	const k_wallet = await wallet(k_querier, 'secret-4', atu8_sk);

	// // check if account exists
	// try {
	// 	await k_querier.auth.accounts(k_wallet.bech32);
	// }
	// catch(e_auth) {
	// 	const s_msg = (e_auth as Error).message;

	// 	// some error other than account not found
	// 	if(!/account .+ not found/.test(s_msg)) {
	// 		throw e_auth;
	// 	}

	// 	// create account
	// }


	// construct execution message
	const [atu8_msg] = await k_contract.exec({
		set_viewing_key: 'password123',
	}, k_wallet.bech32);


	// sign in direct mode
	const [atu8_tx_raw] = await k_wallet.signDirect([atu8_msg], [['2500', 'uscrt']], '25000', SA_GRANTER);

	// const atu8_coin = coin(['2500', 'uscrt']);
	// console.log(buffer_to_base64(atu8_coin));

	// log
	console.log(buffer_to_base64(atu8_tx_raw));
	debugger;

	// broadcast
	await k_wallet.broadcast(atu8_tx_raw);
})();
