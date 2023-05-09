import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import {defineConfig} from 'rollup';
import filesize from 'rollup-plugin-filesize';
import ignore from 'rollup-plugin-ignore';

export default defineConfig({
	input: 'src/main.ts',
	output: {
		dir: 'dist',
		format: 'esm',
		entryFileNames: '[name].mjs',
	},
	external: [
		'@solar-republic/aes-128-siv-jss',
		'@solar-republic/belt',
	],
	plugins: [
		resolve(),

		commonjs(),

		ignore(['crypto']),

		typescript({
			sourceMap: false,
			include: 'src/**.ts',
		}),

		// multiple passes thru terser
		terser({
			compress: {
				passes: 3,
				ecma: 2020,
				module: true,
				toplevel: true,
				keep_fargs: false,
			},
		}),

		filesize(),
	],
});
