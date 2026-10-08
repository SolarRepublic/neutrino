// Package only the verified inventory; suppress macOS AppleDouble/xattr entries.
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {digest,readJson,run} from './common.mjs';
import {fileList,validateBundle} from './integrity.mjs';
const bundle=resolve(process.argv[2]);
const output=resolve(process.argv[3]);
assert(!existsSync(output),'Archive already exists');
validateBundle(bundle,readJson(bundle+'/manifest.json'));
const files=fileList(bundle);
await run('tar',['--format=ustar','-czf',output,'-C',bundle,...files],undefined,{COPYFILE_DISABLE:'1'});
const listed=(await run('tar',['-tzf',output])).trim().split(/\r?\n/).sort();
assert.deepEqual(listed,files,'Archive contains unexpected platform metadata');
console.log(`Archive SHA-256: ${digest(readFileSync(output))}`);
