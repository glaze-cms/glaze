import type { Logger } from '@glaze/logger';
import type { GlazeEnv } from './server/validators/env';

export interface GlazeContext {
	env: GlazeEnv;
	logger: Logger;
}
