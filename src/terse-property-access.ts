import type {A, S, L, O, U} from 'ts-toolbelt';

import {ode, odv, type Dict} from '@blake.regalia/belt';

type Prefix<si_key extends string> = si_key extends `${infer s_0}${infer s_rest}`
	? `_${s_0}`
	: never;

type AllPrefixes<si_key extends string> = si_key extends `${infer s_0}${infer s_rest}`
	? s_0 | `${s_0}${AllPrefixes<s_rest>}`
	: never;

// type Suffix<si_key extends string> = `$${L.Last<S.Split<si_key>>}`;


// type Suffix<si_key extends string> = si_key extends `${infer s_0}${infer s_slice0}`
// 	? s_slice0 extends `${infer s_1}${infer s_slice1}${infer s_tail}`
// 		? Suffix<s_slice0>
// 		: s_slice0 extends `${infer s_1}${infer s_slice1}`
// 			? s_slice0
// 			: si_key
// 	: si_key;


type AllSuffixes<si_key extends string> = si_key extends `${infer s_0}${infer s_slice0}`
	? s_slice0 extends `${infer s_1}${infer s_slice1}${infer s_tail}`
		? s_slice0 | AllSuffixes<s_slice0>
		: s_slice0 extends `${infer s_1}${infer s_slice1}`
			? s_slice0
			: ''
	: undefined;

type TestSuffixes = [
	AllSuffixes<''>,
	AllSuffixes<'y'>,
	AllSuffixes<'ne'>,
	AllSuffixes<'granter'>,
];



// type TestSuffix = [
// 	Suffix<''>,
// 	Suffix<'y'>,
// 	Suffix<'ne'>,
// 	Suffix<'tres'>,
// ];

type Mutations<si_key extends string> = si_key | `_${Exclude<AllPrefixes<si_key>, si_key>}` | `$${AllSuffixes<si_key>}`;

type Tpa<
	h_target extends Record<string, any>,
	as_keys extends Extract<keyof h_target, string>=Extract<keyof h_target, string>,
> = U.Merge<{
	[si_key in as_keys]: Record<Mutations<si_key>, h_target[si_key]>;
}[as_keys]>;

// type ttt = Tpa<{
// 	granter: 'granter';
// 	grantee: 'grantee';
// }>;


export const tpas = (h_target: Dict<any>, si_term: string) => h_target[Object.keys(h_target).find(s => s.startsWith(si_term))!];
export const tpae = (h_target: Dict<any>, si_term: string) => h_target[Object.keys(h_target).find(s => s.endsWith(si_term))!];

export const tpaw = (h_target: Dict<any>, si_term: string, xc_side: 0|1=0) => h_target[
	Object.keys(h_target)
		.find(s => s[['starts', 'ends'][xc_side]+'With' as 'startsWith' | 'endsWith'](si_term))!];


export const tpar = (h_target: Dict<any>, r_match: RegExp) => h_target[Object.keys(h_target).find(s => r_match.test(s))!];

export const tpa = <
	h_subject extends Record<string, any>,
>(h_subject: h_subject): Tpa<h_subject> => new Proxy(h_subject, {
	get(h_target, z_property) {
		if('string' !== typeof z_property || h_target[z_property]) return h_target[z_property as string];

		// the fragment of the string
		const s_frag = z_property.slice(1);

		// option B.1
		return ode(h_target).find({
			_: (a: [string, any]) => a[0].startsWith(s_frag),
			$: (a: [string, any]) => a[0].endsWith(s_frag),
		}[z_property[0]]!);
	},

	// get<
	// 	si_property extends string,
	// 	w_out extends Tpa<Record<si_property, typeof h_subject[si_property]>>,
	// >(
	// 	h_target: Record<si_property | symbol, any>,
	// 	z_property: si_property | symbol
	// ): w_out | void {
	// 	if(h_target[z_property]) return h_target[z_property];

	// 	if('string' === typeof z_property) {
	// 		// the fragment of the string
	// 		const s_frag = z_property.slice(1);

	// 		// // option A
	// 		// for(const si_key in h_target) {
	// 		// 	if(('_' === s_0 && si_key.startsWith(s_frag))
	// 		// 		|| ('$' === s_0 && si_key.endsWith(s_frag))
	// 		// 	) {
	// 		// 		return h_target[si_key];
	// 		// 	}
	// 		// }

	// 		// // option B
	// 		// return ode(h_target).find(({
	// 		// 	_: (a: [string, any]) => a[0].startsWith(s_frag),
	// 		// 	$: (a: [string, any]) => a[0].endsWith(s_frag),
	// 		// })[z_property[0]]!);

	// 		// option B.1
	// 		return ode(h_target).find({
	// 			_: (a: [string, any]) => a[0].startsWith(s_frag),
	// 			$: (a: [string, any]) => a[0].endsWith(s_frag),
	// 		}[z_property[0]]!) as w_out;


	// 		// // option C
	// 		// return h_target[odv(h_target).find(({
	// 		// 	_: (s: string) => s.startsWith(s_frag),
	// 		// 	$: (s: string) => s.endsWith(s_frag),
	// 		// })[z_property[0]]!)];

	// 		// // option D
	// 		// const s_0 = z_property[0];
	// 		// return h_target[odv(h_target).find(s => ('_' === s_0 && s.startsWith(s_frag))
	// 		// 	|| ('$' === s_0 && s.endsWith(s_frag)))];
	// 	}
	// },
}) as Tpa<h_subject>;

// const ggg = tpa({
// 	allowances: 'allowances',
// 	granter: 'granter',
// 	grantee: 'grantee',
// });
