// Explicit discovery works on shells which do not expand globs (including Windows).
import {readdirSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join, resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const run = args => {
  const result = spawnSync(process.execPath, args, {cwd: root, stdio: 'inherit'});
  if(result.error) throw result.error;
  if(result.status !== 0) process.exit(result.status ?? 1);
};
const compiled = process.argv.includes('--compiled');
const directory = compiled ? 'dist/test/test' : 'test';
const extension = compiled ? '.js' : '.ts';
if(compiled) {
  rmSync(join(root, 'dist/test'), {recursive: true, force: true});
  run(['node_modules/@typescript/native/bin/tsc', '-p', 'tsconfig.json',
    '--outDir', 'dist/test', '--declarationDir', 'dist/test']);
}
const crypto = ['aes-cmac', 'aes-siv', 'chacha20', 'poly1305', 'ripemd160', 'x25519'];
const files = [...crypto.map(name => name + extension),
  ...readdirSync(join(root, directory)).filter(name => name.endsWith('.test' + extension)).sort()];
run([...(compiled ? [] : ['--import', 'tsx']), '--test', ...files.map(file => join(directory, file))]);
