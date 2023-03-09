import { Knex } from 'knex';
import { SchemaInspector } from 'knex-schema-inspector/lib/types/schema-inspector';
import { Table } from 'knex-schema-inspector/lib/types/table';
import { Column } from 'knex-schema-inspector/lib/types/column';
import { ForeignKey } from 'knex-schema-inspector/lib/types/foreign-key';

function stripQuotes(value?: string | null): string | null {
	if (value === null || value === undefined) {
		return null;
	}

	const trimmed = value.trim();

	if ((trimmed.startsWith(`'`) && trimmed.endsWith(`'`)) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
		return trimmed.slice(1, -1);
	}

	return value;
}

type RawTable = {
	tabname: string;
	dbname: string;
};

type RawColumn = {
	tabname: string;
	colname: string;
	COLUMN_DEFAULT: any | null;
	coltype: string;
	CHARACTER_MAXIMUM_LENGTH: number | null;
	NUMERIC_PRECISION: number | null;
	NUMERIC_SCALE: number | null;
	IS_NULLABLE: 'YES' | 'NO';
	COLLATION_NAME: string | null;
	COLUMN_COMMENT: string | null;
	REFERENCED_TABLE_NAME: string | null;
	REFERENCED_COLUMN_NAME: string | null;
	UPDATE_RULE: string | null;
	DELETE_RULE: string | null;
	COLUMN_KEY: 'PRI' | 'UNI' | null;
	EXTRA: 'auto_increment' | 'STORED GENERATED' | 'VIRTUAL GENERATED' | null;
	CONSTRAINT_NAME: 'PRIMARY' | null;
	GENERATION_EXPRESSION: string;
};

export function rawColumnToColumn(rawColumn: RawColumn): Column {
	let dataType = rawColumn.coltype.replace(/\(.*?\)/, '');
	if (rawColumn.coltype.startsWith('tinyint(1)')) {
		dataType = 'boolean';
	}

	return {
		name: rawColumn.colname,
		table: rawColumn.tabname,
		data_type: dataType,
		default_value: parseDefaultValue(rawColumn.COLUMN_DEFAULT),
		generation_expression: rawColumn.GENERATION_EXPRESSION || null,
		max_length: rawColumn.CHARACTER_MAXIMUM_LENGTH,
		numeric_precision: rawColumn.NUMERIC_PRECISION,
		numeric_scale: rawColumn.NUMERIC_SCALE,
		is_generated: !!rawColumn.EXTRA?.endsWith('GENERATED'),
		is_nullable: rawColumn.IS_NULLABLE === 'YES',
		is_unique: rawColumn.COLUMN_KEY === 'UNI',
		is_primary_key: rawColumn.CONSTRAINT_NAME === 'PRIMARY' || rawColumn.COLUMN_KEY === 'PRI',
		has_auto_increment: rawColumn.EXTRA === 'auto_increment',
		foreign_key_column: rawColumn.REFERENCED_COLUMN_NAME,
		foreign_key_table: rawColumn.REFERENCED_TABLE_NAME,
		comment: rawColumn.COLUMN_COMMENT,
	};
}

export function parseDefaultValue(value: string | null) {
	if (value === null || value.trim().toLowerCase() === 'null') return null;

	return stripQuotes(value);
}

export default class InformixDB implements SchemaInspector {
	knex: Knex;

	constructor(knex: Knex) {
		this.knex = knex;
	}

	// Tables
	// ===============================================================================================

	/**
	 * List all existing tables in the current schema/database
	 */
	async tables() {
		const records = await this.knex.select<{ tabname: string }[]>('tabname').from('systables').where({
			dbname: this.knex.client.database(),
		});
		return records.map(({ tabname }) => tabname);
	}

	/**
	 * Get the table info for a given table. If table parameter is undefined, it will return all tables
	 * in the current schema/database
	 */
	tableInfo(): Promise<Table[]>;
	tableInfo(table: string): Promise<Table>;
	async tableInfo<T>(table?: string) {
		const query = this.knex.select('tabname', 'dbname').from('systables');

		if (table) {
			const rawTable: RawTable = await query.andWhere({ tabname: table }).first();

			return {
				name: rawTable.tabname,
				schema: rawTable.dbname,
			} as T extends string ? Table : Table[];
		}

		const records: RawTable[] = await query;

		return records.map((rawTable): Table => {
			return {
				name: rawTable.tabname,
				schema: rawTable.dbname,
			};
		}) as T extends string ? Table : Table[];
	}

	/**
	 * Check if a table exists in the current schema/database
	 */
	async hasTable(table: string): Promise<boolean> {
		const result = await this.knex('systables').count<{ count: 0 | 1 }>({ count: '*' }).where({ tabname: table });
		return (result && result.count === 1) || false;
	}

	// Columns
	// ===============================================================================================

	/**
	 * Get all the available columns in the current schema/database. Can be filtered to a specific table
	 */
	async columns(table?: string) {
		const query = this.knex
			.select<{ tabname: string; colname: string }[]>('tabname', 'colname')
			.from('systables')
			.innerJoin('syscolumns', 'systables.tabid', '=', 'syscolumns.tabid')
			.where((builder) => {
				builder.where({ dbname: this.knex.client.database() });
			})
			.andWhere((builder) => {
				builder.where('systables.owner', '=', this.knex.raw('user'));
			})
			.orderBy('tabname', 'colno');

		if (table) {
			query.andWhere({ tabname: table });
		}

		const records = await query;

		return records.map(({ tabname, colname }) => ({
			table: tabname,
			column: colname,
		}));
	}

