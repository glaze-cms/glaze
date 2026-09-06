export { createPrincipalEnrolment } from './enrolment.ts';
export { APPROVALS_ROUTE_NAME, createApprovalsRouter } from './router.ts';
export { createTrailId } from './id.ts';
export { materializeApprovalTables } from './materializer.ts';
export {
	APPROVAL_REQUEST_INDEX,
	APPROVAL_TYPE_INDEX,
	buildApprovalSchema,
	GLAZE_PG_SCHEMA,
	GLAZE_SQLITE_PREFIX,
} from './schema/index.ts';
export { enrolPrincipal, findOpenRequest, findRole, recordEvent } from './store.ts';

export type {
	ActorKind,
	ApprovalEventType,
	ApprovalSchema,
	PrincipalRole,
} from './schema/index.ts';
export type { ApprovalDb, ApprovalEventInput, OpenRequest } from './store.ts';
