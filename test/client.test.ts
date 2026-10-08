import assert from 'node:assert/strict';
import {test} from 'node:test';
import {exec_fees, create_tx_body} from '../src/cosmos-signer.js';
import {SecretWasm} from '../src/secret-wasm.js';
import {SecretContract} from '../src/secret-contract.js';
import {secret_response_parse} from '../src/secret-response.js';
import {expect_tx, broadcast_result} from '../src/app-layer.js';
import {GC_NEUTRINO} from '../src/config.js';
import {decodeCosmosTxAuthInfo} from '@solar-republic/cosmos-grpc/cosmos/tx/v1beta1/tx';
import {CosmosClientLcdDirect} from '@solar-republic/cosmos-grpc';
import {ecs_mul_base} from '../src/x25519.js';

const json = (body: unknown) => new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}});

test('fees preserve large integer limits and decimal prices and reject invalid input', () => {
  assert.deepEqual(exec_fees('9007199254740993', 1), [['9007199254740993', 'uscrt']]);
  assert.deepEqual(exec_fees(100n, 0.07), [['7', 'uscrt']]);
  assert.deepEqual(exec_fees(1n, 1e-8), [['1', 'uscrt']]);
  assert.deepEqual(exec_fees(10n, 1e21), [['10000000000000000000000', 'uscrt']]);
  for(const price of [-1, NaN, Infinity]) assert.throws(() => exec_fees(1n, price));
  assert.throws(() => exec_fees(-1n, 1));
  assert.throws(() => exec_fees(Number.MAX_SAFE_INTEGER+1, 1));
});

test('explicit fees take precedence over wallet defaults', async() => {
  const wallet = {lcd: {} as never, addr: 'secret1sender' as never, pk33: new Uint8Array(33), fees: () => [['99', 'uscrt']] as never};
  for(const [fees, expected] of [[0, '0'], [0.25, '25'], [[['5', 'uscrt']], '5'], [undefined, '99']] as const) {
    const [auth] = await create_tx_body(1, wallet, [], 100n, fees as never, ['0', '0']);
    assert.equal(decodeCosmosTxAuthInfo(auth)[1]?.[0]?.[0]?.[0], expected);
  }
});

test('SecretWasm rejects low-order consensus keys and malformed nonces', async() => {
  assert.throws(() => SecretWasm(new Uint8Array(32)), /consensus public key/);
  const wasm = SecretWasm(ecs_mul_base(new Uint8Array(32).fill(7)));
  await assert.rejects(wasm.txKey(new Uint8Array(31)), /nonce length/);
});

test('contract and code caches are scoped to LCD endpoints', async() => {
  const address = 'secret1same' as never;
  const key = Buffer.from(ecs_mul_base(new Uint8Array(32).fill(8))).toString('base64');
  const client = (id: string, hash: string) => CosmosClientLcdDirect(id as never, async request => {
    const path = String(request);
    if(path.includes('registration')) return json({key});
    if(path.includes('code_hash')) return json({code_hash: hash});
    return json({contract_address: address, contract_info: {code_id: '1', label: id}});
  });
  const a = await SecretContract(client('https://a.example', 'aa'.repeat(32)), address);
  const clientB = client('https://b.example', 'bb'.repeat(32));
  delete clientB.id;
  const b = await SecretContract(clientB, address);
  const clientC = client('https://c.example', 'cc'.repeat(32));
  delete clientC.id;
  const c = await SecretContract(clientC, address);
  assert.notEqual(b.hash, c.hash);
  assert.notEqual(a.hash, b.hash);
  assert.notEqual(a.info.label, b.info.label);
});

test('empty response data produces an empty result list', async() => {
  assert.deepEqual(await secret_response_parse(undefined, {} as never), []);
  assert.deepEqual(await secret_response_parse(new Uint8Array(), {} as never), []);
});

test('completed transaction monitor stops its polling and listener', async() => {
  const original = GC_NEUTRINO.WS_TIMEOUT;
  GC_NEUTRINO.WS_TIMEOUT = 5;
  let unlistened = 0, polled = 0;
  const stream = {ws: () => ({}), when: (_key: unknown, _filter: unknown, listener: Function) => {
    setTimeout(() => listener({value: {TxResult: {height: '1', result: {code: 0}}}}, {}), 1);
    return () => { unlistened++; };
  }};
  try {
    const node = {lcd: CosmosClientLcdDirect('https://tx.example', async() => { polled++; return json({}); }), rpc: {origin: 'https://rpc.example'}};
    const result = await expect_tx(node as never, 'ABC', stream as never);
    assert.equal(result[0], 0);
    await new Promise(resolve => setTimeout(resolve, 35));
    assert.equal(unlistened, 1);
    assert.equal(polled, 0);
  }
  finally { GC_NEUTRINO.WS_TIMEOUT = original; }
});

