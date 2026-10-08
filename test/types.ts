import type {CreateQueryArgsAndAuthParams} from '../src/inferencing.js';
import type {Snip20, ContractInterface} from '@solar-republic/contractor';

type Variants = ContractInterface.MsgAndAnswer<Snip20, 'queries'>;
type BalanceArgs = CreateQueryArgsAndAuthParams<Variants, 'balance', 0>;
const valid: BalanceArgs = [{address: 'secret1test'}, 'viewing-key'];
// @ts-expect-error SNIP-20 balance requires an address.
const invalid: BalanceArgs = [{}, 'viewing-key'];
void [valid, invalid];

// Package-consumer inference assertions.
import type {Snip52} from '@solar-republic/contractor';
import type {SecretContract} from '../src/secret-contract.js';
import type {SecretApp} from '../src/secret-app.js';
import {query_secret_contract} from '../src/app-layer.js';
type Assert<T extends true> = T;
type Equal<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
declare const snip20: SecretContract<Snip20>;
declare const snip52: SecretContract<Snip52>;
declare const app: SecretApp<Snip20>;
const balance = query_secret_contract(snip20,'balance',{address:'secret1test'},'key');
type BalanceResult = Assert<Equal<NonNullable<Awaited<typeof balance>[0]>,ContractInterface.MsgAndAnswer<Snip20,'queries'>['balance']['response']>>;
const channels = query_secret_contract(snip52,'channel_info',{channels:['x']},['key','secret1test']);
type Channels = Assert<Equal<NonNullable<Awaited<typeof channels>[0]>,ContractInterface.MsgAndAnswer<Snip52,'queries'>['channel_info']['response']>>;
const appBalance = app.query('balance',{address:'secret1test'},'key');
type AppBalance = Assert<Equal<Awaited<typeof appBalance>[0],Awaited<typeof balance>[0]>>;
// @ts-expect-error unknown method
query_secret_contract(snip20,'not_a_method',{});
// @ts-expect-error address is required
query_secret_contract(snip20,'balance',{},'key');
// @ts-expect-error auth is required
query_secret_contract(snip20,'balance',{address:'secret1test'});
// @ts-expect-error channels must be an array
query_secret_contract(snip52,'channel_info',{channels:'x'},['key']);
// @ts-expect-error unknown method through app
app.query('not_a_method',{});
// @ts-expect-error undefined array entries cannot be contract message fields
query_secret_contract(snip52,'channel_info',{channels:[undefined]},['key']);

declare const recipient: import('@solar-republic/types').CwSecretAccAddr;
declare const amount: import('@solar-republic/types').CwUint128;
const transfer = app.exec('transfer',{recipient,amount},100n);
type TransferResult = Assert<Equal<NonNullable<Awaited<typeof transfer>[0]>,ContractInterface.MsgAndAnswer<Snip20,'executions'>['transfer']['response']>>;
// @ts-expect-error amount is required
app.exec('transfer',{recipient},100n);
// @ts-expect-error unknown execute method
app.exec('not_a_method',{},100n);

import type {JsonAny} from '@solar-republic/cosmos-grpc';
type OptionalAny = JsonAny<'/test.Message',{amount?:string|undefined}>;
const optionalAny: OptionalAny = {'@type':'/test.Message'};
