import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import {defineConfig} from 'rollup';
import filesize from 'rollup-plugin-filesize';
import ignore from 'rollup-plugin-ignore';
import uglify from 'uglify-js';

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
			include: 'src/**/*.ts',
		}),

		// replace({
		// 	delimiters: ['(?!export )\\b', '\\b'],
		// 	values: {
		// 		const: 'let',
		// 	},
		// }),

		// multiple passes thru terser
		terser({
			compress: {
				passes: 3,
				ecma: 2020,
				module: true,
				toplevel: true,
				keep_fargs: false,
			},
			mangle: {
				toplevel: true,
				// properties: {
				// 	// undeclared: true,
				// },
			},
			format: {
				wrap_func_args: false,
			},
		}),

		// terser is not perfect on its own (e.g., needless arrow function parens)
		// use uglify to clean up remainder
		// https://github.com/terser/terser/issues/1120
		{
			name: 'uglify',

			// generateBundle(gc_bundle, h_bundle) {

			// },
			generateBundle: {
				handler(gc_bundle, h_bundle, b_write) {
					for(const [si_part, g_bundle] of Object.entries(h_bundle)) {
						if('chunk' === g_bundle.type) {
							g_bundle.code = uglify.minify(g_bundle.code).code;
						}
					}
				},
			},
			// generateBundle(sx_code, si_part) {
			// 	return uglify.minify(sx_code);
			// },
		},

		filesize(),
	],
});
