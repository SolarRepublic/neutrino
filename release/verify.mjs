// A read-only local registry exercises transitive resolution with no overrides or file links.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {digest, npm, readJson, root, run, writeJson} from './common.mjs';
import {checkBrowsers} from './browser.mjs';

const bundle = resolve(process.argv[2] || 'dist/release-candidate');
const manifest = readJson(join(bundle,'manifest.json'));
assert.equal(manifest.format,1);
for(const [file, hash] of Object.entries(manifest.files)) {
  assert(!file.includes('\\') && !file.split('/').includes('..') && !file.startsWith('/'));
  assert.equal(digest(readFileSync(join(bundle,file))),hash,`Changed bundle file: ${file}`);
}
assert.equal(manifest.validationToolsHash,digest(readFileSync(join(root,'release/tools/package-lock.json'))),'Validation tool lockfile differs from prepared candidate');
const recordLock = process.argv.includes('--record-lock');
assert(recordLock || manifest.files['consumer-lock.json'],'Run release:prepare to freeze the consumer lockfile first');
assert(!recordLock || !manifest.files['consumer-lock.json'],'An existing candidate lockfile is immutable; prepare a new bundle');
for(const item of manifest.packages) {
  assert(Object.hasOwn(manifest.files,item.filename));
  assert.equal('sha512-'+createHash('sha512').update(readFileSync(join(bundle,item.filename))).digest('base64'),item.integrity);
  assert.equal(item.name,item.package.name);
  assert.equal(item.version,item.package.version);
  assert(!item.package.overrides && !item.package.pnpm);
  for(const spec of Object.values(item.package.dependencies || {})) assert(!/^(file:|link:|workspace:)/.test(spec));
}
const temporary = mkdtempSync(join(tmpdir(),'neutrino-release-check-'));
const consumer = join(temporary,'consumer');
mkdirSync(consumer);
const emptyConfig = join(temporary,'empty.npmrc');
writeFileSync(emptyConfig,'');
const emptyGlobal = join(temporary,'global.npmrc');
writeFileSync(emptyGlobal,'');
const served = new Set();
let origin;
const server = createServer((request,response) => {
  if(request.method !== 'GET') { response.writeHead(405).end(); return; }
  let path;
  try { path = decodeURIComponent(new URL(request.url,'http://localhost').pathname); }
  catch { response.writeHead(400).end(); return; }
  const archive = manifest.packages.find(item => path === '/tarballs/'+item.filename);
  if(archive) {
    served.add(archive.name);
    response.writeHead(200,{'content-type':'application/octet-stream'}).end(readFileSync(join(bundle,archive.filename)));
    return;
  }
  const item = manifest.packages.find(item => path === '/'+item.name || path === '/'+item.name+'/'+item.version);
  if(item) {
    const version = {...item.package, dist:{integrity:item.integrity,tarball:origin+'/tarballs/'+item.filename}};
    const body = path === '/'+item.name ? {name:item.name,'dist-tags':{next:item.version},versions:{[item.version]:version}} : version;
    response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(body));
    return;
  }
  response.writeHead(302,{location:'https://registry.npmjs.org'+request.url}).end();
});
try {
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  const candidate = manifest.packages.find(item => item.name === '@solar-republic/neutrino');
  assert(candidate);
  writeJson(join(consumer,'package.json'),{private:true,type:'module',dependencies:{[candidate.name]:candidate.version},
    devDependencies:{chai:'6.3.0','chai-bites':'0.3.1','curve25519-js':'0.0.4'}});
  if(!recordLock) {
    const locked = readJson(join(bundle,'consumer-lock.json'));
    for(const pkg of Object.values(locked.packages)) {
      if(pkg.resolved?.startsWith('http://neutrino-candidate.invalid/')) pkg.resolved = pkg.resolved.replace('http://neutrino-candidate.invalid',origin);
    }
    writeJson(join(consumer,'package-lock.json'),locked);
  }
  const install = ['--userconfig',emptyConfig,'--globalconfig',emptyGlobal,'--cache',join(temporary,'cache'),
    '--registry',origin,recordLock?'install':'ci','--ignore-scripts','--no-audit','--no-fund'];
  await npm([...install,'--omit=dev'],consumer);
  assert.equal(served.size,manifest.packages.length,'Every candidate must resolve transitively');
  for(const item of manifest.packages) {
    const installed = readJson(join(consumer,'node_modules',item.name,'package.json'));
    assert.deepEqual(installed,item.package,`Installed metadata differs: ${item.name}`);
  }
  const lock = readJson(join(consumer,'package-lock.json'));
  assert.deepEqual(Object.keys(lock.packages[''].dependencies),['@solar-republic/neutrino']);
  const belt = Object.entries(lock.packages).filter(([path]) => path.endsWith('node_modules/@blake.regalia/belt'));
  assert.equal(belt.length,1,'The graph must resolve a single Belt version');
  assert.equal(belt[0][1].version,'0.58.0');
  writeFileSync(join(consumer,'smoke.mjs'), `import assert from 'node:assert/strict'; import * as n from '@solar-republic/neutrino'; assert.equal(typeof n.CosmosSigner,'function'); assert.deepEqual(n.exec_fees('9007199254740993',1),[['9007199254740993','uscrt']]);`);
  writeFileSync(join(consumer,'smoke.cjs'), `const assert=require('node:assert/strict'); const n=require('@solar-republic/neutrino'); assert.equal(typeof n.SecretContract,'function');`);
  await run(process.execPath,['smoke.mjs'],consumer);
  await run(process.execPath,['smoke.cjs'],consumer);
  writeFileSync(join(consumer,'upstream.mjs'), `
    import assert from 'node:assert/strict';
    import {to_uint64} from '@solar-republic/contractor/runtime';
    import {temporal,parse_timestamp,decode_timestamp,timestamp_to_json} from '@solar-republic/cosmos-grpc';
    import {encodeCosmosBankMsgSend,decodeCosmosBankMsgSend} from '@solar-republic/cosmos-grpc/cosmos/bank/v1beta1/tx';
    import {encodeCosmosTxModeInfo,encodeCosmosTxModeInfoSingle,encodeCosmosTxModeInfoMulti} from '@solar-republic/cosmos-grpc/cosmos/tx/v1beta1/tx';
    assert.equal(to_uint64(42),'42');
    const time=parse_timestamp('1969-12-31T23:59:59.999999999Z');
    assert.deepEqual(decode_timestamp(temporal(time)),['-1',999999999]);
    assert.equal(timestamp_to_json(time),'1969-12-31T23:59:59.999999999Z');
    assert.deepEqual(decodeCosmosBankMsgSend(encodeCosmosBankMsgSend('from','to',[['12','uscrt']])),['from','to',[['12','uscrt']]]);
    assert.throws(()=>encodeCosmosTxModeInfo(encodeCosmosTxModeInfoSingle(),encodeCosmosTxModeInfoMulti()),/ModeInfo.sum/);
  `);
  await run(process.execPath,['upstream.mjs'],consumer);
  writeFileSync(join(consumer,'app.mts'), `import type {ContractInterface} from '@solar-republic/contractor'; export type App=ContractInterface<{queries:{read:[{id:string},{value:string}]}}>;`);
  copyFileSync(join(bundle,'fixtures/inference.mts'),join(consumer,'inference.mts'));
  for(const [module,moduleResolution] of [['NodeNext','NodeNext'],['ES2022','Bundler']]) {
    writeJson(join(consumer,'tsconfig.json'),{compilerOptions:{strict:true,skipLibCheck:false,target:'ES2022',module,moduleResolution,noEmit:true},include:['*.mts']});
    for(const compiler of ['typescript59/bin/tsc','typescript/bin/tsc6','@typescript/native/bin/tsc']) {
      await run(process.execPath,[join(root,'release/tools/node_modules',compiler),'-p','tsconfig.json'],consumer);
    }
  }
  await run(process.execPath,[join(consumer,'node_modules/@solar-republic/contractor/dist/cli.js'),'rust','-i',join(consumer,'app.mts'),'-o',join(consumer,'messages.rs')],consumer);
  assert.match(readFileSync(join(consumer,'messages.rs'),'utf8'),/pub enum QueryMsg/);
  console.log('Packaged Contractor runtime/CLI and Cosmos timestamp, bank transfer and signing oneof checks passed.');
  console.log('Production-only registry install: five candidates, no overrides/file links, one Belt; ESM/CJS and TS5.9/6/7 × NodeNext/Bundler passed.');
  // Add only offline-test dependencies after the production graph and declarations have passed.
  await npm([...install,'--include=dev'],consumer);
  mkdirSync(join(consumer,'fixtures'));
  for(const file of readdirSync(join(bundle,'fixtures')).filter(file => file.endsWith('.js'))) {
    copyFileSync(join(bundle,'fixtures',file),join(consumer,'fixtures',file));
  }
  const files = readdirSync(join(consumer,'fixtures')).filter(file => file !== 'helper.js').map(file => 'fixtures/'+file);
  process.stdout.write(await run(process.execPath,['--test',...files],consumer));
  if(process.argv.includes('--browser')) await checkBrowsers(consumer);
  if(recordLock) {
    const locked = readJson(join(consumer,'package-lock.json'));
    for(const pkg of Object.values(locked.packages)) {
      if(pkg.resolved?.startsWith(origin+'/')) pkg.resolved = pkg.resolved.replace(origin,'http://neutrino-candidate.invalid');
    }
    writeJson(join(bundle,'consumer-lock.json'),locked);
    manifest.files['consumer-lock.json'] = digest(readFileSync(join(bundle,'consumer-lock.json')));
    writeJson(join(bundle,'manifest.json'),manifest);
  }
  console.log(`Release candidate checks passed on ${process.platform}/${process.arch}, Node ${process.versions.node}.`);
}
finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  rmSync(temporary,{recursive:true,force:true});
}
