// CI inputs are environment variables, never interpolated into shell commands.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {digest} from './common.mjs';
const url = new URL(process.env.CANDIDATE_MANIFEST_URL);
assert.equal(url.protocol,'https:');
assert.match(process.env.CANDIDATE_MANIFEST_SHA256 || '',/^[a-f0-9]{64}$/);
const output = resolve(process.argv[2] || 'candidate');
mkdirSync(output);
async function download(url) {
  const response = await fetch(url,{signal:AbortSignal.timeout(120000)});
  assert(response.ok,`${url}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const bytes = await download(url);
assert.equal(digest(bytes),process.env.CANDIDATE_MANIFEST_SHA256,'Candidate manifest checksum mismatch');
const manifest = JSON.parse(bytes);
assert.equal(manifest.format,1);
for(const [file,hash] of Object.entries(manifest.files)) {
  assert.match(file,/^[a-zA-Z0-9_./-]+$/);
  assert(!file.startsWith('/') && !file.split('/').includes('..'));
  assert.match(hash,/^[a-f0-9]{64}$/);
  const content = await download(new URL(file,url));
  assert.equal(digest(content),hash,`Candidate checksum mismatch: ${file}`);
  mkdirSync(dirname(join(output,file)),{recursive:true});
  writeFileSync(join(output,file),content);
}
writeFileSync(join(output,'manifest.json'),bytes);
console.log(`Downloaded verified candidate bundle to ${output}`);
