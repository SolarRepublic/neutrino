import assert from 'node:assert/strict';
import {test} from 'node:test';
import {subscribe_tendermint_events} from '../src/tendermint-ws.js';

class Socket {
  static current: Socket;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: {data: string}) => void) | null = null;
  closed = false;
  sent = '';
  constructor(public url: string) { Socket.current = this; }
  send(message: string) { this.sent = message; }
  close() { this.closed = true; }
}
const connect = (timeout=100) => subscribe_tendermint_events('https://rpc.example/', "tm.event='Tx'", () => {}, Socket as unknown as typeof WebSocket, timeout);

test('subscription deadline includes acknowledgement and closes the socket', async() => {
  const pending = connect(10);
  const socket = Socket.current;
  socket.onopen!();
  assert.equal(socket.url, 'wss://rpc.example/websocket');
  await assert.rejects(pending, /Timed out subscribing/);
  assert.equal(socket.closed, true);
});

test('close, error and invalid acknowledgement reject promptly', async() => {
  for(const event of ['onclose', 'onerror', 'onmessage'] as const) {
    const pending = connect();
    const socket = Socket.current;
    if(event === 'onmessage') socket.onmessage!({data: '{"id":0,"error":{"message":"denied"}}'});
    else socket[event]!();
    await assert.rejects(pending);
    assert.equal(socket.closed, true);
  }
});

test('string and numeric IDs are accepted and confirmation cancels the timer', async() => {
  for(const id of [0, '0']) {
    const pending = connect(10);
    const socket = Socket.current;
    socket.onopen!();
    assert.equal((JSON.parse(socket.sent) as {jsonrpc: string}).jsonrpc, '2.0');
    socket.onmessage!({data: JSON.stringify({id, result: {}})!});
    assert.equal(await pending, socket);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(socket.closed, false);
  }
});

import {TendermintEventFilter} from '../src/tendermint-event-filter.js';
import {TendermintWs} from '../src/tendermint-ws.js';
import {string_matches_filter} from '../src/util.js';
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
const ack = () => { Socket.current.onopen!(); Socket.current.onmessage!({data:'{"id":0,"result":{}}'}); };
const event = () => ({data: JSON.stringify({result:{data:{type:'tendermint/event/Tx',value:{}},events:{key:['value']}}})!});

test('filters honor false restart decisions and dispose owned sockets', async() => {
  let closes = 0;
  const pending = TendermintEventFilter('https://rpc.example',undefined,() => { closes++; return false; },Socket as never);
  ack();
  const filter = await pending;
  const socket = Socket.current;
  socket.onclose!();
  await tick();
  assert.equal(closes,1);
  assert.equal(Socket.current,socket);
  filter.dispose!();
  assert.equal(socket.closed,true);
});

test('shared managed sockets dispatch in order, observe async errors and survive self-removal', async() => {
  const pending = TendermintWs('https://rpc.example',"tm.event='Tx'",() => {},true,Socket as never);
  ack();
  const managed = await pending;
  let errors = 0;
  const filter = await TendermintEventFilter('https://rpc.example',undefined,() => { errors++; return false; },managed);
  const order: number[] = [];
  const unlisten = filter.when('key',/value/g,async() => { unlisten(); await tick(); order.push(1); throw Error('listener'); });
  filter.when('key',/value/y,() => { order.push(2); });
  Socket.current.onmessage!(event());
  Socket.current.onmessage!(event());
  await new Promise(resolve => setTimeout(resolve,35));
  assert.deepEqual(order,[1,2,2]);
  assert.equal(errors,1);
  const old = Socket.current;
  old.onclose!();
  await tick();
  assert.notEqual(Socket.current,old);
  ack();
  await tick();
  Socket.current.onmessage!(event());
  await tick();
  assert.deepEqual(order,[1,2,2,2]);
  filter.dispose!();
  assert.equal(Socket.current.closed,false);
  managed.dispose!();
  assert.equal(Socket.current.closed,true);
});

test('stateful regular expression filters preserve caller state', () => {
  const regex = /value/g;
  regex.lastIndex = 3;
  assert.equal(string_matches_filter('value',regex),true);
  assert.equal(string_matches_filter('value',regex),true);
  assert.equal(regex.lastIndex,3);
});

test('aborted subscription closes during acknowledgement wait', async() => {
  const abort = new AbortController();
  const pending = subscribe_tendermint_events('https://rpc.example',"tm.event='Tx'",() => {},Socket as never,100,abort.signal);
  Socket.current.onopen!();
  abort.abort();
  await assert.rejects(pending,/aborted/);
  assert.equal(Socket.current.closed,true);
});

test('disposing during reconnect cancels the pending socket', async() => {
  const pending = TendermintWs('https://rpc.example',"tm.event='Tx'",() => {},true,Socket as never);
  ack();
  const managed = await pending;
  Socket.current.onclose!();
  await tick();
  managed.dispose!();
  await tick();
  assert.equal(Socket.current.closed,true);
});
