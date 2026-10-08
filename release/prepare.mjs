// Stage candidates without changing checkout versions or publishing anything.
import assert from 'node:assert/strict';
import {copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fileList, validatorHashes} from './integrity.mjs';
import {digest, npm, readJson, root, run, writeJson} from './common.mjs';

const output = resolve(process.argv[2] || join(root, 'dist/release-candidate'));
// Never remove an existing artifact; each preparation gets an explicit new destination.
mkdirSync(output);
const temporary = mkdtempSync(join(tmpdir(), 'neutrino-stage-'));
const plan = readJson(join(root, 'release/plan.json'));
const manifest = {format:2, validationFiles:validatorHashes(), packages:[], files:{}};
try {
  for(const name of ['types','contractor','cosmos-grpc','neutrino']) {
    const source=resolve(root,'..',name);
    assert.equal((await run('git',['status','--porcelain','--untracked-files=normal'],source)).trim(),'',`Commit pending changes in ${name} before preparing release candidates`);
  }
  const cosmos=resolve(root,'../cosmos-grpc');
  const treeHash=directory=>digest(JSON.stringify(fileList(directory).map(file=>[file,digest(readFileSync(join(directory,file)))])));
  const cosmosInputs={protoHash:treeHash(join(cosmos,'build/proto')),
    sourceHash:treeHash(join(cosmos,'src')), scriptsHash:treeHash(join(cosmos,'scripts')),
    lockfileHash:digest(readFileSync(join(cosmos,'pnpm-lock.yaml'))),
    submodules:(await run('git',['submodule','status','--recursive'],cosmos)).trim()};
  console.log('Regenerating Cosmos default library from recorded proto inputs...');
  await run('bash',['scripts/run-plugin.sh'],cosmos);
  assert.equal(treeHash(join(cosmos,'build/proto')),cosmosInputs.protoHash,'Proto inputs changed during generation');
  for(const name of ['types', 'contractor', 'neutrino']) {
    const cwd = resolve(root, '..', name);
    if(name !== 'types') {
      console.log(`Refreshing ${name}'s local dependency snapshots...`);
      await run(process.execPath,[join(root,'release/tools/node_modules/pnpm/bin/pnpm.cjs'),'install','--force',
        '--frozen-lockfile','--ignore-scripts',...(process.env.RELEASE_PNPM_STORE ? ['--store-dir',process.env.RELEASE_PNPM_STORE] : [])],cwd,{CI:'true'});
    }
    for(const [dependency,directory] of name === 'contractor' ? [['types','dist']] : name === 'neutrino'
      ? [['types','dist'],['contractor','dist'],['cosmos-grpc','build/dist']] : []) {
      assert.equal(treeHash(join(cwd,'node_modules/@solar-republic',dependency,directory)),
        treeHash(resolve(root,'..',dependency,directory)),`Stale ${dependency} artifact in ${name}`);
    }
    rmSync(join(cwd, name === 'neutrino' ? 'dist/mjs' : 'dist'), {recursive:true, force:true});
    await run(process.execPath, ['node_modules/@typescript/native/bin/tsc', '-p', name === 'neutrino' ? 'tsconfig.mjs.json' : 'tsconfig.json', '--incremental', 'false'], cwd);
  }
  rmSync(join(root,'dist/test'), {recursive:true, force:true});
  await run(process.execPath, ['node_modules/@typescript/native/bin/tsc', '-p', 'tsconfig.json', '--outDir', 'dist/test', '--declarationDir', 'dist/test'], root);
  for(const [name, version] of Object.entries(plan.packages)) {
    const stage = join(temporary, name);
    mkdirSync(stage);
    let provenance;
    if(name === 'crypto') {
      const [base] = JSON.parse(await npm(['pack', `@solar-republic/crypto@${plan.cryptoBase.version}`, '--ignore-scripts', '--json', '--pack-destination', temporary]));
      const bytes = readFileSync(join(temporary, base.filename));
      assert.equal('sha512-'+createHash('sha512').update(bytes).digest('base64'), plan.cryptoBase.integrity);
      await run('tar', ['-xzf', join(temporary, base.filename), '--strip-components=1', '-C', stage]);
      provenance = {registryVersion:plan.cryptoBase.version, integrity:plan.cryptoBase.integrity, change:'Belt dependency metadata only; published implementation preserved'};
    }
    else {
      const source = resolve(root, '..', name);
      const [listing] = JSON.parse(await npm(['pack', '--dry-run', '--ignore-scripts', '--json'], source));
      const hashes = {};
      for(const file of listing.files) {
        assert(!file.path.split('/').includes('..') && !file.path.startsWith('/'));
        const target = join(stage, file.path);
        mkdirSync(dirname(target), {recursive:true});
        copyFileSync(join(source, file.path), target);
        hashes[file.path] = digest(readFileSync(target));
      }
      provenance = {head:(await run('git', ['rev-parse', 'HEAD'], source)).trim(),
        dirty:Boolean((await run('git', ['status', '--porcelain', '--untracked-files=normal'], source)).trim()),
        packedInputHash:digest(JSON.stringify(hashes)), ...(name === 'cosmos-grpc' ? {generation:cosmosInputs} : {})};
    }
    if(name !== 'crypto') assert.equal(provenance.dirty,false,`${name} changed while building`);
    const pkg = readJson(join(stage, 'package.json'));
    pkg.version = version;
    for(const dependency of Object.keys(pkg.dependencies || {})) {
      if(dependency === '@blake.regalia/belt') pkg.dependencies[dependency] = plan.belt;
      const sibling = dependency.replace('@solar-republic/', '');
      if(plan.packages[sibling]) pkg.dependencies[dependency] = plan.packages[sibling];
    }
    // Candidate packages contain only consumer metadata and exact coordinated dependencies.
    for(const field of ['devDependencies', 'scripts', 'pnpm', 'packageManager']) delete pkg[field];
    pkg.publishConfig = {...pkg.publishConfig, tag:'next'};
    writeJson(join(stage, 'package.json'), pkg);
    const [packed] = JSON.parse(await npm(['pack', '--ignore-scripts', '--json', '--pack-destination', output], stage));
    manifest.packages.push({name:pkg.name, version, filename:packed.filename, integrity:packed.integrity, package:pkg, provenance});
    console.log(`Prepared ${pkg.name}@${version}`);
  }
  const fixtures = join(output, 'fixtures');
  mkdirSync(fixtures);
  const names = ['aes-cmac.js','aes-siv.js','chacha20.js','poly1305.js','ripemd160.js','x25519.js','helper.js',
    ...readdirSync(join(root,'dist/test/test')).filter(name => name.endsWith('.test.js'))];
  for(const name of names) {
    const original = readFileSync(join(root,'dist/test/test',name),'utf8');
    writeFileSync(join(fixtures,name),original.replaceAll('../src/', '../node_modules/@solar-republic/neutrino/dist/mjs/'));
  }
  const inference = readFileSync(join(root,'test/types.ts'),'utf8').split('// Package-consumer inference assertions.')[1];
  assert(inference, 'Missing package inference assertions');
  writeFileSync(join(fixtures,'inference.mts'), "import type {Snip20,ContractInterface} from '@solar-republic/contractor';\n"+
    inference.replaceAll(/'\.\.\/src\/(secret-contract|secret-app|app-layer)\.js'/g,"'@solar-republic/neutrino'"));
  manifest.tests=names.filter(name=>name !== 'helper.js').map(name=>'fixtures/'+name).sort();
  for(const file of fileList(output)) manifest.files[file] = digest(readFileSync(join(output,file)));
  writeJson(join(output,'manifest.json'),manifest);
  process.stdout.write(await run(process.execPath,[join(root,'release/verify.mjs'),output,'--record-lock']));
  console.log(`Bundle: ${output}\nManifest SHA-256: ${digest(readFileSync(join(output,'manifest.json')))}`);
}
finally { rmSync(temporary,{recursive:true,force:true}); }
