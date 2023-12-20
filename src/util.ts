/* eslint-disable prefer-const */

import {bytes} from '@blake.regalia/belt';

// eslint-disable-next-line @typescript-eslint/naming-convention,@typescript-eslint/no-unused-vars
export const random_32 = (_?: never): Uint8Array => crypto.getRandomValues(bytes(32));
