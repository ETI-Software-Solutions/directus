import express from 'express';
import { ForbiddenException } from '../exceptions';
import { respond } from '../middleware/respond';
import useCollection from '../middleware/use-collection';
import { validateBatch } from '../middleware/validate-batch';
import { MetaService, WebhooksService } from '../services';
import { PrimaryKey } from '../types';
import asyncHandler from '../utils/async-handler';
import { sanitizeQuery } from '../utils/sanitize-query';

const router = express.Router();

router.use(useCollection('directus_webhooks'));

router.post(
	'/',
	asyncHandler(async (req, res, next) => {
		const service = new WebhooksService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const savedKeys: PrimaryKey[] = [];

		let payload;

		if (Array.isArray(req.body)) {
			const keys = await service.createMany(req.body);
			savedKeys.push(...keys);
		} else {
			if (req.body.headers && Array.isArray(req.body.headers)) {
				payload = {
					...req.body,
					headers: {
						data: req.body.headers,
					},
				};
			} else {
				payload = req.body;
			}

			const key = await service.createOne(payload);
			savedKeys.push(key);
		}

		try {
			if (Array.isArray(req.body)) {
				const items = await service.readMany(savedKeys, req.sanitizedQuery);
				res.locals.payload = { data: items };
			} else {
				const item = await service.readOne(savedKeys[0], req.sanitizedQuery);
				let result;
				// @ts-ignore
				if (item.headers && Array.isArray(item.headers.data)) {
					result = {
						...item,
						// @ts-ignore
						headers: item.headers.data,
					};
				} else {
					result = item;
				}

				res.locals.payload = { data: result };
			}
		} catch (error: any) {
			if (error instanceof ForbiddenException) {
				return next();
			}

			throw error;
		}

		return next();
	}),
	respond
);

const readHandler = asyncHandler(async (req, res, next) => {
	const service = new WebhooksService({
		accountability: req.accountability,
		schema: req.schema,
	});
	const metaService = new MetaService({
		accountability: req.accountability,
		schema: req.schema,
	});

	const records = await service.readByQuery(req.sanitizedQuery);
	const meta = await metaService.getMetaForQuery(req.collection, req.sanitizedQuery);

	res.locals.payload = { data: records || null, meta };
	return next();
});

router.get('/', validateBatch('read'), readHandler, respond);
router.search('/', validateBatch('read'), readHandler, respond);

router.get(
	'/:pk',
	asyncHandler(async (req, res, next) => {
		const service = new WebhooksService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const record = await service.readOne(req.params.pk, req.sanitizedQuery);

		let result;
		// @ts-ignore
		if (record.headers && Array.isArray(record.headers.data)) {
			result = {
				...record,
				// @ts-ignore
				headers: record.headers.data,
			};
		} else {
			result = record;
		}

		res.locals.payload = { data: result || null };
		return next();
	}),
	respond
);

router.patch(
	'/',
	validateBatch('update'),
	asyncHandler(async (req, res, next) => {
		const service = new WebhooksService({
			accountability: req.accountability,
			schema: req.schema,
		});

		let keys: PrimaryKey[] = [];

		if (req.body.keys) {
			keys = await service.updateMany(req.body.keys, req.body.data);
		} else {
			const sanitizedQuery = sanitizeQuery(req.body.query, req.accountability);
			keys = await service.updateByQuery(sanitizedQuery, req.body.data);
		}

		try {
			const result = await service.readMany(keys, req.sanitizedQuery);
			res.locals.payload = { data: result };
		} catch (error: any) {
			if (error instanceof ForbiddenException) {
				return next();
			}

			throw error;
		}

		return next();
	}),
	respond
);

router.patch(
	'/:pk',
	asyncHandler(async (req, res, next) => {
		const service = new WebhooksService({
			accountability: req.accountability,
			schema: req.schema,
		});

		let payload;

		if (req.body.headers && Array.isArray(req.body.headers)) {
			payload = {
				...req.body,
				headers: {
					data: req.body.headers,
				},
			};
		} else {
			payload = req.body;
		}

		const primaryKey = await service.updateOne(req.params.pk, payload);

		try {
			const item = await service.readOne(primaryKey, req.sanitizedQuery);

			let result;
			// @ts-ignore
			if (item.headers && Array.isArray(item.headers.data)) {
				result = {
					...item,
					// @ts-ignore
					headers: item.headers.data,
				};
			} else {
				result = item;
			}

			res.locals.payload = { data: result || null };
		} catch (error: any) {
			if (error instanceof ForbiddenException) {
				return next();
			}

			throw error;
		}

		return next();
	}),
	respond
);

router.delete(
	'/',
	asyncHandler(async (req, res, next) => {
		const service = new WebhooksService({
			accountability: req.accountability,
			schema: req.schema,
		});

		if (Array.isArray(req.body)) {
			await service.deleteMany(req.body);
		} else if (req.body.keys) {
			await service.deleteMany(req.body.keys);
		} else {
			const sanitizedQuery = sanitizeQuery(req.body.query, req.accountability);
			await service.deleteByQuery(sanitizedQuery);
		}

		return next();
	}),
	respond
);

router.delete(
	'/:pk',
	asyncHandler(async (req, res, next) => {
		const service = new WebhooksService({
			accountability: req.accountability,
			schema: req.schema,
		});

		await service.deleteOne(req.params.pk);

		return next();
	}),
	respond
);

export default router;
