import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {join} from 'node:path';
const require = createRequire(new URL('./tools/package.json', import.meta.url));

export async function checkBrowsers(consumer) {
  const {build} = require('esbuild');
  const {WebSocketServer} = require('ws');
  const engines = require('playwright');
  const bundle = await build({stdin:{contents:`export * from ${JSON.stringify(join(consumer,'node_modules/@solar-republic/neutrino/dist/mjs/main.js'))};`,resolveDir:consumer},
    bundle:true,platform:'browser',format:'esm',target:'es2022',write:false});
  const server = createServer((request,response) => {
    if(request.url === '/bundle.js') response.writeHead(200,{'content-type':'text/javascript'}).end(bundle.outputFiles[0].contents);
    else response.writeHead(200,{'content-type':'text/html'}).end('<!doctype html><title>Neutrino browser checks</title>');
  });
  const sockets = new WebSocketServer({server});
  sockets.on('connection',(socket,request) => {
    if(request.url.startsWith('/stall')) return;
    socket.on('message',bytes => {
      const message = JSON.parse(bytes.toString());
      socket.send(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{}}));
      socket.send(JSON.stringify({result:{data:{type:'tendermint/event/Tx',value:{}},events:{key:['value']}}}));
    });
  });
  try {
    await new Promise((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const url = `http://127.0.0.1:${server.address().port}`;
    for(const name of ['chromium','firefox','webkit']) {
      const browser = await engines[name].launch({headless:true});
      try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror',error => errors.push(String(error)));
        await page.goto(url);
        const checks = await page.evaluate(async url => {
          const n = await import('/bundle.js');
          const check = (condition,message) => {if(!condition) throw Error(message);};
          const hex = bytes => Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
          const unhex = text => Uint8Array.from(text.match(/../g).map(x=>parseInt(x,16)));
          // RFC 5297 deterministic example, using the browser's WebCrypto implementation.
          const key = unhex('fffefdfcfbfaf9f8f7f6f5f4f3f2f1f0f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff');
          const plain = unhex('112233445566778899aabbccddee');
          const aad = unhex('101112131415161718191a1b1c1d1e1f2021222324252627');
          const sealed = await n.aes_128_siv_encrypt(key,plain,[aad]);
          check(hex(sealed)==='85632d07c6e8f37f950acd320a2ecc9340c02b9690c4dc04daef7f6afe5c','AES-SIV RFC vector');
          check(hex(await n.aes_128_siv_decrypt(key,sealed,[aad]))===hex(plain),'AES-SIV open');
          sealed[8]^=0x80;
          let rejected=false;try {await n.aes_128_siv_decrypt(key,sealed,[aad]);} catch {rejected=true;}
          check(rejected,'AES-SIV tamper must reject');
          check(hex(n.ripemd160(new TextEncoder().encode('abc')))==='8eb208f7e05d987a9b044a8e98c6b087f15a0bfc','RIPEMD-160 vector');
          check(hex(n.ecs_mul_base(unhex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a')))==='8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a','X25519 RFC vector');
          check(n.exec_fees('9007199254740993',1)[0][0]==='9007199254740993','exact fees');
          let received;
          const event = new Promise(resolve=>{received=resolve;});
          const socket = await n.subscribe_tendermint_events(url,"tm.event='Tx'",received,WebSocket,1000);
          const delivered = await Promise.race([event,new Promise((_,reject)=>setTimeout(()=>reject(Error('event timeout')),2000))]);
          check(JSON.parse(delivered.data).result.events.key[0]==='value','WebSocket event payload');
          socket.close();
          let timedOut=false;
          try {await n.subscribe_tendermint_events(url+'/stall',"tm.event='Tx'",()=>{},WebSocket,30);} catch(error) {timedOut=/Timed out subscribing/.test(error.message);}
          check(timedOut,'unacknowledged real WebSocket must time out');
          return 7;
        },url);
        assert.equal(checks,7);
        assert.deepEqual(errors,[]);
        console.log(`${name}: RFC crypto vectors, authenticated rejection, exact fees and real WebSocket delivery/deadline passed.`);
      }
      finally {await browser.close();}
    }
  }
  finally {
    for(const client of sockets.clients) client.terminate();
    await new Promise(resolve=>sockets.close(resolve));
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
}
