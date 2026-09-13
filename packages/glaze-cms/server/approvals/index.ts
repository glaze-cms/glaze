export { createTrailId } from './id.ts';
export { materializeApprovalTables } from './materializer.ts';
export {
	APPROVAL_REQUEST_INDEX,
	APPROVAL_TYPE_INDEX,
	buildApprovalSchema,
	GLAZE_PG_SCHEMA,
	GLAZE_SQLITE_PREFIX,
} from './schema/index.ts';
export {
	claimFirstAdmin,
	findOpenRequest,
	findOpenRequests,
	findRole,
	hasAdmin,
	recordEvent,
} from './store.ts';

export type {
	ActorKind,
	ApprovalEventType,
	ApprovalSchema,
	PrincipalRole,
} from './schema/index.ts';
export type { ApprovalDb, ApprovalEventInput, OpenRequest } from './store.ts';