	/**
	 * Get the column info for all columns, columns in a given table, or a specific column.
	 */
	columnInfo(): Promise<Column[]>;
	columnInfo(table: string): Promise<Column[]>;
	columnInfo(table: string, column: string): Promise<Column>;
	async columnInfo(table?: string, column?: string) {
		const query = this.knex
			.select(
				'c.TABLE_NAME',
				'c.COLUMN_NAME',
				'c.COLUMN_DEFAULT',
				'c.COLUMN_TYPE',
				'c.CHARACTER_MAXIMUM_LENGTH',
				'c.IS_NULLABLE',
				'c.COLUMN_KEY',
				'c.EXTRA',
				'c.COLLATION_NAME',
				'c.COLUMN_COMMENT',
				'c.NUMERIC_PRECISION',
				'c.NUMERIC_SCALE',
				'c.GENERATION_EXPRESSION',
				'fk.REFERENCED_TABLE_NAME',
				'fk.REFERENCED_COLUMN_NAME',
				'fk.CONSTRAINT_NAME',
				'rc.UPDATE_RULE',
				'rc.DELETE_RULE',
				'rc.MATCH_OPTION'
			)
			.from('INFORMATION_SCHEMA.COLUMNS as c')
			.leftJoin('INFORMATION_SCHEMA.KEY_COLUMN_USAGE as fk', function () {
				this.on('c.TABLE_NAME', '=', 'fk.TABLE_NAME')
					.andOn('fk.COLUMN_NAME', '=', 'c.COLUMN_NAME')
					.andOn('fk.CONSTRAINT_SCHEMA', '=', 'c.TABLE_SCHEMA');
			})
			.leftJoin('INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS as rc', function () {
				this.on('rc.TABLE_NAME', '=', 'fk.TABLE_NAME')
					.andOn('rc.CONSTRAINT_NAME', '=', 'fk.CONSTRAINT_NAME')
					.andOn('rc.CONSTRAINT_SCHEMA', '=', 'fk.CONSTRAINT_SCHEMA');
			})
			.where({
				'c.TABLE_SCHEMA': this.knex.client.database(),
			});

		if (table) {
			query.andWhere({ 'c.TABLE_NAME': table });
		}

		if (column) {
			const rawColumn: RawColumn = await query.andWhere({ 'c.column_name': column }).first();

			return rawColumnToColumn(rawColumn);
		}

		const records: RawColumn[] = await query;

		return records
			.map(rawColumnToColumn)
			.sort((column) => +!column.foreign_key_column)
			.filter((column, index, records) => {
				const first = records.findIndex((_column) => {
					return column.name === _column.name && column.table === _column.table;
				});
				return first === index;
			});
	}

	/**
	 * Check if a table exists in the current schema/database
	 */
	async hasColumn(table: string, column: string): Promise<boolean> {
		const result = await this.knex('systables')
			.join('syscolumns', 'systables.tabid', '=', 'syscolumns.tabid')
			.count<{ count: 0 | 1 }>({ count: '*' })
			.where({
				// dbname: this.knex.client.database(),
				tabname: table,
				colname: column,
			});

		return !!(result && result.count);
	}

	/**
	 * Get the primary key column for the given table
	 */
	async primary(table: string) {
		// const results = await this.knex.raw(`SHOW KEYS FROM ?? WHERE Key_name = 'PRIMARY'`, table);

		// if (results && results.length && results[0].length) {
		// 	return results[0][0]['Column_name'] as string;
		// }

		const result = await this.knex
			.select('c.constrname AS pk_name', 'c.constrtype AS pk_type', 'col.colname AS pk_column')
			.from('sysconstraints AS c')
			.join('sysindexes AS i', (builder) => {
				builder.on('c.tabid', '=', 'i.tabid').andOn('c.constrtype', '=', this.knex.raw("'P'"));
			})
			.join('syscolumns AS col', (builder) => {
				builder.on('c.tabid', '=', 'col.tabid').andOn('i.part1', '=', 'col.colno').andOn('col.coltype', '>=', '0');
			})
			.where('c.tabid', '=', () => {
				this.knex.select('tabid').from('systables').where('tabname', table);
			});

		if (result && result.length) {
			return result[0]['pk_column'];
		}

		return null;
	}

	// Foreign Keys
	// ===============================================================================================

	async foreignKeys(table?: string) {
		const query = this.knex
			.select(
				`rc.TABLE_NAME AS table`,
				`kcu.COLUMN_NAME AS column`,
				`rc.REFERENCED_TABLE_NAME AS foreign_key_table`,
				`kcu.REFERENCED_COLUMN_NAME AS foreign_key_column`,
				`rc.CONSTRAINT_NAME AS constraint_name`,
				`rc.UPDATE_RULE AS on_update`,
				`rc.DELETE_RULE AS on_delete`
			)
			.from(`information_schema.referential_constraints AS rc`)
			.leftJoin(`information_schema.key_column_usage AS kcu `, function () {
				this.on(`rc.CONSTRAINT_NAME`, `=`, `kcu.CONSTRAINT_NAME`).andOn(
					`kcu.CONSTRAINT_SCHEMA`,
					`=`,
					`rc.CONSTRAINT_SCHEMA`
				);
			})
			.where({
				'rc.CONSTRAINT_SCHEMA': this.knex.client.database(),
			});
		if (table) {
			query.andWhere({ 'rc.TABLE_NAME': table });
		}
		const result: ForeignKey[] = await query;
		return result;
	}
}
