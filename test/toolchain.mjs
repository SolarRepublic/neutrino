// Compiler migration gate: compare emit, exercise the tooling API, and bundle for browsers.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'neutrino-toolchain-'));
const require = createRequire(import.meta.url);
const run = (script, args) => {
  const result = spawnSync(process.execPath, [join(root, script), ...args], {
    cwd: root, encoding: 'utf8', timeout: 180000,
  });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  return result.stdout + result.stderr;
};

// Retain the parsed syntax tree and token text; only trivia/string quoting is normalized.
// This does not erase type arguments, optionality, tuple members or union order.
const declarationShape = text => {
  const source = ts.createSourceFile('output.d.ts', text, ts.ScriptTarget.Latest, true);
  assert.equal(source.parseDiagnostics.length, 0, 'Emitted declarations must parse');
  const visit = node => {
    const children = node.getChildren(source);
    return [node.kind, children.length ? children.map(visit)
      : ts.isStringLiteral(node) ? node.text : node.getText(source)];
  };
  return visit(source);
};

try {
  assert.match(ts.version, /^6\./);
  for(const tool of ['typedoc', '@typescript-eslint/parser']) {
    const toolRequire = createRequire(require.resolve(tool));
    assert.equal(toolRequire.resolve('typescript'), require.resolve('typescript'), `${tool} must use the TS6 API`);
  }
  const compilers = [
    ['5.9', 'node_modules/typescript59/bin/tsc'],
    ['6', 'node_modules/typescript/bin/tsc6'],
    ['7', 'node_modules/@typescript/native/bin/tsc'],
  ];
  for(const [version, compiler] of compilers) {
    const output = join(temporary, version);
    run(compiler, ['-p', 'tsconfig.mjs.json', '--outDir', output, '--declarationDir', output]);
  }
  const files = readdirSync(join(temporary, '5.9'), {recursive: true}).sort();
  assert(files.some(file => file.endsWith('.js')));
  assert(files.some(file => file.endsWith('.d.ts')));
  for(const version of ['6', '7']) {
    assert.deepEqual(readdirSync(join(temporary, version), {recursive: true}).sort(), files);
    for(const file of files) {
      if(!file.endsWith('.js') && !file.endsWith('.d.ts')) continue;
      const baseline = readFileSync(join(temporary, '5.9', file), 'utf8');
      const candidate = readFileSync(join(temporary, version, file), 'utf8');
      if(file.endsWith('.js')) assert.equal(candidate, baseline, `TS${version} JavaScript differs: ${file}`);
      else assert.deepEqual(declarationShape(candidate), declarationShape(baseline), `TS${version} declarations differ: ${file}`);
    }
  }
  console.log('TS5.9/6/7: identical JavaScript and declaration syntax (ignoring trivia/string quoting).');
  const output = run('node_modules/typedoc/bin/typedoc', [
    '--tsconfig', 'tsconfig.mjs.json', 'src/main.ts', '--json', join(temporary, 'api.json'),
  ]);
  const docs = JSON.parse(readFileSync(join(temporary, 'api.json'), 'utf8'));
  for(const name of ['CosmosSigner', 'SecretContract', 'SecretApp', 'exec_fees']) {
    assert(docs.children.some(child => child.name === name), `Missing API documentation: ${name}`);
  }
  process.stdout.write(output);
  console.log(`TypeDoc and ESLint parser resolve the TS${ts.version} compiler API.`);
  // Use the same installed esbuild as the tsx test runner, without another bundler version.
  const {build} = createRequire(require.resolve('tsx/package.json'))('esbuild');
  // Build from dist so dependency resolution uses Neutrino's installed production graph.
  run('node_modules/@typescript/native/bin/tsc', ['-p', 'tsconfig.mjs.json']);
  const bundle = await build({entryPoints: [join(root, 'dist/mjs/main.js')], bundle: true,
    platform: 'browser', format: 'esm', target: 'es2022', write: false});
  console.log(`Browser ESM bundle: ${bundle.outputFiles[0].contents.length} bytes (unminified).`);
}
finally {
  rmSync(temporary, {recursive: true, force: true});
}
