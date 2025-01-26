import type {RemoteServiceArg} from './types';
import type {RemoteServiceDescriptor} from '@solar-republic/types';

import {is_function, is_string} from '@blake.regalia/belt';
import {CosmosClientLcdDirect, fetcher_retryable_basic, type CosmosClientLcd} from '@solar-republic/cosmos-grpc';

/**
 * Normalizes a {@link RemoteServiceArg} into a {@link RemoteServiceDescriptor}
 */
export const remote_service = (z_service: RemoteServiceArg): RemoteServiceDescriptor => is_string(z_service)? {origin:z_service}: z_service;

/**
 * Normalizes a {@link CosmosClientLcd} or {@link RemoteServiceArg} into a {@link CosmosClientLcd}
 * @param z_lcd 
 * @returns 
 */
export const normalize_lcd_client = (z_lcd: CosmosClientLcd | RemoteServiceArg): CosmosClientLcd => is_function((z_lcd as CosmosClientLcd)?.lcd)
	? z_lcd as CosmosClientLcd
	: CosmosClientLcdDirect(z_lcd as RemoteServiceArg, fetcher_retryable_basic());
