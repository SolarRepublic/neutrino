// Test packed local dependencies in a clean production installation, without workspace symlinks.
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'neutrino-package-'));
const run = (command, args, cwd=root) => {
  const result = spawnSync(command, args, {cwd, encoding: 'utf8', timeout:180000});
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  return result.stdout;
};
try {
  const [pack] = JSON.parse(run('npm', ['--cache=' + join(temporary, 'cache'), 'pack', '--ignore-scripts', '--json', '--pack-destination=' + temporary]));
  assert(pack.files.some(file => file.path === 'dist/mjs/main.d.ts'));
  assert(!pack.files.some(file => file.path.startsWith('dist/cjs/')));
  const dependencies = {'@solar-republic/neutrino':'file:'+join(temporary,pack.filename)};
  const overrides = {'@solar-republic/crypto':{'@blake.regalia/belt':'^0.58.0'}};
  for(const name of ['types','contractor','cosmos-grpc']) {
    const [dependencyPack] = JSON.parse(run('npm',['--cache='+join(temporary,'cache'),'pack','--ignore-scripts','--json','--pack-destination='+temporary],join(root,'..',name)));
    const packageName='@solar-republic/'+name;
    dependencies[packageName]='file:'+join(temporary,dependencyPack.filename);
    overrides[packageName]='$'+packageName;
  }
  overrides['@solar-republic/cosmos-grpc']={'.':'$@solar-republic/cosmos-grpc','@blake.regalia/belt':'^0.58.0'};
  const consumer = join(temporary, 'consumer');
  mkdirSync(consumer);
  writeFileSync(join(consumer,'package.json'),JSON.stringify({private:true,type:'module',dependencies,overrides}));
  run('npm',['--cache='+join(temporary,'cache'),'install','--omit=dev','--ignore-scripts','--package-lock=false','--no-audit','--no-fund'],consumer);
  const exercise = `
    assert.equal(typeof neutrino.CosmosSigner, 'function');
    assert.equal(typeof neutrino.SecretContract, 'function');
    assert.deepEqual(neutrino.exec_fees('9007199254740993', 1), [['9007199254740993', 'uscrt']]);
  `;
  writeFileSync(join(consumer, 'smoke.mjs'), `import assert from 'node:assert/strict'; import * as neutrino from '@solar-republic/neutrino'; ${exercise}`);
  writeFileSync(join(consumer, 'smoke.cjs'), `const assert = require('node:assert/strict'); const neutrino = require('@solar-republic/neutrino'); ${exercise}`);
  run(process.execPath, ['smoke.mjs'], consumer);
  run(process.execPath, ['smoke.cjs'], consumer);
  writeFileSync(join(consumer, 'types.mts'), `
    import {exec_fees, type CosmosSigner, type SecretContract, type TxResponseTuple} from '@solar-republic/neutrino';
    const fees: ReturnType<typeof exec_fees> = exec_fees(100n, 0.25);
    const check = (wallet: CosmosSigner, contract: SecretContract, response: TxResponseTuple) => [wallet.addr, contract.hash, response[0], fees];
    void check;
  `);
  const inference=readFileSync(join(root,'test/types.ts'),'utf8').split("// Package-consumer inference assertions.")[1];
  writeFileSync(join(consumer,'inference.mts'),"import type {Snip20,ContractInterface} from '@solar-republic/contractor';\n"+inference.replaceAll("'../src/secret-contract.js'","'@solar-republic/neutrino'").replaceAll("'../src/secret-app.js'","'@solar-republic/neutrino'").replaceAll("'../src/app-layer.js'","'@solar-republic/neutrino'"));
  for(const [module,moduleResolution] of [['NodeNext','NodeNext'],['ES2022','Bundler']]) {
    writeFileSync(join(consumer,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,skipLibCheck:false,target:'ES2022',module,moduleResolution,noEmit:true},include:['*.mts']}));
    for(const compiler of ['node_modules/typescript59/bin/tsc','node_modules/typescript/bin/tsc6','node_modules/@typescript/native/bin/tsc']) {
      run(process.execPath,[join(root,compiler),'-p','tsconfig.json'],consumer);
    }
  }
  console.log('Coordinated clean tarballs: ESM, require(esm), TS5.9/6/7 NodeNext/Bundler, full declaration checking and contract inference passed.');
}
finally { rmSync(temporary, {recursive: true, force: true}); }
