import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {safePath, fileList, validateBundle, validatorHashes} from './integrity.mjs';
import {download} from './download.mjs';
import {root,writeJson,run} from './common.mjs';

test('candidate verification rejects changed tarballs before opening a registry or installing',()=>{
  const directory=mkdtempSync(join(tmpdir(),'neutrino-integrity-'));
  try {
    writeFileSync(join(directory,'candidate.tgz'),'tampered');
    writeJson(join(directory,'manifest.json'),{format:2,packages:[],files:{'candidate.tgz':'0'.repeat(64)}});
    const result=spawnSync(process.execPath,[join(root,'release/verify.mjs'),directory],{encoding:'utf8'});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/Changed bundle file: candidate.tgz/);
  }
  finally {rmSync(directory,{recursive:true,force:true});}
});

test('candidate verification rejects paths outside the bundle',()=>{
  const directory=mkdtempSync(join(tmpdir(),'neutrino-integrity-'));
  try {
    writeJson(join(directory,'manifest.json'),{format:2,packages:[],files:{'../outside.tgz':'0'.repeat(64)}});
    const result=spawnSync(process.execPath,[join(root,'release/verify.mjs'),directory],{encoding:'utf8'});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/AssertionError/);
    assert.doesNotMatch(result.stderr,/ENOENT/);
  }
  finally {rmSync(directory,{recursive:true,force:true});}
});


test('portable paths reject traversal, absolute paths, Windows device names and aliases',()=>{
  for(const path of ['../x','/tmp/x','C:/x','fixtures\\x','fixtures/../x','fixtures//x','fixtures/x.','fixtures/CON.js']) assert.throws(()=>safePath(path));
  assert.equal(safePath('fixtures/client.test.js'),'fixtures/client.test.js');
});

test('unlisted fixtures cannot bypass bundle integrity',()=>{
  const directory=mkdtempSync(join(tmpdir(),'neutrino-unsigned-'));
  try {
    const manifest={format:2,files:{},validationFiles:validatorHashes(),packages:[]};
    writeJson(join(directory,'manifest.json'),manifest);
    writeFileSync(join(directory,'unlisted.js'),'throw Error("untrusted");');
    assert.throws(()=>validateBundle(directory,manifest),/Unlisted or missing bundle files/);
    assert.deepEqual(fileList(directory),['manifest.json','unlisted.js']);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('artifact downloads reject HTTPS downgrade and oversized streamed bodies',async()=>{
  let calls=0;
  await assert.rejects(download('https://example.invalid/a',100,async()=>{
    calls++;return new Response(null,{status:302,headers:{location:'http://example.invalid/b'}});
  }),/HTTPS/);
  assert.equal(calls,1);
  await assert.rejects(download('https://example.invalid/a',2,async()=>new Response('123')),/size limit/);
});


test('successful subprocess warnings do not contaminate machine-readable stdout',async()=>{
  const output=await run(process.execPath,['-e',`process.stderr.write('warning\\n');process.stdout.write('{"ok":true}')`]);
  assert.deepEqual(JSON.parse(output),{ok:true});
});
