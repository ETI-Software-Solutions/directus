import { GeometryHelper } from '../types';
import type { Knex } from 'knex';

export class GeometryHelperInformixDB extends GeometryHelper {
	collect(table: string, column: string): Knex.Raw {
		return this.knex.raw(
			`concat('geometrycollection(', group_concat(? separator ', '), ')'`,
			this.asText(table, column)
		);
	}
	fromText(text: string): Knex.Raw {
		return this.knex.raw('st_geomfromtext(?)', text);
	}
	asGeoJSON(table: string, column: string): Knex.Raw {
		return this.knex.raw('st_asgeojson(??.??) as ??', [table, column, column]);
	}
}
