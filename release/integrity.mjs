import assert from 'node:assert/strict';
import {lstatSync, readFileSync, readdirSync} from 'node:fs';
import {join, posix} from 'node:path';
import {digest, root} from './common.mjs';

export const validationFiles = ['release/common.mjs','release/integrity.mjs','release/verify.mjs',
  'release/browser.mjs','release/plan.json','release/tools/package-lock.json'];
export function safePath(file) {
  assert(typeof file === 'string' && /^[a-zA-Z0-9_./-]+$/.test(file), 'Invalid bundle path');
  assert(file !== '.' && !file.startsWith('/') && posix.normalize(file) === file &&
    !file.split('/').some(part => part === '..' || part === '.' || !part), 'Invalid bundle path');
  // Windows device names and trailing dots are not portable file names.
  assert(!file.split('/').some(part => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part) || part.endsWith('.')), 'Invalid bundle path');
  return file;
}
export function fileList(directory) {
  const files=[];
  const visit=(prefix='') => {
    for(const entry of readdirSync(join(directory,prefix),{withFileTypes:true})) {
      const file=prefix ? prefix+'/'+entry.name : entry.name;
      safePath(file);
      assert(!entry.isSymbolicLink(),`Symlinks are not allowed: ${file}`);
      if(entry.isDirectory()) visit(file);
      else {assert(entry.isFile(),`Not a regular file: ${file}`); files.push(file);}
    }
  };
  visit();return files.sort();
}
export function validatorHashes() {
  return Object.fromEntries(validationFiles.map(file=>[file,digest(readFileSync(join(root,file)))]));
}
export function validateBundle(directory,manifest,{recordLock=false}={}) {
  assert.equal(manifest.format,2);
  assert(manifest.files && typeof manifest.files === 'object');
  for(const [file,hash] of Object.entries(manifest.files)) {
    safePath(file);assert.match(hash,/^[a-f0-9]{64}$/);
    assert(lstatSync(join(directory,file)).isFile(),`Not a regular bundle file: ${file}`);
    assert.equal(digest(readFileSync(join(directory,file))),hash,`Changed bundle file: ${file}`);
  }
  assert.deepEqual(fileList(directory),['manifest.json',...Object.keys(manifest.files)].sort(),'Unlisted or missing bundle files');
  assert.deepEqual(manifest.validationFiles,validatorHashes(),'Validation scripts/toolchain differ from prepared candidate');
  const expectedNames=['contractor','cosmos-grpc','crypto','neutrino','types'].map(name=>'@solar-republic/'+name).sort();
  assert.deepEqual(manifest.packages.map(item=>item.name).sort(),expectedNames,'Unexpected candidate package set');
  assert.deepEqual([...new Set(manifest.packages.map(item=>item.filename))].sort(),manifest.packages.map(item=>item.filename).sort(),'Duplicate candidate filename');
  for(const item of manifest.packages) {
    safePath(item.filename);assert.match(item.filename,/^[a-z0-9.-]+\.tgz$/);
    assert(Object.hasOwn(manifest.files,item.filename));
    assert.equal(item.name,item.package.name);assert.equal(item.version,item.package.version);
    assert(!item.package.overrides && !item.package.pnpm);
    for(const spec of Object.values(item.package.dependencies || {})) assert(!/^(file:|link:|workspace:)/.test(spec));
  }
  assert(Object.hasOwn(manifest.files,'fixtures/inference.mts'));
  assert(Object.hasOwn(manifest.files,'fixtures/helper.js'));
  assert(Array.isArray(manifest.tests) && manifest.tests.length > 0);
  assert.equal(new Set(manifest.tests).size,manifest.tests.length);
  for(const file of manifest.tests) {
    assert.match(file,/^fixtures\/[a-z0-9.-]+\.js$/);
    assert(Object.hasOwn(manifest.files,file),`Unsigned test fixture: ${file}`);
  }
  assert(recordLock ? !manifest.files['consumer-lock.json'] : manifest.files['consumer-lock.json'],
    recordLock ? 'Candidate lockfile is immutable; prepare a new bundle' : 'Missing frozen consumer lockfile');
}
