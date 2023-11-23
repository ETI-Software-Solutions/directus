import KnexInformixDB, { parseDefaultValue } from '../schema/informixdb';
import { SchemaOverview } from '../types/overview';
import { SchemaInspector } from '../types/schema';

export default class InformixDB extends KnexInformixDB implements SchemaInspector {
	async overview(): Promise<SchemaOverview> {
		const columns = await this.knex.raw(
			`
			select st.tabname as table_name,
			scol.colname as column_name,
			sdef.default as default_value,
			CASE
				WHEN (scol.coltype = 0 OR scol.coltype = 256) THEN 'CHAR'
				WHEN (scol.coltype = 1 OR scol.coltype = 257) THEN 'SMALLINT'
				WHEN (scol.coltype = 2 OR scol.coltype = 258) THEN 'INTEGER'
				WHEN (scol.coltype = 3 OR scol.coltype = 259) THEN 'FLOAT'
				WHEN (scol.coltype = 4 OR scol.coltype = 260) THEN 'SMALLFLOAT'
				WHEN (scol.coltype = 5 OR scol.coltype = 261) THEN 'DECIMAL'
				WHEN (scol.coltype = 6 OR scol.coltype = 262) THEN 'SERIAL'
				WHEN (scol.coltype = 7 OR scol.coltype = 263) THEN 'DATE'
				WHEN (scol.coltype = 8 OR scol.coltype = 264) THEN 'MONEY'
				WHEN (scol.coltype = 10 OR scol.coltype = 266) THEN 'DATETIME' 
				WHEN (scol.coltype = 11 OR scol.coltype = 267) THEN 'BYTE'
				WHEN (scol.coltype = 12 OR scol.coltype = 268) THEN 'TEXT'
				WHEN (scol.coltype = 13 OR scol.coltype = 269) THEN 'VARCHAR'
				WHEN (scol.coltype = 14 OR scol.coltype = 270) THEN 'INTERVAL'
				WHEN (scol.coltype = 15 OR scol.coltype = 271) THEN 'NCHAR'
				WHEN (scol.coltype = 16 OR scol.coltype = 272) THEN 'NVARCHAR'
				WHEN (scol.coltype = 17 OR scol.coltype = 273) THEN 'INT8'
				WHEN (scol.coltype = 40 OR scol.coltype = 296) THEN 'JSON'
				WHEN (scol.coltype = 41 OR scol.coltype = 297) THEN 'BOOLEAN'
				WHEN (scol.coltype = 52 OR scol.coltype = 308) THEN 'BIGINT'
			END AS data_type,
			CASE
				WHEN (scol.coltype < 256) THEN 'YES'
				WHEN (scol.coltype >= 256) THEN 'NO'
			END AS is_nullable,
			scol.collength as max_length,
			CASE
			  WHEN scol.colname IN
			  (
				select unique
				  (select c.colname from syscolumns c where c.tabid = i.tabid and c.colno = i.part1)
				   from sysindexes i, systables t
					  where i.tabid = t.tabid
						and t.tabname = st.tabname
						and idxname in
				(
				  select c.idxname as pk_idx
				  from sysconstraints c, systables t,
				  outer (sysreferences r, systables t2, sysconstraints c2)
				  where t.tabname = st.tabname
					and t.tabid = c.tabid
					and r.constrid = c.constrid
					and t2.tabid = r.ptabid
					and c2.constrid = r.constrid
					AND c.constrtype = 'P'
				)
			  ) THEN 'PRI'
			  WHEN scol.colname IN
			  (
				select unique
				  (select c.colname from syscolumns c where c.tabid = i.tabid and c.colno = i.part2)
				   from sysindexes i, systables t
					  where i.tabid = t.tabid
						and t.tabname = st.tabname
						and idxname in
				(
				  select c.idxname as pk_idx
				  from sysconstraints c, systables t,
				  outer (sysreferences r, systables t2, sysconstraints c2)
				  where t.tabname = st.tabname
					and t.tabid = c.tabid
					and r.constrid = c.constrid
					and t2.tabid = r.ptabid
					and c2.constrid = r.constrid
					AND c.constrtype = 'P'
				)
			  ) THEN 'PRI'
			  WHEN scol.colname IN
			  (
				select unique
				  (select c.colname from syscolumns c where c.tabid = i.tabid and c.colno = i.part3)
				   from sysindexes i, systables t
					  where i.tabid = t.tabid
						and t.tabname = st.tabname
						and idxname in
				(
				  select c.idxname as pk_idx
				  from sysconstraints c, systables t,
				  outer (sysreferences r, systables t2, sysconstraints c2)
				  where t.tabname = st.tabname
					and t.tabid = c.tabid
					and r.constrid = c.constrid
					and t2.tabid = r.ptabid
					and c2.constrid = r.constrid
					AND c.constrtype = 'P'
				)
			  ) THEN 'PRI'
			  WHEN scol.colname IN
			  (
				select unique
				   (select c.colname from syscolumns c
					where c.tabid = i.tabid and c.colno = i.part1
				   )
				  from sysindexes i, systables t
				  where i.tabid = t.tabid
					and t.tabname = st.tabname
					and idxtype = 'U'
			  ) THEN 'UNI'
			END AS column_key
			from systables st, syscolumns scol, outer sysdefaults sdef
			where st.tabid = scol.tabid
			and scol.tabid = sdef.tabid and scol.colno = sdef.colno
			and tabname not like 'vw_%'
			and tabname not like 'sys%'
			order by tabname, column_name
			`
		);

		const overview: SchemaOverview = {};

		for (const column of columns[0]) {
			if (column.table_name in overview === false) {
				const primaryKeys = columns[0].filter((nested: { column_key: string; table_name: string }) => {
					return nested.table_name === column.table_name && nested.column_key === 'PRI';
				});
				overview[column.table_name] = {
					primary: primaryKeys.length !== 1 ? undefined : primaryKeys[0].column_name,
					columns: {},
				};
			}

			let dataType = '';
			if (column.data_type) {
				dataType = column.data_type.replace(/\(.*?\)/, '');
			}

			overview[column.table_name].columns[column.column_name] = {
				...column,
				default_value: parseDefaultValue(column.default_value),
				is_nullable: column.is_nullable === 'YES',
				is_generated: false,
				data_type: dataType,
			};
		}

		return overview;
	}
}
