/**
 * @fileoverview Unit tests for StorageFactory legacy compatibility handling
 */

import { describe, expect, it } from 'vitest';
import type { IConfiguration } from '../../../common/interfaces/configuration.interface.js';
import { StorageFactory } from './storage-factory.js';

describe('StorageFactory', () => {
	describe('legacy storage type compatibility', () => {
		it('maps legacy local storage type to file storage in create()', async () => {
			const legacyConfig = {
				storage: {
					type: 'local'
				}
			} as unknown as Partial<IConfiguration>;
			const storage = await StorageFactory.create(legacyConfig, '/tmp/project');

			expect(storage.getStorageType()).toBe('file');
		});

		it('treats legacy local storage type as valid in validateStorageConfig()', () => {
			const legacyConfig = {
				storage: {
					type: 'local'
				}
			} as unknown as Partial<IConfiguration>;
			const result = StorageFactory.validateStorageConfig(legacyConfig);

			expect(result).toEqual({
				isValid: true,
				errors: []
			});
		});
	});
});