test('broadcast exceptions tear down monitoring', async() => {
  let unlistened = 0;
  const stream = {ws: () => ({}), when: () => () => { unlistened++; }};
  const node = {lcd: CosmosClientLcdDirect('https://broadcast.example', async() => { throw Error('offline'); }), rpc: {origin: 'https://rpc.example'}};
  await assert.rejects(broadcast_result(node as never, new Uint8Array(), 'ABC', stream as never, 5, 5), /offline/);
  assert.equal(unlistened, 1);
});

test('local cosmos-grpc retains exact temporal values and enforces signing oneofs', async() => {
  const {temporal, decode_timestamp} = await import('@solar-republic/cosmos-grpc');
  const {encodeCosmosTxModeInfo, encodeCosmosTxModeInfoSingle, encodeCosmosTxModeInfoMulti} = await import('@solar-republic/cosmos-grpc/cosmos/tx/v1beta1/tx');
  assert.deepEqual(decode_timestamp(temporal(['-1', 999999999])!), ['-1', 999999999]);
  assert.throws(() => (encodeCosmosTxModeInfo as Function)(encodeCosmosTxModeInfoSingle(), encodeCosmosTxModeInfoMulti()), /ModeInfo.sum/);
});

test('upgraded crypto/WASM signer produces a signature accepted by Node/OpenSSL', async() => {
  const {CosmosSigner, sign_amino} = await import('../src/cosmos-signer.js');
  const {ECDH, createPublicKey, verify} = await import('node:crypto');
  const key = new Uint8Array(32);
  key[31] = 1; // Publicly known test vector, never used on a network.
  const wallet = await CosmosSigner(key, 'secret-test', 'https://lcd.example', 'https://rpc.example');
  assert.equal(Buffer.from(wallet.pk33).toString('hex'), '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
  const point = ECDH.convertKey(wallet.pk33, 'secp256k1', undefined, undefined, 'uncompressed');
  assert.ok(typeof point !== 'string');
  const publicKey = createPublicKey({key: Buffer.concat([
    Buffer.from('3056301006072a8648ce3d020106052b8104000a034200', 'hex'),
    point,
  ]), format: 'der', type: 'spki'});
  const message = new TextEncoder().encode('neutrino migration');
  const [signature] = await wallet.sign(message);
  assert.equal(verify('sha256', message, {key: publicKey, dsaEncoding: 'ieee-p1363'}, signature), true);
  const [aminoSignature, doc] = await sign_amino(wallet, [], [['1', 'uscrt']], '100', ['0', '0'], '&<>');
  const serialized = JSON.stringify(doc)!.replace(/&/g, '\\u0026').replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  assert.equal(verify('sha256', Buffer.from(serialized), {key: publicKey, dsaEncoding: 'ieee-p1363'}, aminoSignature), true);
});

test('signers own key buffers and disposal cancels in-flight and future signing', async() => {
  const {CosmosSigner} = await import('../src/cosmos-signer.js');
  const key = new Uint8Array(32); key[31] = 1;
  const pending = CosmosSigner(key, 'secret-test', 'https://lcd.example', 'https://rpc.example');
  key.fill(0);
  const signer = await pending;
  assert.equal(Buffer.from(signer.pk33).toString('hex'), '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
  signer.pk33.fill(0);
  assert.equal(signer.pk33[0], 2);
  assert.equal((await signer.sign(new Uint8Array([1])))[0].length, 64);
  const signing = signer.sign(new Uint8Array([1]));
  signer.dispose(); signer.dispose();
  await assert.rejects(signing, /disposed/);
  await assert.rejects(signer.sign(new Uint8Array([1])), /disposed/);
  await assert.rejects(CosmosSigner(key, 'secret-test', 'https://lcd.example', 'https://rpc.example'), /private key/);
  await assert.rejects(CosmosSigner(new Uint8Array(31), 'secret-test', 'https://lcd.example', 'https://rpc.example'), /32 bytes/);
});

test('auth unwraps account variants and rejects absent or mismatched auth data', async() => {
  const {auth} = await import('../src/cosmos-signer.js');
  const base = {address:'secret1sender',account_number:'12',sequence:'34'};
  const account = async(value:unknown) => auth({addr:'secret1sender' as never,lcd:CosmosClientLcdDirect('https://auth.example',async() => json({account:value}))});
  for(const value of [
    {'@type':'/cosmos.auth.v1beta1.BaseAccount',...base},
    {'@type':'/cosmos.auth.v1beta1.ModuleAccount',base_account:base},
    {'@type':'/cosmos.vesting.v1beta1.ContinuousVestingAccount',base_vesting_account:{base_account:base}},
    {'@type':'/ethermint.types.v1.EthAccount',base_account:base},
  ]) assert.deepEqual(await account(value), ['12','34']);
  await assert.rejects(account({'@type':'/cosmos.auth.v1beta1.BaseAccount',...base,address:'secret1wrong'}), /address/);
  await assert.rejects(account({'@type':'/custom.Account',...base}), /Unsupported/);
  await assert.rejects(account({'@type':'/cosmos.auth.v1beta1.BaseAccount',address:base.address}), /account number/);
  await assert.rejects(auth({} as never,['0',undefined]), /account number/);
});

test('diagnostics expose only opt-in metadata and cannot interrupt requests', async() => {
  const {query_secret_contract} = await import('../src/app-layer.js');
  const {set_neutrino_diagnostics} = await import('../src/diagnostics.js');
  const events: unknown[] = [];
  const stop = set_neutrino_diagnostics(async event => { events.push(event); throw Error('diagnostics offline'); });
  const contract = {addr:'secret1sensitive',query:async() => [0,'',new Response(),{balance:{secret:'private response'}}]};
  const result = await query_secret_contract(contract as never, 'balance', {secret:'private args'}, ['viewing key'] as never);
  assert.deepEqual(result[0],{secret:'private response'});
  assert.deepEqual(events,[{operation:'query',stage:'start'},{operation:'query',stage:'complete',code:0}]);
  stop();
  await query_secret_contract(contract as never,'balance',{});
  assert.equal(events.length,2);
});

test('total deadline aborts stalled broadcast and tears down monitoring', async() => {
  const {TxWaitError} = await import('../src/app-layer.js');
  let removed = 0;
  let signal: AbortSignal | null | undefined;
  const stream = {ws: () => ({}),when: () => () => { removed++; }};
  const node = {lcd:CosmosClientLcdDirect('https://stalled.example',async(_req,init) => {
    signal = init?.signal;
    return new Promise<Response>(() => {}); // Deliberately ignores cancellation.
  }),rpc:{origin:'https://rpc.example'}};
  await assert.rejects(broadcast_result(node as never,new Uint8Array(),'ABC',stream as never,100,100,{timeoutMs:15}), error => error instanceof TxWaitError && error.inclusion === 'unknown' && error.reason === 'timeout' && error.txhash === 'ABC');
  assert.equal(removed,1);
  assert.equal(signal?.aborted,true);
});

test('transaction waits observe cancellation before and during monitoring', async() => {
  const {TxWaitError} = await import('../src/app-layer.js');
  let subscribed = 0, removed = 0;
  const stream = {ws: () => ({}),when: () => { subscribed++; return () => { removed++; }; }};
  const node = {lcd:CosmosClientLcdDirect('https://cancel.example',async() => json({})),rpc:{origin:'https://rpc.example'}};
  const before = new AbortController(); before.abort();
  await assert.rejects(expect_tx(node as never,'ABC',stream as never,{signal:before.signal}), error => error instanceof TxWaitError && error.reason === 'aborted');
  assert.equal(subscribed,0);
  const during = new AbortController();
  const pending = expect_tx(node as never,'ABC',stream as never,{signal:during.signal});
  during.abort();
  await assert.rejects(pending, error => error instanceof TxWaitError && error.reason === 'aborted');
  assert.equal(removed,1);
});

test('inclusion wins over a stalled broadcast response', async() => {
  const stream = {ws: () => ({}),when: (_key: unknown,_filter: unknown,listener:Function) => {
    setTimeout(() => listener({value:{TxResult:{height:'1',result:{code:0}}}},{}),5);
    return () => {};
  }};
  const node = {lcd:CosmosClientLcdDirect('https://slow-broadcast.example',async() => new Promise<Response>(() => {})),rpc:{origin:'https://rpc.example'}};
  assert.equal((await broadcast_result(node as never,new Uint8Array(),'ABC',stream as never,100,100,{timeoutMs:50}))[0],0);
});

test('transient polling failures recover without re-broadcasting', async() => {
  let polls = 0, broadcasts = 0;
  const stream = {ws:() => ({}),when:() => () => {}};
  const node = {lcd:CosmosClientLcdDirect('https://retry.example',async(_req,init) => {
    if(init?.method === 'POST') { broadcasts++; return json({tx_response:{code:0}}); }
    polls++;
    if(polls === 1) return new Response('unavailable',{status:503});
    return json({tx_response:{code:0,height:'1',txhash:'ABC'}});
  }),rpc:{origin:'https://rpc.example'}};
  assert.equal((await broadcast_result(node as never,new Uint8Array(),'ABC',stream as never,1,1,{timeoutMs:100}))[0],0);
  assert.equal(polls,2);
  assert.equal(broadcasts,1);
});
