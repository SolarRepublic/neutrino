import {__UNDEFINED} from '@blake.regalia/belt';

/** Diagnostics deliberately omit addresses, auth, payloads, memo, raw logs and decrypted results. */
export type NeutrinoDiagnostic = Readonly<{
	operation: 'query' | 'execute' | 'upload' | 'instantiate';
	stage: 'start' | 'complete' | 'reuse';
	code?: number;
}>;

let F_DIAGNOSTIC: ((g_event: NeutrinoDiagnostic) => void | Promise<void>) | undefined;

/** Opt in to metadata-only diagnostics. Returns a function that removes this handler. */
export const set_neutrino_diagnostics = (f_handler: (g_event: NeutrinoDiagnostic) => void | Promise<void>): () => void => {
	F_DIAGNOSTIC = f_handler;
	return () => { if(F_DIAGNOSTIC === f_handler) F_DIAGNOSTIC = __UNDEFINED; };
};

/** @internal */
export const emit_diagnostic = (g_event: NeutrinoDiagnostic): void => {
	try { void Promise.resolve(F_DIAGNOSTIC?.(Object.freeze(g_event))).catch(() => { /* Ignore diagnostic delivery errors. */ }); }
	catch{ /* Diagnostics must not affect requests or signing. */ }
};
