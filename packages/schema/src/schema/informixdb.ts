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
	table_name: string;
	column_name: string;
	column_default: any | null;
	column_type: string;
	character_maximum_length: number | null;
	numeric_precision: number | null;
	numeric_scale: number | null;
	is_nullable: 'YES' | 'NO';
	collation_name: string | null;
	column_comment: string | null;
	referenced_table_name: string | null;
	referenced_column_name: string | null;
	update_rule: string | null;
	delete_rule: string | null;
	column_key: 'PRI' | 'UNI' | null;
	extra: 'auto_increment' | 'STORED GENERATED' | 'VIRTUAL GENERATED' | null;
	constraint_name: 'PRIMARY' | null;
	generation_expression: string;
};

export function rawColumnToColumn(rawColumn: RawColumn): Column {
	// let dataType = rawColumn.column_type.replace(/\(.*?\)/, '');
	// if (rawColumn.column_type.startsWith('tinyint(1)')) {
	// 	dataType = 'boolean';
	// }

	return {
		name: rawColumn.column_name,
		table: rawColumn.table_name,
		data_type: rawColumn.column_type,
		default_value: parseDefaultValue(rawColumn.column_default),
		generation_expression: rawColumn.generation_expression || null,
		max_length: rawColumn.character_maximum_length,
		numeric_precision: rawColumn.numeric_precision,
		numeric_scale: rawColumn.numeric_scale,
		is_generated: !!rawColumn.extra?.endsWith('GENERATED'),
		is_nullable: rawColumn.is_nullable === 'YES',
		is_unique: rawColumn.column_key === 'UNI',
		is_primary_key: rawColumn.constraint_name === 'PRIMARY' || rawColumn.column_key === 'PRI',
		has_auto_increment: rawColumn.extra === 'auto_increment',
		foreign_key_column: rawColumn.referenced_column_name,
		foreign_key_table: rawColumn.referenced_table_name,
		comment: rawColumn.column_comment,
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
		const result = await this.knex('systables').count<[{ count: '0' | '1' }]>({ count: '*' }).where({ tabname: table });
		return (result && result[0].count === '1') || false;
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
		const storedProcedure = `
		DROP FUNCTION IF EXISTS sp_allinfo;

		CREATE FUNCTION sp_allinfo() RETURNING
			VARCHAR(128) AS dtabname,
			VARCHAR(128) AS dcolname,
			VARCHAR(128) AS ctabname,
			VARCHAR(128) AS ccolname,
			VARCHAR(128) AS cname;

			DEFINE l_constrname VARCHAR(128);
			DEFINE l_dtabname   VARCHAR(128);
			DEFINE l_ptabname   VARCHAR(128);
			DEFINE l_dtabid     LIKE systables.tabid;
			DEFINE l_ptabid     LIKE systables.tabid;
			DEFINE l_dindexkeys LIKE sysindices.indexkeys;
			DEFINE l_pindexkeys LIKE sysindices.indexkeys;
			DEFINE l_dcolno     LIKE syscolumns.colno;
			DEFINE l_pcolno     LIKE syscolumns.colno;
			DEFINE l_dcolname   VARCHAR(128);
			DEFINE l_pcolname   VARCHAR(128);
			DEFINE l_keyid      SMALLINT;

			FOREACH
				SELECT  dc.constrname,
						TRIM(dt.tabname), dt.tabid, di.indexkeys,
						TRIM(pt.tabname), pt.tabid, pi.indexkeys
				INTO    l_constrname,
						l_dtabname, l_dtabid, l_dindexkeys,
						l_ptabname, l_ptabid, l_pindexkeys
				FROM    sysconstraints AS dc
				JOIN    sysobjstate    AS do ON do.name     = dc.constrname
				JOIN    systables      AS dt ON dt.tabid    = dc.tabid
				JOIN    sysindices     AS di ON di.idxname  = dc.idxname
				JOIN    sysreferences  AS dr ON dr.constrid = dc.constrid
				JOIN    sysconstraints AS pc ON pc.constrid = dr.primary
				JOIN    systables      AS pt ON pt.tabid    = pc.tabid
				JOIN    sysindices     AS pi ON pi.idxname  = pc.idxname
				WHERE   dc.constrtype = 'R'
				AND     do.objtype = 'C'
				AND     do.state = 'E'
				AND     dt.tabname not like 'sys%'
				AND     dt.tabname not like 'vw%'
				ORDER   BY 2, 1

				LET l_keyid = 0;
				LET l_dcolno = ikeyextractcolno(l_dindexkeys, l_keyid);
				LET l_pcolno = ikeyextractcolno(l_pindexkeys, l_keyid);

				IF l_dcolno != 0 THEN
					SELECT  TRIM(colname)
					INTO    l_dcolname
					FROM    syscolumns
					WHERE   tabid = l_dtabid
					AND     colno = l_dcolno;

					SELECT  TRIM(colname)
					INTO    l_pcolname
					FROM    syscolumns
					WHERE   tabid = l_ptabid
					AND     colno = l_pcolno;

					RETURN l_dtabname, l_dcolname, l_ptabname, l_pcolname, l_constrname WITH RESUME;
				END IF
			END FOREACH;

			FOREACH
				SELECT  dc.constrname,
						TRIM(dt.tabname), dt.tabid, di.indexkeys,
						TRIM(pt.tabname), pt.tabid, pi.indexkeys
				INTO    l_constrname,
						l_dtabname, l_dtabid, l_dindexkeys,
						l_ptabname, l_ptabid, l_pindexkeys
				FROM    sysconstraints AS dc
				JOIN    sysobjstate    AS do ON do.name     = dc.constrname
				JOIN    systables      AS dt ON dt.tabid    = dc.tabid
				JOIN    sysindices     AS di ON di.idxname  = dc.idxname
				JOIN    sysreferences  AS dr ON dr.constrid = dc.constrid
				JOIN    sysconstraints AS pc ON pc.constrid = dr.primary
				JOIN    systables      AS pt ON pt.tabid    = pc.tabid
				JOIN    sysindices     AS pi ON pi.idxname  = pc.idxname
				WHERE   dc.constrtype = 'R'
				AND     do.objtype = 'C'
				AND     do.state = 'E'
				AND     dt.tabname not like 'sys%'
				AND     dt.tabname not like 'vw%'
				ORDER   BY 2, 1

				LET l_keyid = 1;
				LET l_dcolno = ikeyextractcolno(l_dindexkeys, l_keyid);
				LET l_pcolno = ikeyextractcolno(l_pindexkeys, l_keyid);

				IF l_dcolno != 0 THEN
					SELECT  TRIM(colname)
					INTO    l_dcolname
					FROM    syscolumns
					WHERE   tabid = l_dtabid
					AND     colno = l_dcolno;

					SELECT  TRIM(colname)
					INTO    l_pcolname
					FROM    syscolumns
					WHERE   tabid = l_ptabid
					AND     colno = l_pcolno;

					RETURN l_dtabname, l_dcolname, l_ptabname, l_pcolname, l_constrname WITH RESUME;
				END IF
			END FOREACH;

			FOREACH
				SELECT  dc.constrname,
						TRIM(dt.tabname), dt.tabid, di.indexkeys,
						TRIM(pt.tabname), pt.tabid, pi.indexkeys
				INTO    l_constrname,
						l_dtabname, l_dtabid, l_dindexkeys,
						l_ptabname, l_ptabid, l_pindexkeys
				FROM    sysconstraints AS dc
				JOIN    sysobjstate    AS do ON do.name     = dc.constrname
				JOIN    systables      AS dt ON dt.tabid    = dc.tabid
				JOIN    sysindices     AS di ON di.idxname  = dc.idxname
				JOIN    sysreferences  AS dr ON dr.constrid = dc.constrid
				JOIN    sysconstraints AS pc ON pc.constrid = dr.primary
				JOIN    systables      AS pt ON pt.tabid    = pc.tabid
				JOIN    sysindices     AS pi ON pi.idxname  = pc.idxname
				WHERE   dc.constrtype = 'R'
				AND     do.objtype = 'C'
				AND     do.state = 'E'
				AND     dt.tabname not like 'sys%'
				AND     dt.tabname not like 'vw%'
				ORDER   BY 2, 1

				LET l_keyid = 2;
				LET l_dcolno = ikeyextractcolno(l_dindexkeys, l_keyid);
				LET l_pcolno = ikeyextractcolno(l_pindexkeys, l_keyid);

				IF l_dcolno != 0 THEN
					SELECT  TRIM(colname)
					INTO    l_dcolname
					FROM    syscolumns
					WHERE   tabid = l_dtabid
					AND     colno = l_dcolno;

					SELECT  TRIM(colname)
					INTO    l_pcolname
					FROM    syscolumns
					WHERE   tabid = l_ptabid
					AND     colno = l_pcolno;

					RETURN l_dtabname, l_dcolname, l_ptabname, l_pcolname, l_constrname WITH RESUME;
				END IF
			END FOREACH;
		END FUNCTION;
		`;
		this.knex.raw(storedProcedure);

		// const get_column_default = `
		// DROP FUNCTION IF EXISTS get_column_default;

		// CREATE FUNCTION get_column_default(itabname VARCHAR(128), icolname VARCHAR(128)) RETURNING VARCHAR(128) AS cdefault;

		// DEFINE l_tabname   VARCHAR(128);
		// DEFINE l_colname   VARCHAR(128);
		// DEFINE l_coldefault  VARCHAR(128);

		// SELECT st.tabname, sc.colname,
		// CASE
		// WHEN
		// 	sc.coltype = 0 OR
		// 	sc.coltype = 13 OR
		// 	sc.coltype = 15 OR
		// 	sc.coltype = 16 OR
		// 	sc.coltype = 40 OR
		// 	sc.coltype = 41
		// THEN sd.default
		// ELSE second_string(sd.default)
		// END AS coldefault
		// INTO l_tabname, l_colname, l_coldefault
		// FROM sysdefaults sd, syscolumns sc, systables st
		// WHERE sd.type = 'L' AND sd.tabid = sc.tabid AND sd.colno = sc.colno
		// AND sd.tabid = st.tabid AND st.tabname = itabname AND sc.colname = icolname;

		// RETURN l_coldefault;

		// END FUNCTION;
		// `;

		// this.knex.raw(get_column_default);

		// const second_string = `
		// DROP FUNCTION IF EXISTS second_string;

		// CREATE PROCEDURE second_string(input CHAR(256)) RETURNING CHAR(256);

		// DEFINE var1 CHAR(256);
		// DEFINE var2 INT;
		// LET var1 = input;
		// LET var2 = 1;
		// 	WHILE var2 = 1
		// 	IF substr(var1, 0, 1) = ' '
		// 		THEN RETURN substr(var1, 2);
		// 	END IF;
		// 	LET var1 = substr(var1, 2);
		// 	END WHILE;
		// END PROCEDURE;
		// `;

		// this.knex.raw(second_string);

		// const is_primary_key = `
		// CREATE FUNCTION is_primary_key(itabname VARCHAR(128), icolname VARCHAR(128))
		// 	RETURNING INTEGER AS ispri;

		// DEFINE l_dtabname   VARCHAR(128);
		// DEFINE l_dcolname   VARCHAR(128);
		// DEFINE l_colkey     VARCHAR(128);

		// FOREACH
		// select st.tabname as table_name,
		// scol.colname as column_name,
		// CASE
		// 	WHEN scol.colname IN
		// 	(
		// 	select unique
		// 		(select c.colname from syscolumns c where c.tabid = i.tabid and c.colno = i.part1)
		// 		from sysindexes i , systables t
		// 			where i.tabid = t.tabid
		// 			and t.tabname = st.tabname
		// 			and idxname in
		// 	(
		// 		select c.idxname as pk_idx
		// 		from sysconstraints c, systables t,
		// 		outer (sysreferences r, systables t2, sysconstraints c2)
		// 		where t.tabname = st.tabname
		// 		and t.tabid = c.tabid
		// 		and r.constrid = c.constrid
		// 		and t2.tabid = r.ptabid
		// 		and c2.constrid = r.constrid
		// 		AND c.constrtype = 'P'
		// 	)
		// 	) THEN 'PRI'
		// 	WHEN scol.colname IN
		// 	(
		// 	select unique
		// 		(select c.colname from syscolumns c where c.tabid = i.tabid and c.colno = i.part2)
		// 		from sysindexes i , systables t
		// 			where i.tabid = t.tabid
		// 			and t.tabname = st.tabname
		// 			and idxname in
		// 	(
		// 		select c.idxname as pk_idx
		// 		from sysconstraints c, systables t,
		// 		outer (sysreferences r, systables t2, sysconstraints c2)
		// 		where t.tabname = st.tabname
		// 		and t.tabid = c.tabid
		// 		and r.constrid = c.constrid
		// 		and t2.tabid = r.ptabid
		// 		and c2.constrid = r.constrid
		// 		AND c.constrtype = 'P'
		// 	)
		// 	) THEN 'PRI'
		// 	WHEN scol.colname IN
		// 	(
		// 	select unique
		// 		(select c.colname from syscolumns c where c.tabid = i.tabid and c.colno = i.part3)
		// 		from sysindexes i , systables t
		// 			where i.tabid = t.tabid
		// 			and t.tabname = st.tabname
		// 			and idxname in
		// 	(
		// 		select c.idxname as pk_idx
		// 		from sysconstraints c, systables t,
		// 		outer (sysreferences r, systables t2, sysconstraints c2)
		// 		where t.tabname = st.tabname
		// 		and t.tabid = c.tabid
		// 		and r.constrid = c.constrid
		// 		and t2.tabid = r.ptabid
		// 		and c2.constrid = r.constrid
		// 		AND c.constrtype = 'P'
		// 	)
		// 	) THEN 'PRI'
		// END AS column_key
		// INTO l_dtabname, l_dcolname, l_colkey
		// from systables st, syscolumns scol, outer sysdefaults sdef
		// where st.tabid = scol.tabid
		// 	and scol.tabid = sdef.tabid and scol.colno = sdef.colno
		// 	and tabname = itabname
		// 	and colname = icolname

		// IF l_colkey == 'PRI' THEN
		// 	RETURN 1;
		// ELSE
		// 	RETURN 0;
		// END IF

		// END FOREACH;

		// END FUNCTION;
		// `;

		// this.knex.raw(is_primary_key);

		// const sp_allconst = `
		// DROP FUNCTION IF EXISTS sp_allinfo;

		// CREATE FUNCTION sp_allinfo() RETURNING VARCHAR(128) AS dtabname,
		// 									VARCHAR(128) AS dcolname,
		// 									VARCHAR(128) AS ctabname,
		// 									VARCHAR(128) AS ccolname,
		// 									VARCHAR(128) AS cname;

		// 	DEFINE l_constrname VARCHAR(128);

		// 	DEFINE l_dtabname   VARCHAR(128);
		// 	DEFINE l_ptabname   VARCHAR(128);
		// 	DEFINE t_tabname    VARCHAR(128);

		// 	DEFINE l_dtabid     LIKE systables.tabid;
		// 	DEFINE l_ptabid     LIKE systables.tabid;
		// 	DEFINE t_tabid      LIKE systables.tabid;

		// 	DEFINE l_dindexkeys LIKE sysindices.indexkeys;
		// 	DEFINE l_pindexkeys LIKE sysindices.indexkeys;

		// 	DEFINE l_dcolno     LIKE syscolumns.colno;
		// 	DEFINE l_pcolno     LIKE syscolumns.colno;
		// 	DEFINE t_colno     LIKE syscolumns.colno;

		// 	DEFINE l_dcolname   VARCHAR(128);
		// 	DEFINE l_pcolname   VARCHAR(128);
		// 	DEFINE t_colname   VARCHAR(128);

		// 	DEFINE l_keyid      SMALLINT;

		// 	DEFINE l_ccnt       SMALLINT;

		// 	FOREACH
		// 	SELECT st.tabid, st.tabname, sc.colno, sc.colname
		// 	INTO t_tabid, t_tabname, t_colno, t_colname
		// 	FROM systables AS st
		// 	JOIN syscolumns AS sc ON st.tabid = sc.tabid
		// 	WHERE   st.tabname not like 'sys%'
		// 	AND     st.tabname not like 'vw%'

		// 	LET l_ccnt = 0;
		// 	FOREACH

		// 		SELECT  dc.constrname,
		// 				TRIM(dt.tabname), dt.tabid, di.indexkeys,
		// 				TRIM(pt.tabname), pt.tabid, pi.indexkeys
		// 		INTO    l_constrname,
		// 				l_dtabname, l_dtabid, l_dindexkeys,
		// 				l_ptabname, l_ptabid, l_pindexkeys
		// 		FROM    systables      AS dt
		// 		LEFT JOIN    sysconstraints AS dc ON dc.tabid    = dt.tabid
		// 		LEFT JOIN    sysobjstate    AS do ON do.name     = dc.constrname
		// 		LEFT JOIN    sysindices     AS di ON di.idxname  = dc.idxname
		// 		LEFT JOIN    sysreferences  AS dr ON dr.constrid = dc.constrid
		// 		LEFT JOIN    sysconstraints AS pc ON pc.constrid = dr.primary
		// 		JOIN    systables      AS pt ON pt.tabid    = pc.tabid
		// 		LEFT JOIN    sysindices     AS pi ON pi.idxname  = pc.idxname
		// 		WHERE dt.tabid = t_tabid

		// 		LET l_keyid = 0;

		// 		LET l_dcolno = ikeyextractcolno(l_dindexkeys, l_keyid);
		// 		LET l_pcolno = ikeyextractcolno(l_pindexkeys, l_keyid);

		// 		IF l_dcolno != 0 AND l_dcolno == t_colno THEN

		// 		SELECT  TRIM(colname)
		// 		INTO    l_dcolname
		// 		FROM    syscolumns
		// 		WHERE   tabid = l_dtabid
		// 		AND     colno = l_dcolno;

		// 		SELECT  TRIM(colname)
		// 		INTO    l_pcolname
		// 		FROM    syscolumns
		// 		WHERE   tabid = l_ptabid
		// 		AND     colno = l_pcolno;

		// 		IF l_dcolname == t_colname THEN
		// 			LET l_ccnt = l_ccnt + 1;
		// 			RETURN l_dtabname, l_dcolname, l_ptabname, l_pcolname, l_constrname WITH RESUME;
		// 		END IF
		// 		END IF
		// 	END FOREACH;

		// 	FOREACH

		// 		SELECT  dc.constrname,
		// 				TRIM(dt.tabname), dt.tabid, di.indexkeys,
		// 				TRIM(pt.tabname), pt.tabid, pi.indexkeys
		// 		INTO    l_constrname,
		// 				l_dtabname, l_dtabid, l_dindexkeys,
		// 				l_ptabname, l_ptabid, l_pindexkeys
		// 		FROM    systables      AS dt
		// 		LEFT JOIN    sysconstraints AS dc ON dc.tabid    = dt.tabid
		// 		LEFT JOIN    sysobjstate    AS do ON do.name     = dc.constrname
		// 		LEFT JOIN    sysindices     AS di ON di.idxname  = dc.idxname
		// 		LEFT JOIN    sysreferences  AS dr ON dr.constrid = dc.constrid
		// 		LEFT JOIN    sysconstraints AS pc ON pc.constrid = dr.primary
		// 		JOIN    systables      AS pt ON pt.tabid    = pc.tabid
		// 		LEFT JOIN    sysindices     AS pi ON pi.idxname  = pc.idxname
		// 		WHERE dt.tabid = t_tabid

		// 		LET l_keyid = 1;

		// 		LET l_dcolno = ikeyextractcolno(l_dindexkeys, l_keyid);
		// 		LET l_pcolno = ikeyextractcolno(l_pindexkeys, l_keyid);

		// 		IF l_dcolno != 0 AND l_dcolno == t_colno THEN

		// 		SELECT  TRIM(colname)
		// 		INTO    l_dcolname
		// 		FROM    syscolumns
		// 		WHERE   tabid = l_dtabid
		// 		AND     colno = l_dcolno;

		// 		SELECT  TRIM(colname)
		// 		INTO    l_pcolname
		// 		FROM    syscolumns
		// 		WHERE   tabid = l_ptabid
		// 		AND     colno = l_pcolno;

		// 		IF l_dcolname == t_colname THEN
		// 			LET l_ccnt = l_ccnt + 1;
		// 			RETURN l_dtabname, l_dcolname, l_ptabname, l_pcolname, l_constrname WITH RESUME;
		// 		END IF
		// 		END IF
		// 	END FOREACH;

		// 	FOREACH

		// 		SELECT  dc.constrname,
		// 				TRIM(dt.tabname), dt.tabid, di.indexkeys,
		// 				TRIM(pt.tabname), pt.tabid, pi.indexkeys
		// 		INTO    l_constrname,
		// 				l_dtabname, l_dtabid, l_dindexkeys,
		// 				l_ptabname, l_ptabid, l_pindexkeys
		// 		FROM    systables      AS dt
		// 		LEFT JOIN    sysconstraints AS dc ON dc.tabid    = dt.tabid
		// 		LEFT JOIN    sysobjstate    AS do ON do.name     = dc.constrname
		// 		LEFT JOIN    sysindices     AS di ON di.idxname  = dc.idxname
		// 		LEFT JOIN    sysreferences  AS dr ON dr.constrid = dc.constrid
		// 		LEFT JOIN    sysconstraints AS pc ON pc.constrid = dr.primary
		// 		JOIN    systables      AS pt ON pt.tabid    = pc.tabid
		// 		LEFT JOIN    sysindices     AS pi ON pi.idxname  = pc.idxname
		// 		WHERE dt.tabid = t_tabid

		// 		LET l_keyid = 2;

		// 		LET l_dcolno = ikeyextractcolno(l_dindexkeys, l_keyid);
		// 		LET l_pcolno = ikeyextractcolno(l_pindexkeys, l_keyid);

		// 		IF l_dcolno != 0 AND l_dcolno == t_colno THEN

		// 		SELECT  TRIM(colname)
		// 		INTO    l_dcolname
		// 		FROM    syscolumns
		// 		WHERE   tabid = l_dtabid
		// 		AND     colno = l_dcolno;

		// 		SELECT  TRIM(colname)
		// 		INTO    l_pcolname
		// 		FROM    syscolumns
		// 		WHERE   tabid = l_ptabid
		// 		AND     colno = l_pcolno;

		// 		IF l_dcolname == t_colname THEN
		// 			LET l_ccnt = l_ccnt + 1;
		// 			RETURN l_dtabname, l_dcolname, l_ptabname, l_pcolname, l_constrname WITH RESUME;
		// 		END IF
		// 		END IF
		// 	END FOREACH;

		// 	IF l_ccnt == 0 THEN
		// 		RETURN t_tabname, t_colname, '', '', '' WITH RESUME;
		// 	END IF

		// 	END FOREACH;

		// END FUNCTION;
		// `;

		// this.knex.raw(sp_allconst);

		// let query = `
		// SELECT table as TABLE_NAME,
		// column as COLUMN_NAME,
		// get_column_default( st.tabname, sc.colname ) as COLUMN_DEFAULT,
		// CASE
		// WHEN is_primary_key( st.tabname, sc.colname ) == 1 THEN 'PRI'
		// WHEN is_primary_key( st.tabname, sc.colname ) == 0 THEN ''
		// END AS COLUMN_KEY,
		// CASE
		// WHEN (sc.coltype = 2) THEN 'int(11)'
		// WHEN (sc.coltype = 3) THEN 'float'
		// WHEN (sc.coltype = 5) THEN 'decimal'
		// WHEN (sc.coltype = 7) THEN 'date'
		// WHEN (sc.coltype = 8) THEN 'money'
		// WHEN (sc.coltype = 10) THEN 'datetime'
		// WHEN (sc.coltype = 15) THEN CONCAT( CONCAT('char(', TO_CHAR(sc.collength)), ')')
		// WHEN (sc.coltype = 16) THEN CONCAT( CONCAT('char(', TO_CHAR(sc.collength)), ')')
		// WHEN (sc.coltype = 40) THEN CONCAT( CONCAT('char(', TO_CHAR(sc.collength)), ')')
		// WHEN (sc.coltype = 256) THEN CONCAT( CONCAT('char(', TO_CHAR(sc.collength)), ')')
		// WHEN (sc.coltype = 258) THEN 'int(11)'
		// WHEN (sc.coltype = 262) THEN 'int(11)'
		// WHEN (sc.coltype = 263) THEN 'date'
		// WHEN (sc.coltype = 266) THEN 'datetime'
		// WHEN (sc.coltype = 271) THEN CONCAT( CONCAT('char(', TO_CHAR(sc.collength)), ')')
		// WHEN (sc.coltype = 272) THEN CONCAT( CONCAT('char(', TO_CHAR(sc.collength)), ')')
		// END AS COLUMN_TYPE,
		// CASE
		// WHEN (sc.coltype = 2) THEN 10
		// WHEN (sc.coltype = 3) THEN 10
		// WHEN (sc.coltype = 5) THEN 10
		// WHEN (sc.coltype = 7) THEN 30
		// WHEN (sc.coltype = 8) THEN 10
		// WHEN (sc.coltype = 10) THEN 30
		// WHEN (sc.coltype = 15) THEN sc.collength
		// WHEN (sc.coltype = 16) THEN sc.collength
		// WHEN (sc.coltype = 40) THEN sc.collength
		// WHEN (sc.coltype = 256) THEN sc.collength
		// WHEN (sc.coltype = 258) THEN 10
		// WHEN (sc.coltype = 262) THEN 10
		// WHEN (sc.coltype = 263) THEN 30
		// WHEN (sc.coltype = 266) THEN 30
		// WHEN (sc.coltype = 271) THEN sc.collength
		// WHEN (sc.coltype = 272) THEN sc.collength
		// END AS CHARCTER_MAXIMUM_LENGTH,
		// CASE
		// WHEN (sc.coltype = 2) THEN 'YES'
		// WHEN (sc.coltype = 3) THEN 'YES'
		// WHEN (sc.coltype = 5) THEN 'YES'
		// WHEN (sc.coltype = 7) THEN 'YES'
		// WHEN (sc.coltype = 8) THEN 'YES'
		// WHEN (sc.coltype = 10) THEN 'YES'
		// WHEN (sc.coltype = 15) THEN 'YES'
		// WHEN (sc.coltype = 16) THEN 'YES'
		// WHEN (sc.coltype = 40) THEN 'YES'
		// WHEN (sc.coltype = 256) THEN 'NO'
		// WHEN (sc.coltype = 258) THEN 'NO'
		// WHEN (sc.coltype = 262) THEN 'NO'
		// WHEN (sc.coltype = 263) THEN 'NO'
		// WHEN (sc.coltype = 266) THEN 'NO'
		// WHEN (sc.coltype = 271) THEN 'NO'
		// WHEN (sc.coltype = 272) THEN 'NO'
		// END AS IS_NULLABLE,
		// CASE
		// WHEN is_primary_key( st.tabname, sc.colname ) == 1 THEN 'PRI'
		// WHEN is_primary_key( st.tabname, sc.colname ) == 0 THEN ''
		// END AS COLUMN_KEY,
		// '' as EXTRA,
		// 'NULL' as COLLATION_NAME,
		// '' as COLUMN_COMMENT,
		// sc.collength as NUMERIC_PRECISION,
		// 'NULL' as GENERATION_EXPRESSION,
		// 0 as NUMERIC_SCALE,
		// foreign_key_table as REFERENCED_TABLE_NAME,
		// foreign_key_column as REFERENCED_COLUMN_NAME, constraint_name,
		// 'RESTRICT' as update_rule, 'RESTRICT' as delete_rule,
		// 'NONE' as MATCH_OPTION
		// FROM syscolumns sc, systables st, TABLE (FUNCTION sp_allinfo())
		// allcinfo( table, column, foreign_key_table, foreign_key_column, constraint_name)
		// WHERE st.tabname = table and sc.tabid = st.tabid and sc.colname = column
		// `;

		let query = `
		SELECT table as TABLE_NAME,
		column as COLUMN_NAME,
		'NULL' as COLUMN_DEFAULT,
		CASE
			WHEN (sc.coltype = 2) THEN 'int(11)'
			WHEN (sc.coltype = 3) THEN 'float'
			WHEN (sc.coltype = 5) THEN 'decimal'
			WHEN (sc.coltype = 7) THEN 'date'
			WHEN (sc.coltype = 8) THEN 'money'
			WHEN (sc.coltype = 10) THEN 'datetime'
			WHEN (sc.coltype = 15) THEN CONCAT( CONCAT('char(', TO_CHAR(sc.collength)), ')')
			WHEN (sc.coltype = 16) THEN CONCAT( CONCAT('char(', TO_CHAR(sc.collength)), ')')
			WHEN (sc.coltype = 40) THEN CONCAT( CONCAT('char(', TO_CHAR(sc.collength)), ')')
			WHEN (sc.coltype = 256) THEN CONCAT( CONCAT('char(', TO_CHAR(sc.collength)), ')')
			WHEN (sc.coltype = 258) THEN 'int(11)'
			WHEN (sc.coltype = 262) THEN 'int(11)'
			WHEN (sc.coltype = 263) THEN 'date'
			WHEN (sc.coltype = 266) THEN 'datetime'
			WHEN (sc.coltype = 271) THEN CONCAT( CONCAT('char(', TO_CHAR(sc.collength)), ')')
			WHEN (sc.coltype = 272) THEN CONCAT( CONCAT('char(', TO_CHAR(sc.collength)), ')')
		END AS COLUMN_TYPE,
		CASE
			WHEN (sc.coltype = 2) THEN 10
			WHEN (sc.coltype = 3) THEN 10
			WHEN (sc.coltype = 5) THEN 10
			WHEN (sc.coltype = 7) THEN 30
			WHEN (sc.coltype = 8) THEN 10
			WHEN (sc.coltype = 10) THEN 30
			WHEN (sc.coltype = 15) THEN sc.collength
			WHEN (sc.coltype = 16) THEN sc.collength
			WHEN (sc.coltype = 40) THEN sc.collength
			WHEN (sc.coltype = 256) THEN sc.collength
			WHEN (sc.coltype = 258) THEN 10
			WHEN (sc.coltype = 262) THEN 10
			WHEN (sc.coltype = 263) THEN 30
			WHEN (sc.coltype = 266) THEN 30
			WHEN (sc.coltype = 271) THEN sc.collength
			WHEN (sc.coltype = 272) THEN sc.collength
		END AS CHARACTER_MAXIMUM_LENGTH,
		CASE
			WHEN (sc.coltype = 2) THEN 'YES'
			WHEN (sc.coltype = 3) THEN 'YES'
			WHEN (sc.coltype = 5) THEN 'YES'
			WHEN (sc.coltype = 7) THEN 'YES'
			WHEN (sc.coltype = 8) THEN 'YES'
			WHEN (sc.coltype = 10) THEN 'YES'
			WHEN (sc.coltype = 15) THEN 'YES'
			WHEN (sc.coltype = 16) THEN 'YES'
			WHEN (sc.coltype = 40) THEN 'YES'
			WHEN (sc.coltype = 256) THEN 'NO'
			WHEN (sc.coltype = 258) THEN 'NO'
			WHEN (sc.coltype = 262) THEN 'NO'
			WHEN (sc.coltype = 263) THEN 'NO'
			WHEN (sc.coltype = 266) THEN 'NO'
			WHEN (sc.coltype = 271) THEN 'NO'
			WHEN (sc.coltype = 272) THEN 'NO'
		END AS IS_NULLABLE,
		'PRI' as COLUMN_KEY,
		'' as EXTRA,
		'NULL' as COLLATION_NAME,
		'' as COLUMN_COMMENT,
		sc.collength as NUMERIC_PRECISION,
		'NULL' as GENERATION_EXPRESSION,
		0 as NUMERIC_SCALE,
		foreign_key_table as REFERENCED_TABLE_NAME,
		foreign_key_column as REFERENCED_COLUMN_NAME, CONSTRAINT_NAME,
		'RESTRICT' as UPDATE_RULE, 'RESTRICT' as DELETE_RULE,
		'NONE' as MATCH_OPTION
		FROM syscolumns sc, systables st, TABLE (FUNCTION sp_allinfo())
		allcinfo(table, column, foreign_key_table, foreign_key_column, constraint_name)
		WHERE st.tabname = table and sc.tabid = st.tabid and sc.colname = column
		`;

		if (table) {
			query += `
				and table = '${table}'
			`;
		}

		if (column) {
			query += `
				and column = '${column}'
			`;
			// AND column = '${column}' ORDER BY 1,14,15
			const rawColumn: RawColumn = await this.knex.raw(query);
			return rawColumnToColumn(rawColumn);
		}

		// query += 'ORDER BY 1,14,15';

		const res: RawColumn[][] = await this.knex.raw(query);
		const records: RawColumn[] = res[0];

		return records
			.map((column) => rawColumnToColumn(column))
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
				tabname: table,
				colname: column,
			});

		return !!(result && result.count);
	}

	/**
	 * Get the primary key column for the given table
	 */
	async primary(table: string) {
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
		this.knex.raw(
			`DROP FUNCTION IF EXISTS sp_allconst;

			CREATE FUNCTION sp_allconst() RETURNING VARCHAR(128) AS dtabname,
													VARCHAR(128) AS dcolname,
													VARCHAR(128) AS ctabname,
													VARCHAR(128) AS ccolname,
													VARCHAR(128) AS cname;

				DEFINE l_constrname VARCHAR(128);

				DEFINE l_dtabname   VARCHAR(128);
				DEFINE l_ptabname   VARCHAR(128);

				DEFINE l_dtabid     LIKE systables.tabid;
				DEFINE l_ptabid     LIKE systables.tabid;

				DEFINE l_dindexkeys LIKE sysindices.indexkeys;
				DEFINE l_pindexkeys LIKE sysindices.indexkeys;

				DEFINE l_dcolno     LIKE syscolumns.colno;
				DEFINE l_pcolno     LIKE syscolumns.colno;

				DEFINE l_dcolname   VARCHAR(128);
				DEFINE l_pcolname   VARCHAR(128);

				DEFINE l_keyid      SMALLINT;

				FOREACH

					SELECT  dc.constrname,
							TRIM(dt.tabname), dt.tabid, di.indexkeys,
							TRIM(pt.tabname), pt.tabid, pi.indexkeys
					INTO    l_constrname,
							l_dtabname, l_dtabid, l_dindexkeys,
							l_ptabname, l_ptabid, l_pindexkeys
					FROM    sysconstraints AS dc
					JOIN    sysobjstate    AS do ON do.name     = dc.constrname
					JOIN    systables      AS dt ON dt.tabid    = dc.tabid
					JOIN    sysindices     AS di ON di.idxname  = dc.idxname
					JOIN    sysreferences  AS dr ON dr.constrid = dc.constrid
					JOIN    sysconstraints AS pc ON pc.constrid = dr.primary
					JOIN    systables      AS pt ON pt.tabid    = pc.tabid
					JOIN    sysindices     AS pi ON pi.idxname  = pc.idxname
					WHERE   dc.constrtype = 'R'
					AND     do.objtype = 'C'
					AND     do.state = 'E'
					AND     dt.tabname not like 'sys%'
					AND     dt.tabname not like 'vw%'
					ORDER   BY 2, 1

					FOR l_keyid = 0 TO 15

						LET l_dcolno = ikeyextractcolno(l_dindexkeys, l_keyid);
						LET l_pcolno = ikeyextractcolno(l_pindexkeys, l_keyid);

						IF l_dcolno = 0 THEN
							EXIT FOR;
						END IF;

						SELECT  TRIM(colname)
						INTO    l_dcolname
						FROM    syscolumns
						WHERE   tabid = l_dtabid
						AND     colno = l_dcolno;

						SELECT  TRIM(colname)
						INTO    l_pcolname
						FROM    syscolumns
						WHERE   tabid = l_ptabid
						AND     colno = l_pcolno;

					END FOR;

					FOR l_keyid = 0 TO 15

						LET l_dcolno = ikeyextractcolno(l_dindexkeys, l_keyid);

						IF l_dcolno = 0 THEN
							EXIT FOR;
						END IF;

						SELECT  TRIM(colname)
						INTO    l_dcolname
						FROM    syscolumns
						WHERE   tabid = l_dtabid
						AND     colno = l_dcolno;

					END FOR;

					RETURN l_dtabname, l_dcolname, l_ptabname, l_pcolname, l_constrname WITH RESUME;

				END FOREACH;

			END FUNCTION;`
		);

		let sql = `
		SELECT table, column, foreign_key_table, foreign_key_column, constraint_name,
		'R' AS update_rule, 'R' AS delete_rule
		FROM TABLE (FUNCTION sp_allconst()) 
		allconstraints( table, column, foreign_key_table, foreign_key_column, constraint_name)
	`;

		if (table) {
			sql += ` WHERE table = '${table}'`;
		}

		const query = this.knex.raw(sql);
		const raw_result = await query;
		const result: ForeignKey[] = raw_result[0];
		return result;
	}
}
