import { FnHelper, FnHelperOptions } from '../types';
import { Knex } from 'knex';

export class FnHelperInformixDB extends FnHelper {
	year(table: string, column: string): Knex.Raw {
		return this.knex.raw('YEAR(??.??)', [table, column]);
	}

	month(table: string, column: string): Knex.Raw {
		return this.knex.raw('MONTH(??.??)', [table, column]);
	}

	week(table: string, column: string): Knex.Raw {
		return this.knex.raw('WEEK(??.??)', [table, column]);
	}

	day(table: string, column: string): Knex.Raw {
		return this.knex.raw('DAY(??.??)', [table, column]);
	}

	weekday(table: string, column: string): Knex.Raw {
		return this.knex.raw('WEEKDAY(??.??)', [table, column]);
	}

	hour(table: string, column: string): Knex.Raw {
		return this.knex.raw('EXTEND(??.??, HOUR TO HOUR)::INT', [table, column]);
	}

	minute(table: string, column: string): Knex.Raw {
		return this.knex.raw('EXTEND(??.??, MINUTE TO MINUTE)::INT', [table, column]);
	}

	second(table: string, column: string): Knex.Raw {
		return this.knex.raw('EXTEND(??.??, SECOND TO SECOND)::INT', [table, column]);
	}

	count(table: string, column: string, options?: FnHelperOptions): Knex.Raw {
		const collectionName = options?.originalCollectionName || table;
		const type = this.schema.collections?.[collectionName]?.fields?.[column]?.type ?? 'unknown';

		if (type === 'json') {
			return this.knex.raw('JSON_LENGTH(??.??)', [table, column]);
		}

		if (type === 'alias') {
			return this._relationalCount(table, column, options);
		}

		throw new Error(`Couldn't extract type from ${table}.${column}`);
	}
}
