import { Knex } from 'knex';
import { getHelpers } from '../helpers';
import { now } from './utils';

export async function up(knex: Knex): Promise<void> {
	const helper = getHelpers(knex).schema;

	await helper.changeToType('directus_notifications', 'timestamp', 'timestamp', {
		nullable: true,
		default: now(knex),
	});
}

export async function down(knex: Knex): Promise<void> {
	const helper = getHelpers(knex).schema;

	await helper.changeToType('directus_notifications', 'timestamp', 'timestamp', {
		nullable: false,
	});
}
