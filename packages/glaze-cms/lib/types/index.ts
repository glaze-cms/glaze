/**
 * Global types shared package-wide (importable as `#types`). Cross-cutting type definitions that don't
 * belong to a single concern live here; add them as they arise.
 */

export type { Strict } from './strict.ts';
export type {
	ApiListResponse,
	ApiResponse,
	GlazeError,
	GlazeErrorCode,
	ResponseMetadata,
} from './response.ts';
