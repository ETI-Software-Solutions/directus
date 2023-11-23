export type Driver =
	| '@etisoftware/knex-informix-dialect'
	| 'mysql'
	| 'pg'
	| 'cockroachdb'
	| 'sqlite3'
	| 'oracledb'
	| 'mssql';

export const DatabaseClients = [
	'informixdb',
	'mysql',
	'postgres',
	'cockroachdb',
	'sqlite',
	'oracle',
	'mssql',
	'redshift',
] as const;
export type DatabaseClient = (typeof DatabaseClients)[number];
