import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {delimiter, dirname, join, resolve} from 'node:path';

export const root = resolve(import.meta.dirname, '..');
export const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
export const writeJson = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2)+'\n');
export const digest = (bytes, algorithm='sha256') => createHash(algorithm).update(bytes).digest('hex');
export function npmCli() {
  const candidates = [process.env.NPM_CLI_JS, process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')];
  for(const directory of (process.env.PATH || '').split(delimiter)) {
    for(const executable of ['npm', 'npm.cmd']) {
      const path = join(directory, executable);
      if(existsSync(path)) candidates.push(realpathSync(path));
    }
    candidates.push(join(directory, 'node_modules/npm/bin/npm-cli.js'));
  }
  const cli = candidates.find(path => path && path.endsWith('npm-cli.js') && existsSync(path));
  assert(cli, 'Cannot find npm-cli.js; set NPM_CLI_JS to its absolute path');
  return cli;
}
export function run(command, args, cwd=root, env={}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd, env:{...process.env, ...env}, windowsHide:true});
    let output = '';
    child.stdout.on('data', bytes => { output += bytes; });
    child.stderr.on('data', bytes => { output += bytes; });
    const timer = setTimeout(() => child.kill(), 300000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if(code === 0) resolve(output);
      else reject(Error(`${command} ${args.join(' ')} exited ${code}\n${output}`));
    });
  });
}
// Capture npm's JSON independently of advisory/config warnings on stderr.
export function npm(args, cwd=root, env={}) {
  return run(process.execPath, [npmCli(), '--loglevel=error', ...args], cwd, env);
}
