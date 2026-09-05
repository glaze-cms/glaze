import type {
	GlazeConfig,
	ResolvedGlazeConfig,
	ResolvedWorkflowConfig,
	WorkflowConfig,
	WorkflowMode,
} from './types.ts';

/** Default directory for generated migration files. */
const DEFAULT_MIGRATIONS_DIR = './drizzle';

/** Default collaboration mode: alone, migrations disposable. */
const DEFAULT_WORKFLOW_MODE: WorkflowMode = 'solo';

/**
 * Whether each mode audits when the project does not say. Working alone, a change applies as you
 * make it; working as a team, it waits for a person. Both are overridable — the two axes are
 * independent (see `specs/design/pending-approvals.md`).
 */
const DEFAULT_AUDIT_FOR_MODE: Readonly<Record<WorkflowMode, boolean>> = {
	solo: false,
	team: true,
};

/**
 * Resolves the workflow axes, defaulting `audit` from the mode when it is not set explicitly.
 *
 * @param workflow - The user-provided workflow config, if any.
 * @returns The workflow with `mode` and `audit` both concrete.
 */
function resolveWorkflow(workflow: WorkflowConfig | undefined): ResolvedWorkflowConfig {
	const mode = workflow?.mode ?? DEFAULT_WORKFLOW_MODE;
	return { mode, audit: workflow?.audit ?? DEFAULT_AUDIT_FOR_MODE[mode] };
}

/**
 * Resolves a user {@link GlazeConfig} into a {@link ResolvedGlazeConfig}, filling every
 * optional field with its default.
 *
 * @param config - The user-provided configuration.
 * @returns The configuration with all defaults applied.
 */
export function resolveConfig(config: GlazeConfig): ResolvedGlazeConfig {
	return {
		dialect: config.dialect,
		connection: config.connection,
		schema: config.schema,
		migrations: config.migrations ?? DEFAULT_MIGRATIONS_DIR,
		workflow: resolveWorkflow(config.workflow),
	};
}
