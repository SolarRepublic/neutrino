// Stage candidates without changing checkout versions or publishing anything.
import assert from 'node:assert/strict';
import {copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {digest, npm, readJson, root, run, writeJson} from './common.mjs';

const output = resolve(process.argv[2] || join(root, 'dist/release-candidate'));
// Never remove an existing artifact; each preparation gets an explicit new destination.
mkdirSync(output);
const temporary = mkdtempSync(join(tmpdir(), 'neutrino-stage-'));
const plan = readJson(join(root, 'release/plan.json'));
const manifest = {format:1, validationToolsHash:digest(readFileSync(join(root,'release/tools/package-lock.json'))), packages:[], files:{}};
try {
  for(const name of ['types', 'contractor', 'neutrino']) {
    const cwd = resolve(root, '..', name);
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
        packedInputHash:digest(JSON.stringify(hashes))};
    }
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
  for(const file of readdirSync(output, {recursive:true}).sort()) {
    if(file.endsWith('.tgz') || file.startsWith('fixtures/')) manifest.files[file] = digest(readFileSync(join(output,file)));
  }
  writeJson(join(output,'manifest.json'),manifest);
  process.stdout.write(await run(process.execPath,[join(root,'release/verify.mjs'),output,'--record-lock']));
  console.log(`Bundle: ${output}\nManifest SHA-256: ${digest(readFileSync(join(output,'manifest.json')))}`);
}
finally { rmSync(temporary,{recursive:true,force:true}); }
