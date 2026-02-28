import { sql } from 'drizzle-orm';

import {
	buildCreateTableSQL,
	buildRenameTableSQL,
	buildDropTableSQL,
} from '../sql/index';
import {
	isReservedName,
	tableExists,
	getTableReferences,
} from '../validators/index';

import type { DrizzleDatabase } from '../../types/index';
import type { FieldDef, OperationResult } from '../types/index';

export async function createCollection(
	db: DrizzleDatabase,
	params: { name: string; fields: FieldDef[] },
): Promise<OperationResult> {
	const { name, fields } = params;

	if (isReservedName(name)) {
		return {
			success: false,
			code: 'RESERVED_NAME',
			error: { collection: name },
		};
	}

	// Target must not already exist
	if (await tableExists(db, name)) {
		return {
			success: false,
			code: 'COLLECTION_ALREADY_EXISTS',
			error: { collection: name },
		};
	}

	const statement = buildCreateTableSQL(name, fields);
	await db.execute(sql.raw(statement));

	return { success: true, sql: statement };
}

export async function renameCollection(
	db: DrizzleDatabase,
	params: { collection: string; newName: string },
): Promise<OperationResult> {
	const { collection, newName } = params;

	// Source must exist
	if (!(await tableExists(db, collection))) {
		return {
			success: false,
			code: 'COLLECTION_NOT_FOUND',
			error: { collection },
		};
	}

	if (isReservedName(newName)) {
		return {
			success: false,
			code: 'RESERVED_NAME',
			error: { collection: newName },
		};
	}

	// Target must be free
	if (await tableExists(db, newName)) {
		return {
			success: false,
			code: 'COLLECTION_ALREADY_EXISTS',
			error: { collection: newName },
		};
	}

	const statement = buildRenameTableSQL(collection, newName);
	await db.execute(sql.raw(statement));

	return { success: true, sql: statement };
}

export async function dropCollection(
	db: DrizzleDatabase,
	params: { collection: string },
): Promise<OperationResult> {
	const { collection } = params;

	// Source must exist
	if (!(await tableExists(db, collection))) {
		return {
			success: false,
			code: 'COLLECTION_NOT_FOUND',
			error: { collection },
		};
	}

	// Refuse if other tables FK-reference this one — admin must remove those relations first
	const referencedBy = await getTableReferences(db, collection);

	if (referencedBy.length > 0) {
		return {
			success: false,
			code: 'COLLECTION_REFERENCED_BY_RELATION',
			error: { collection, referencedBy },
		};
	}

	const statement = buildDropTableSQL(collection);
	await db.execute(sql.raw(statement));

	return { success: true, sql: statement };
}
