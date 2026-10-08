import type {Dict} from '@blake.regalia/belt';

import type {SecretAccAddr, Snip24} from '@solar-republic/contractor';

import type {TrustedContextUrl} from '@solar-republic/types';

import {hex_to_bytes} from '@blake.regalia/belt';

import './helper.js';

import {queryCosmosBankSpendableBalances} from '@solar-republic/cosmos-grpc/cosmos/bank/v1beta1/query';
import {queryCosmosFeegrantAllowances} from '@solar-republic/cosmos-grpc/cosmos/feegrant/v1beta1/query';

// import {ent_to_sk} from '../scrap/secp256k1';


import {exec_secret_contract, retry, snip24_amino_sign} from '../src/app-layer.js';
import {SecretContract} from '../src/secret-contract.js';
import {random_32} from '../src/util.js';
import {CosmosSigner} from '../src/cosmos-signer.js';


const h_env = process.env;

const SI_CHAIN = h_env['NFP_CHAIN']!;

const P_LCD_ENDPOINT = h_env['NFP_LCD'] as TrustedContextUrl;

const P_RPC_ENDPOINT = h_env['NFP_RPC'] as TrustedContextUrl;

const SA_CONTRACT = h_env['NFP_CONTRACT'] as SecretAccAddr;

const SA_GRANTER = h_env['NFP_GRANTER'] as SecretAccAddr | undefined;



export async function connect() {

	// create a fresh seed for this query/execution session
	const atu8_seed = random_32();

	// Live tests require an explicitly supplied key; never derive a public demo key.
	const key = h_env['NFP_PRIVATE_KEY_HEX'];
	if(!key || !/^[0-9a-f]{64}$/i.test(key)) throw Error('Set NFP_PRIVATE_KEY_HEX explicitly for live tests');
	const atu8_sk = hex_to_bytes(key);

	// instantiate wallet
	const k_wallet = await CosmosSigner<'secret'>(atu8_sk, SI_CHAIN, P_LCD_ENDPOINT, P_RPC_ENDPOINT, [0.125, 'uscrt'], 'secret');

	console.log(`Wallet account: ${k_wallet.addr}`);

	// account balance
	{
		console.log('Spendable balance: ', ...await queryCosmosBankSpendableBalances(P_LCD_ENDPOINT, k_wallet.addr));
	}


	// prepare to interact with contract
	const k_contract = await SecretContract<Snip24>(P_LCD_ENDPOINT, SA_CONTRACT, atu8_seed);

	// find feegrants
	const [g_allowances] = await queryCosmosFeegrantAllowances(P_LCD_ENDPOINT, k_wallet.addr);

	let sa_granter: SecretAccAddr | '' = '';
	for(const g_allowance of g_allowances?.allowances || []) {
		sa_granter = g_allowance.granter as SecretAccAddr;

		console.log('Found feegrant from: ', sa_granter, ' for ', g_allowance.allowance);
	}

	// sign a query permit
	const g_permit = await snip24_amino_sign(k_wallet, 'test', [k_contract.addr], ['balance', 'owner']);


	// define executables
	const g_executables = {
		// set a viewing key
		async viewing_key() {
			const a_response = await retry(() => exec_secret_contract(k_contract, k_wallet, {
				set_viewing_key: {
					key: 'password123',
				},
			}, '50000', [['2500', 'uscrt']], sa_granter), (z_exec, c_attempts) => {
				// retry-able
				if(((z_exec as Dict)?.['message'] || '').includes('timed out')) {
					if(c_attempts < 5) {
						return [6e3];
					}
				}
			});

			console.log('Set viewing key execution response: ', ...a_response);
		},
	};

	return {
		k_wallet,
		k_contract,
		sa_granter,
		g_permit,
		g_executables,
		atu8_sk,
	};
}
