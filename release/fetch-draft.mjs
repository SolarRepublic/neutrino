// GitHub credentials are used only for download, before any candidate code executes.
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {digest, readJson, run} from './common.mjs';
import {safePath,validateBundle} from './integrity.mjs';
const pointer=readJson('release/candidate.json');
assert.match(pointer.tag,/^neutrino-validation-[a-zA-Z0-9.-]+$/);
assert.equal(pointer.asset,'candidate.tar.gz');
assert.match(pointer.archiveSha256,/^[a-f0-9]{64}$/);
assert.match(pointer.manifestSha256,/^[a-f0-9]{64}$/);
const temporary=mkdtempSync(join(tmpdir(),'neutrino-draft-'));
const output=resolve(process.argv[2] || 'candidate');
try {
  await run('gh',['release','download',pointer.tag,'--repo',process.env.GITHUB_REPOSITORY,
    '--pattern',pointer.asset,'--dir',temporary]);
  const archive=join(temporary,pointer.asset);
  assert.equal(digest(readFileSync(archive)),pointer.archiveSha256,'Draft archive checksum mismatch');
  // The archive was generated from this reviewed candidate; still reject unsafe members.
  const entries=(await run('tar',['-tvzf',archive])).trim().split(/\r?\n/);
  for(const entry of entries) assert(/^[d-]/.test(entry),'Archive links and special files are forbidden');
  const files=(await run('tar',['-tzf',archive])).trim().split(/\r?\n/);
  for(const file of files) safePath(file.replace(/\/$/,''));
  mkdirSync(output);
  await run('tar',['-xzf',archive,'-C',output]);
  assert.equal(digest(readFileSync(join(output,'manifest.json'))),pointer.manifestSha256,'Draft manifest checksum mismatch');
  validateBundle(output,readJson(join(output,'manifest.json')));
  console.log(`Verified candidate ${pointer.manifestSha256} from draft ${pointer.tag}`);
}
finally {rmSync(temporary,{recursive:true,force:true});}
