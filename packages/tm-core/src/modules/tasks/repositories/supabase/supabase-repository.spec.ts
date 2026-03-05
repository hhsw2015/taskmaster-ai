import { describe, expect, it } from 'vitest';
import type { TaskStatus } from '../../../../common/types/index.js';
import { SupabaseRepository } from './supabase-repository.js';

describe('SupabaseRepository status mapping', () => {
	const repository = new SupabaseRepository({} as any);
	const mapStatusToDatabase = (status: string) =>
		(repository as any).mapStatusToDatabase(status);
	const getStatusOverrideForMetadata = (status: string) =>
		(repository as any).getStatusOverrideForMetadata(status) as
			| TaskStatus
			| undefined;

	it('maps extended Taskmaster statuses to supported cloud status values', () => {
		expect(mapStatusToDatabase('pending')).toBe('todo');
		expect(mapStatusToDatabase('deferred')).toBe('todo');
		expect(mapStatusToDatabase('in-progress')).toBe('in_progress');
		expect(mapStatusToDatabase('blocked')).toBe('in_progress');
		expect(mapStatusToDatabase('review')).toBe('in_progress');
		expect(mapStatusToDatabase('done')).toBe('done');
		expect(mapStatusToDatabase('cancelled')).toBe('done');
	});

	it('stores metadata override only for non-native cloud statuses', () => {
		expect(getStatusOverrideForMetadata('blocked')).toBe('blocked');
		expect(getStatusOverrideForMetadata('review')).toBe('review');
		expect(getStatusOverrideForMetadata('deferred')).toBe('deferred');
		expect(getStatusOverrideForMetadata('cancelled')).toBe('cancelled');
		expect(getStatusOverrideForMetadata('pending')).toBeUndefined();
		expect(getStatusOverrideForMetadata('in-progress')).toBeUndefined();
		expect(getStatusOverrideForMetadata('done')).toBeUndefined();
	});

	it('keeps throwing for invalid statuses', () => {
		expect(() => mapStatusToDatabase('unknown-status')).toThrow(
			'Invalid task status'
		);
	});
});
