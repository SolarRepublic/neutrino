import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createCipheriv, createHash, createHmac} from 'node:crypto';
import {decode_snip52_data, snip52_bloom_params} from '../src/snip-52-codec.js';
import {subscribe_snip52_channels} from '../src/snip-52.js';

const seed = Buffer.alloc(32, 7);
const hash = 'AB'.repeat(32);
const id = (channel: string, salt: string) => createHmac('sha256', seed).update(channel+':'+salt).digest();
const fixture = async(channels: unknown[], callbacks: Record<string, Function>) => {
  let receive!: Function;
  let removed = 0;
  const filter = {ws: () => ({}), when: (_key: string, _address: string, listener: Function) => {
    receive = listener;
    return () => { removed++; };
  }};
  const contract = {addr: 'secret1test', query: async() => [0, '', new Response(), {channel_info: {seed: seed.toString('base64'), channels}}]};
  const stop = await subscribe_snip52_channels(filter as never, contract as never, ['key'] as never, callbacks as never);
  return {stop, removed: () => removed, emit: (events: Record<string, string[]>, txhash=hash) => receive({value: {TxResult: {height: '12'}}}, {'tx.hash': [txhash], ...events}) as Promise<void>};
};
const encrypted = (channel: string, salt: Buffer, value: number, txhash=hash) => {
  const nonce = createHash('sha256').update(channel).digest().subarray(0, 12).map((v, i) => v ^ salt[i]);
  const cipher = createCipheriv('chacha20-poly1305', seed, nonce, {authTagLength: 16});
  cipher.setAAD(Buffer.from('12:'+txhash), {plaintextLength:1});
  const ciphertext = Buffer.concat([cipher.update(Buffer.from([value])), cipher.final()]);
  return Buffer.concat([ciphertext, cipher.getAuthTag()]).toString('base64');
};
const counterEvent = (counter: number, value: number, txhash=hash) => {
  const salt = Buffer.alloc(12);
  salt.writeBigUInt64BE(BigInt(counter), 4);
  return {['wasm.snip52:'+id('balance', String(counter)).toString('base64')]: [encrypted('balance', salt, value, txhash)]};
};

test('SNIP-52 decodes dimensions and nested structs with strict bounds', () => {
  assert.deepEqual(decode_snip52_data(Uint8Array.of(1,2,3,4), {type: 'uint8[2][2]'} as never), [[[1n,2n],[3n,4n]],4]);
  assert.deepEqual(decode_snip52_data(Uint8Array.of(1,2), {type: 'struct', members: [{type: 'uint16'}]} as never), [[258n],2]);
  for(const schema of [{type:'uint7'}, {type:'uint256'}, {type:'bytes3'}, {type:'uint8[999999999]'}, {type:'struct'}, {type:'wat'}]) {
    assert.throws(() => decode_snip52_data(Uint8Array.of(1,2), schema as never));
  }
  const recursive: {type: string; members: unknown[]} = {type:'struct',members:[]};
  recursive.members.push(recursive);
  assert.throws(() => decode_snip52_data(new Uint8Array(), recursive as never), /limit/);
});

test('counter mode interoperates with Node crypto, drains same-tx IDs, serializes bursts and ignores replay', async() => {
  const seen: number[] = [];
  const f = await fixture([{channel:'balance',mode:'counter',counter:'1',next_id:id('balance','1').toString('base64')}], {
    balance: async(value: number) => { await new Promise(resolve => setTimeout(resolve, 2)); seen.push(value); if(value === 1) throw Error('app failure'); },
  });
  const first = {...counterEvent(1,1), ...counterEvent(2,2)};
  const otherHash = 'CD'.repeat(32);
  await Promise.all([f.emit(first), f.emit(counterEvent(3,3,otherHash),otherHash), f.emit(first)]);
  assert.deepEqual(seen,[1,2,3]);
  f.stop(); f.stop();
  assert.equal(f.removed(),1);
  await f.emit(counterEvent(4,4));
  assert.deepEqual(seen,[1,2,3]);
});

test('txhash mode authenticates and recovers after malformed input', async() => {
  const seen: number[] = [];
  const f = await fixture([{channel:'updates',mode:'txhash'}], {updates:(v:number,tx:{height:string},events:Record<string,string[]>) => { assert.equal(tx.height,'12'); assert.equal(events['tx.hash'][0],hash); seen.push(v); }});
  const key = 'wasm.snip52:'+id('updates',hash).toString('base64');
  await assert.rejects(f.emit({[key]:['AA==']}), /Truncated/);
  await f.emit({[key]:[encrypted('updates',Buffer.from(hash,'hex').subarray(0,12),7)]});
  await f.emit({[key]:[encrypted('updates',Buffer.from(hash,'hex').subarray(0,12),7)]});
  assert.deepEqual(seen,[7]);
  f.stop();
});

test('bloom modes use leftmost digest bits for SHA-256 and SHA-512', async() => {
  for(const algorithm of ['sha256','sha512']) {
    const notification = id('public',hash);
    const digest = createHash(algorithm).update(notification).digest();
    // m=256, k=2: each index is exactly one of the first two digest bytes.
    const filter = (1n << BigInt(digest[0])) | (1n << BigInt(digest[1]));
    const bytes = Buffer.from(filter.toString(16).padStart(64,'0'),'hex');
    const seen: unknown[] = [];
    const f = await fixture([{channel:'public',mode:'bloom',parameters:{m:256,k:2,h:algorithm},data:{type:'uint8[2]'}}], {public:(v:unknown) => seen.push(v)});
    await f.emit({'wasm.snip52:#public':[Buffer.concat([bytes,Buffer.from([5,9])]).toString('base64')]});
    assert.deepEqual(seen,[[5n,9n]]);
    f.stop();
  }
  for(const params of [[256,33,'sha256'],[255,2,'sha512'],[256,0,'sha256'],[256,1,'md5']] as const) assert.throws(() => snip52_bloom_params(params[0],params[1],params[2]));
});

test('bloom packets validate lengths and decode the matching packet', async() => {
  const notification = id('packets',hash);
  const seen: unknown[] = [];
  const f = await fixture([{channel:'packets',mode:'bloom',parameters:{m:8,k:1,h:'sha256'},data:{type:'packet[1]',packet_size:2,data:{type:'uint16'}}}], {packets:(v:unknown) => seen.push(v)});
  const payload = Buffer.concat([Buffer.from([255]),notification.subarray(0,8),Buffer.from([notification[8]^1,notification[9]^2])]);
  await assert.rejects(f.emit({'wasm.snip52:#packets':[payload.subarray(0,-1).toString('base64')]}), /packet length/);
  await f.emit({'wasm.snip52:#packets':[payload.toString('base64')]});
  assert.deepEqual(seen,[258n]);
  f.stop();
});

import {decode_snip52_cbor} from '../src/snip-52-codec.js';
test('CBOR parser bounds allocation and nesting, honors sliced buffers and uint64 precision', () => {
  assert.equal(decode_snip52_cbor(Uint8Array.of(0,0x19,1,2,0).subarray(1)),258);
  assert.equal(decode_snip52_cbor(Buffer.from('1bffffffffffffffff','hex')),18446744073709551615n);
  assert.equal(decode_snip52_cbor(Buffer.from('f93e00','hex')),1.5);
  assert.deepEqual(decode_snip52_cbor(Buffer.from('a1616101','hex')),new Map([['a',1]]));
  for(const malformed of ['9affffffff','430102','8181818181818181818181818181818181818181818181818181818181818181818181818100','d86401','1bff','63ff0000']) assert.throws(() => decode_snip52_cbor(Buffer.from(malformed,'hex')));
});
