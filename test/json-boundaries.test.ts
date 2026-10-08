import assert from 'node:assert/strict';
import {test} from 'node:test';
import {to_wire_json} from '../src/json.js';
import {sign_amino} from '../src/cosmos-signer.js';
import {format_secret_query, query_secret_contract} from '../src/app-layer.js';

test('JSON boundary omits object fields without changing arrays or source objects',()=> {
  const shared=Object.freeze({z:1,omitted:undefined});
  const input=Object.freeze({omit:undefined,nested:shared,list:[shared],nullable:null});
  assert.equal(JSON.stringify(to_wire_json(input)), '{"nested":{"z":1},"list":[{"z":1}],"nullable":null}');
  assert(Object.hasOwn(shared,'omitted'));
  const proto=to_wire_json(JSON.parse('{"__proto__":{"safe":true}}'));
  assert.equal(JSON.stringify(proto),'{"__proto__":{"safe":true}}');
  assert.equal(JSON.stringify(to_wire_json(JSON.parse('{"z":0,"constructor":{"z":2,"a":1},"a":0}'),true)), '{"a":0,"constructor":{"a":1,"z":2},"z":0}');
  for(const invalid of [[undefined],Array(1),NaN,Infinity,1n,()=>1,new Date()]) assert.throws(()=>to_wire_json(invalid));
  const cycle: Record<string,unknown>={};cycle['self']=cycle;
  assert.throws(()=>to_wire_json(cycle),/Cyclic/);
});

test('Amino signing bytes preserve canonical ordering, escapes and omitted optional fields',async()=> {
  let bytes: Uint8Array|undefined;
  const wallet={ref:'secret-test',sign:async(input:Uint8Array)=> {bytes=input;return [new Uint8Array(64)];}};
  const [_,doc]=await sign_amino(wallet as never,[{type:'test',value:{z:undefined,b:[{omit:undefined,z:1,a:2}],a:'&<>'}}],[],'0',['0','0']);
  assert.equal(new TextDecoder().decode(bytes),String.raw`{"account_number":"0","chain_id":"secret-test","fee":{"amount":[],"gas":"0"},"memo":"","msgs":[{"type":"test","value":{"a":"\u0026\u003c\u003e","b":[{"a":2,"z":1}]}}],"sequence":"0"}`);
  assert(!Object.hasOwn(doc.fee,'granter'));assert(!Object.hasOwn(doc.fee,'payer'));
  let signed=false;
  const refusingWallet={...wallet,sign:async()=>{signed=true;return [new Uint8Array(64)];}};
  await assert.rejects(sign_amino(refusingWallet as never,[{type:'test',value:{items:[undefined]}}] as never,[],'0',['0','0']),/JSON value/);
  assert.equal(signed,false);
});

test('contract queries validate envelopes and support unambiguous renamed answers',async()=> {
  const contract=(answer:unknown)=>({query:async()=>[0,'',new Response(),answer]});
  assert.deepEqual((await query_secret_contract(contract({renamed:{ok:true}}) as never,'read',{}))[0],{ok:true});
  for(const answer of [undefined,null,[],5,{}, {a:{},b:{}},{read:null},{read:[]}]) {
    await assert.rejects(query_secret_contract(contract(answer) as never,'read',{}),/JSON object|response key/);
  }
  const failed={query:async()=>[7,'failed',new Response()]};
  const result=await query_secret_contract(failed as never,'read',{});
  assert.equal(result[0],undefined);assert.equal(result[1],7);
  assert.deepEqual(format_secret_query('read',{},['key']),{read:{viewer:{viewing_key:'key'}}});
});
