import './helper';

import {
	connect,
} from './live';

import {query_contract, query_contract_infer} from '../src/app-layer';


(async function() {
	const {
		k_wallet,
		k_contract,
		sa_granter,
		g_permit,
		g_executables,
	} = await connect();

		// query for token info
	{
		const a_response = await query_contract(k_contract, {
			token_info: {},
		});

		console.log('Token info query response: ', ...a_response);
	}

		// check that query permit works
	{
		const a_response = await query_contract_infer(k_contract, 'balance', {}, g_permit);

		console.log(`Authenticated token balance query response with permit: `, ...a_response);
	}
})();
