export { defineGlazeConfig } from './config.ts';
export { loadConfig } from './loader.ts';
export { resolveConfig } from './resolver.ts';

export type {
	Dialect,
	GlazeConfig,
	MigrationsConfig,
	ResolvedGlazeConfig,
	ResolvedMigrationsConfig,
	ResolvedWorkflowConfig,
	WorkflowConfig,
} from './types.ts';
