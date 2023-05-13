import type {SecretBech32, HttpsUrl} from '../src/types';

import {text_to_buffer} from '@solar-republic/belt';

import './helper';

import {executeContract, retry} from '../src/app-layer';
import {allowances} from '../src/lcd/feegrant';
import {ent_to_sk} from '../src/secp256k1';
import {secretContract} from '../src/secret-contract';
import {wallet} from '../src/wallet';


const SI_CHAIN = process.env.NFP_CHAIN!;

const P_LCD_ENDPOINT = process.env.NFP_LCD as HttpsUrl;

const SA_CONTRACT = process.env.NFP_CONTRACT as SecretBech32;

const SA_GRANTER = process.env.NFP_GRANTER as SecretBech32 | undefined;


(async function() {
	// // instantiate query client
	// const k_querier = queryClient(P_LCD_ENDPOINT);


	// create seed for query/execution session
	const atu8_seed = new Uint8Array(32);

	// prepare to interact with contract
	const k_contract = await secretContract(P_LCD_ENDPOINT, SA_CONTRACT, atu8_seed);

	// query for token info
	const g_result = await k_contract.query({
		token_info: {},
	});

	console.log(`Query response: `, g_result);


	// create private key from entropy
	const atu8_ent = new Uint8Array(await crypto.subtle.digest('SHA-384', text_to_buffer('nfp-test-account:0')));
	const atu8_sk = ent_to_sk(atu8_ent.subarray(0, 40));

	// const atu8_sk = base64_to_buffer('8Ke2frmnGdVPipv7+xh9jClrl5EaBb9cowSUgj5GvrY=');
	// const atu8_pk33 = sk_to_pk(atu8_sk);

	// // test public keys match
	// const sb64_pk33_expect = 'A07oJJ9n4TYTnD7ZStYyiPbB3kXOZvqIMkchGmmPRAzf';
	// const sb64_pk33_actual = buffer_to_base64(atu8_pk33);
	// console.log(sb64_pk33_actual+'\n'+sb64_pk33_expect);

	// const sa_expect = 'secret1ap26qrlp8mcq2pg6r47w43l0y8zkqm8a450s03';
	// const sa_actual = await pubkey_to_bech32(atu8_pk33, 'secret');
	// console.log('expect: '+sa_expect+'\nactual: '+sa_actual);
	// debugger;

	// instantiate wallet
	const k_wallet = await wallet(P_LCD_ENDPOINT, SI_CHAIN, atu8_sk);

	console.log(`Wallet account: ${k_wallet.bech32}`);


	// find feegrants
	const a_allowances = await allowances(P_LCD_ENDPOINT, k_wallet.bech32);

	let sa_granter: SecretBech32 | '' = '';
	for(const g_allowance of a_allowances) {
		sa_granter = g_allowance.granter;
	}

	const [g_tx_res, sx_exec_res] = await retry(() => executeContract(k_contract, k_wallet, {
		set_viewing_key: {
			key: 'password123',
		},
	}, [['2500', 'uscrt']], '50000', sa_granter), (z_exec, c_attempts) => {
		// retry-able
		if(/timed out/.test(z_exec?.['message'] || '')) {
			if(c_attempts < 5) {
				return [6e3];
			}
		}
	});

	debugger;
	console.log(g_tx_res, sx_exec_res);
})();
