import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {root,writeJson} from './common.mjs';

test('candidate verification rejects changed tarballs before opening a registry or installing',()=>{
  const directory=mkdtempSync(join(tmpdir(),'neutrino-integrity-'));
  try {
    writeFileSync(join(directory,'candidate.tgz'),'tampered');
    writeJson(join(directory,'manifest.json'),{format:1,packages:[],files:{'candidate.tgz':'0'.repeat(64)}});
    const result=spawnSync(process.execPath,[join(root,'release/verify.mjs'),directory],{encoding:'utf8'});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/Changed bundle file: candidate.tgz/);
  }
  finally {rmSync(directory,{recursive:true,force:true});}
});

test('candidate verification rejects paths outside the bundle',()=>{
  const directory=mkdtempSync(join(tmpdir(),'neutrino-integrity-'));
  try {
    writeJson(join(directory,'manifest.json'),{format:1,packages:[],files:{'../outside.tgz':'0'.repeat(64)}});
    const result=spawnSync(process.execPath,[join(root,'release/verify.mjs'),directory],{encoding:'utf8'});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/AssertionError/);
    assert.doesNotMatch(result.stderr,/ENOENT/);
  }
  finally {rmSync(directory,{recursive:true,force:true});}
});
