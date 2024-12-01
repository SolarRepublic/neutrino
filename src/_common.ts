import type {RemoteServiceArg} from './types';
import type {RemoteServiceDescriptor} from '@solar-republic/types';

import {is_string} from '@blake.regalia/belt';

/**
 * Normalizes a {@link RemoteServiceArg} into a {@link RemoteServiceDescriptor}
 */
export const remote_service = (z_service: RemoteServiceArg): RemoteServiceDescriptor => is_string(z_service)? {origin:z_service}: z_service;
