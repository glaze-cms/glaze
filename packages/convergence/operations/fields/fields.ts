import { sql } from 'drizzle-orm';

import {
	buildAddColumnSQL,
	buildRenameColumnSQL,
	buildDropColumnSQL,
	buildSetNotNullSQL,
	buildDropNotNullSQL,
	buildSetDefaultSQL,
	buildDropDefaultSQL,
} from '../sql/index';
import {
	isReservedName,
	tableExists,
	columnExists,
	tableIsEmpty,
} from '../validators/index';

import type { DrizzleDatabase } from '../../types/index';
import type { FieldDef, LiteralDefault, ExprDefault, OperationResult } from '../types/index';

export async function addField(
	db: DrizzleDatabase,
	params: { collection: string; field: FieldDef },
): Promise<OperationResult> {
	const { collection, field } = params;

	if (!(await tableExists(db, collection))) {
		return {
			success: false,
			code: 'COLLECTION_NOT_FOUND',
			error: { collection },
		};
	}

	if (isReservedName(field.name)) {
		return {
			success: false,
			code: 'RESERVED_NAME',
			error: { field: field.name },
		};
	}

	// Target column must be free
	if (await columnExists(db, collection, field.name)) {
		return {
			success: false,
			code: 'FIELD_ALREADY_EXISTS',
			error: { collection, field: field.name },
		};
	}

	// NOT NULL without a default on a non-empty table will fail at the DB level —
	// catch it here to return a friendly error instead
	if (field.nullable === false && field.default === undefined) {
		if (!(await tableIsEmpty(db, collection))) {
			return {
				success: false,
				code: 'FIELD_NOT_NULL_NO_DEFAULT',
				error: { collection, field: field.name },
			};
		}
	}

	const statement = buildAddColumnSQL(collection, field);
	await db.execute(sql.raw(statement));

	return { success: true, sql: statement };
}

export async function renameField(
	db: DrizzleDatabase,
	params: { collection: string; field: string; newName: string },
): Promise<OperationResult> {
	const { collection, field, newName } = params;

	if (!(await tableExists(db, collection))) {
		return {
			success: false,
			code: 'COLLECTION_NOT_FOUND',
			error: { collection },
		};
	}

	// Source column must exist
	if (!(await columnExists(db, collection, field))) {
		return {
			success: false,
			code: 'FIELD_NOT_FOUND',
			error: { collection, field },
		};
	}

	if (isReservedName(newName)) {
		return {
			success: false,
			code: 'RESERVED_NAME',
			error: { field: newName },
		};
	}

	// Target column must be free
	if (await columnExists(db, collection, newName)) {
		return {
			success: false,
			code: 'FIELD_ALREADY_EXISTS',
			error: { collection, field: newName },
		};
	}

	const statement = buildRenameColumnSQL(collection, field, newName);
	await db.execute(sql.raw(statement));

	return { success: true, sql: statement };
}

export async function dropField(
	db: DrizzleDatabase,
	params: { collection: string; field: string },
): Promise<OperationResult> {
	const { collection, field } = params;

	if (!(await tableExists(db, collection))) {
		return {
			success: false,
			code: 'COLLECTION_NOT_FOUND',
			error: { collection },
		};
	}

	if (!(await columnExists(db, collection, field))) {
		return {
			success: false,
			code: 'FIELD_NOT_FOUND',
			error: { collection, field },
		};
	}

	const statement = buildDropColumnSQL(collection, field);
	await db.execute(sql.raw(statement));

	return { success: true, sql: statement };
}

export interface AlterFieldChanges {
	nullable?: boolean;
	default?: LiteralDefault | ExprDefault | 'drop';
}

export async function alterField(
	db: DrizzleDatabase,
	params: { collection: string; field: string; changes: AlterFieldChanges },
): Promise<OperationResult> {
	const { collection, field, changes } = params;

	if (!(await tableExists(db, collection))) {
		return {
			success: false,
			code: 'COLLECTION_NOT_FOUND',
			error: { collection },
		};
	}

	if (!(await columnExists(db, collection, field))) {
		return {
			success: false,
			code: 'FIELD_NOT_FOUND',
			error: { collection, field },
		};
	}

	const statements: string[] = [];

	if (changes.nullable === false) {
		// Adding NOT NULL — only safe if the column has no existing NULLs
		if (!(await tableIsEmpty(db, collection))) {
			return {
				success: false,
				code: 'FIELD_NOT_NULL_NO_DEFAULT',
				error: { collection, field },
			};
		}
		statements.push(buildSetNotNullSQL(collection, field));
	} else if (changes.nullable === true) {
		statements.push(buildDropNotNullSQL(collection, field));
	}

	if (changes.default === 'drop') {
		statements.push(buildDropDefaultSQL(collection, field));
	} else if (changes.default !== undefined) {
		statements.push(buildSetDefaultSQL(collection, field, changes.default));
	}

	if (statements.length === 0) {
		return {
			success: false,
			code: 'NO_CHANGES',
			error: { collection, field },
		};
	}

	for (const statement of statements) {
		await db.execute(sql.raw(statement));
	}

	return { success: true, sql: statements.join('\n') };
}
