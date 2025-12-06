import { GLAZE_VERSION } from '@glaze/shared';
import { logger } from '@glaze/logger';

// Core Glaze engine - schema management, convergence, utilities
export const version = GLAZE_VERSION;
export { GLAZE_VERSION };

logger.info(`🌊 Glaze CMS v${version} - Initialized!`);
