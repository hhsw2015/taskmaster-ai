import { jest } from '@jest/globals';

jest.unstable_mockModule('../../../../../src/utils/path-utils.js', () => ({
	findConfigPath: jest.fn(() => '/mock/project/.taskmaster/config.json')
}));

jest.unstable_mockModule(
	'../../../../../scripts/modules/config-manager.js',
	() => ({
		getConfig: jest.fn(),
		isConfigFilePresent: jest.fn(),
		writeConfig: jest.fn()
	})
);

jest.unstable_mockModule('../../../../../scripts/modules/utils.js', () => ({
	log: jest.fn()
}));

const { getConfig, isConfigFilePresent, writeConfig } = await import(
	'../../../../../scripts/modules/config-manager.js'
);

const setResponseLanguage = (
	await import('../../../../../scripts/modules/task-manager/response-language.js')
).default;

describe('setResponseLanguage', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('should set response language and return success message', () => {
		const config = { global: {} };
		isConfigFilePresent.mockReturnValue(true);
		getConfig.mockReturnValue(config);
		writeConfig.mockReturnValue(true);

		const result = setResponseLanguage(' Chinese ', {
			projectRoot: '/mock/project'
		});

		expect(result.success).toBe(true);
		expect(result.data.responseLanguage).toBe('Chinese');
		expect(result.data.message).toBe('Response language set to Chinese');
		expect(config.global.responseLanguage).toBe('Chinese');
		expect(writeConfig).toHaveBeenCalledWith(config, '/mock/project');
	});

	test('should fail when config file is missing', () => {
		isConfigFilePresent.mockReturnValue(false);

		const result = setResponseLanguage('Chinese', {
			projectRoot: '/mock/project'
		});

		expect(result.success).toBe(false);
		expect(result.error.code).toBe('CONFIG_MISSING');
	});

	test('should fail on empty response language', () => {
		isConfigFilePresent.mockReturnValue(true);

		const result = setResponseLanguage('   ', { projectRoot: '/mock/project' });

		expect(result.success).toBe(false);
		expect(result.error.code).toBe('INVALID_RESPONSE_LANGUAGE');
	});
});
