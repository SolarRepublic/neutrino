

// export const H_TXS = {
// 	bank: {
// 		send() {
// 			req('/cosmos.bank.v1beta1.Msg/Send')
// 		},
// 	},
// };

import type {LcdQueryClient} from './lcd-query';
import type {SecretBech32} from './types';
import type {Coin} from '@cosmjs/amino';

import {ATU8_NIL, sha256} from '@solar-republic/belt';

import {bech32Decode} from './bech32';
import {protobuf, type ProtoWriter} from './protobuf';


interface MsgSend {
	from_address: SecretBech32;
	to_address: SecretBech32;
	amount: Coin[];
}

interface MsgExecuteContract {
	sender: SecretBech32;
	contract: SecretBech32;
	code_hash: string;
	msg: Uint8Array;
	sent_funds?: Coin[];
}

const F_DEFAULT = g => ['', g];

// const encode_coin = (g_coin: Coin, k_writer: ProtoWriter) => k_writer
// 	.uint32(10).string(g_coin.denom)
// 	.uint32(18).string(g.amount);



export const H_MSGS = {
	secret: {
		bank: {
			v1beta1: {
				send: [
					(g: MsgSend) => ['', g],
				],
			},
		},

		compute: {
			v1beta1: {
				executeContract: [
					// (g: MsgExecuteContract) => ({
					// 	sender: bech32Decode(g.sender),
					// 	contract: bech32Decode(g.contract),
					// 	msg: g.msg,
					// 	callback_code_hash: '',
					// 	callback_sig: ATU8_NIL,
					// 	sent_funds: g.sent_funds,
					// }),
					(g: MsgExecuteContract, k_writer: ProtoWriter) => {
						k_writer.uint32(10).bytes(bech32Decode(g.sender))
							.uint32(18).bytes(bech32Decode(g.contract))
							.uint32(26).bytes(g.msg);

						for(const g_coin of g.sent_funds || []) {
							k_writer.coin(g_coin);
						}
					},
				],
			},
		},
	},
};



export const txClient = (k_querier: LcdQueryClient) => {
	const s = '';

	return {
		async sign() {
		},
	};
};

