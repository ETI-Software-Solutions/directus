import type { Knex } from 'knex';

export function now(client: Knex, precision?: string) {
	if (typeof precision === 'number') {
		return client.raw(`current year to fraction(${precision})`);
	}
	return client.raw('current year to fraction');
}
