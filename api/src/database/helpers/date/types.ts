import { DatabaseHelper } from '../types';
import { parseISO } from 'date-fns';

export abstract class DateHelper extends DatabaseHelper {
	parse(date: string | Date): string {
		// Date generated from NOW()
		if (process.env.DB_CLIENT === '@etisoftware/knex-informix-dialect') {
			if (typeof date === 'string') {
				return date.replace('T', ' ').replace('Z', '');
			} else {
				return date.toISOString().replace('T', ' ').replace('Z', '');
			}
		}
		if (date instanceof Date) {
			return date.toISOString();
		}
		return date;
	}
	readTimestampString(date: string): string {
		return date;
	}
	writeTimestamp(date: string): Date {
		return parseISO(date);
	}
	fieldFlagForField(_fieldType: string): string {
		return '';
	}
}
