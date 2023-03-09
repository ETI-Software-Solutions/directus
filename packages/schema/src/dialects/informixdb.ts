import KnexInformixDB, { parseDefaultValue } from '../schema/informixdb';
import { SchemaOverview } from '../types/overview';
import { SchemaInspector } from '../types/schema';

export default class InformixDB extends KnexInformixDB implements SchemaInspector {
	async overview(): Promise<SchemaOverview> {
		const columns = await this.knex.raw(
			`
			select st.tabname as table_name,
			scol.colname as column_name,
			SUBSTR( sdef.default, CHARINDEX(' ', default)+1 ) as default_value,
			CASE
			  WHEN (scol.coltype = 2) THEN 'INT'
			  WHEN (scol.coltype = 3) THEN 'FLOAT'
			  WHEN (scol.coltype = 5) THEN 'DECIMAL'
			  WHEN (scol.coltype = 7) THEN 'DATE'
			  WHEN (scol.coltype = 8) THEN 'MONEY'
			  WHEN (scol.coltype = 10) THEN 'DATETIME'
			  WHEN (scol.coltype = 15) THEN 'NCHAR'
			  WHEN (scol.coltype = 16) THEN 'NVARCHAR'
			  WHEN (scol.coltype = 40) THEN 'LVARCHAR'
			  WHEN (scol.coltype = 256) THEN 'CHAR'
			  WHEN (scol.coltype = 258) THEN 'INT'
			  WHEN (scol.coltype = 262) THEN 'SERIAL'
			  WHEN (scol.coltype = 263) THEN 'DATE'
			  WHEN (scol.coltype = 266) THEN 'DATETIME'
			  WHEN (scol.coltype = 271) THEN 'NCHAR'
			  WHEN (scol.coltype = 272) THEN 'NVARCHAR'
			END AS data_type,
			CASE
			  WHEN (scol.coltype = 2) THEN 'YES'
			  WHEN (scol.coltype = 3) THEN 'YES'
			  WHEN (scol.coltype = 5) THEN 'YES'
			  WHEN (scol.coltype = 7) THEN 'YES'
			  WHEN (scol.coltype = 8) THEN 'YES'
			  WHEN (scol.coltype = 10) THEN 'YES'
			  WHEN (scol.coltype = 15) THEN 'YES'
			  WHEN (scol.coltype = 16) THEN 'YES'
			  WHEN (scol.coltype = 40) THEN 'YES'
			  WHEN (scol.coltype = 256) THEN 'NO'
			  WHEN (scol.coltype = 258) THEN 'NO'
			  WHEN (scol.coltype = 262) THEN 'NO'
			  WHEN (scol.coltype = 263) THEN 'NO'
			  WHEN (scol.coltype = 266) THEN 'NO'
			  WHEN (scol.coltype = 271) THEN 'NO'
			  WHEN (scol.coltype = 272) THEN 'NO'
			END AS is_nullable,
			scol.collength as max_length,
			CASE
			  WHEN scol.colname IN
			  (
				select unique
				  (select c.colname from syscolumns c where c.tabid = i.tabid and c.colno = i.part1)
				   from sysindexes i , systables t
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
				   from sysindexes i , systables t
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
				   from sysindexes i , systables t
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
				  from sysindexes i , systables t
				  where i.tabid = t.tabid
					and t.tabname = st.tabname
					and idxtype = 'U'
			  ) THEN 'UNI'
			END AS column_key
			`,
			[this.knex.client.database()]
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

			let dataType = column.data_type.replace(/\(.*?\)/, '');
			if (column.data_type.startsWith('tinyint(1)')) {
				dataType = 'boolean';
			}

			overview[column.table_name].columns[column.column_name] = {
				...column,
				default_value: column.extra === 'auto_increment' ? 'AUTO_INCREMENT' : parseDefaultValue(column.default_value),
				is_nullable: column.is_nullable === 'YES',
				is_generated: column.extra?.endsWith('GENERATED') ?? false,
				data_type: dataType,
			};
		}

		return overview;
	}
}
