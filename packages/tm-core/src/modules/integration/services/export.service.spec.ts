import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../../../common/types/index.js';
import type { AuthManager } from '../../auth/managers/auth-manager.js';
import type { ConfigManager } from '../../config/managers/config-manager.js';
import { FileStorage } from '../../storage/adapters/file-storage/index.js';
import { ExportService } from './export.service.js';

vi.mock('../../auth/auth-domain.js', () => ({
	AuthDomain: class {
		getApiBaseUrl() {
			return 'http://localhost:3000';
		}
	}
}));

describe('ExportService language behavior', () => {
	let configManager: ConfigManager;
	let authManager: AuthManager;
	let service: ExportService;

	beforeEach(() => {
		configManager = {
			getResponseLanguage: vi.fn().mockReturnValue('Chinese'),
			getActiveTag: vi.fn().mockReturnValue('master'),
			getProjectRoot: vi.fn().mockReturnValue('/tmp/project')
		} as unknown as ConfigManager;

		authManager = {
			hasValidSession: vi.fn().mockResolvedValue(true),
			getContext: vi.fn().mockResolvedValue({ orgId: 'org-1' }),
			getOrganizations: vi.fn().mockResolvedValue([{ id: 'org-1' }]),
			getAccessToken: vi.fn().mockResolvedValue('token')
		} as unknown as AuthManager;

		service = new ExportService(configManager, authManager);

		vi.spyOn(FileStorage.prototype, 'initialize').mockResolvedValue(undefined);
		vi.spyOn(FileStorage.prototype, 'loadTasks').mockResolvedValue([
			createTaskFixture()
		]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('uses Chinese section headings and fallback text by default', () => {
		const enriched = (service as any).enrichDescription({
			description: '功能说明',
			details: '实现细节内容',
			testStrategy: '测试策略内容'
		});

		expect(enriched).toContain('## 实现细节');
		expect(enriched).toContain('## 测试策略');
		expect(enriched).not.toContain('## Implementation Details');
		expect((service as any).enrichDescription({})).toBe('未提供描述');
	});

	it('uses English section headings and fallback text when response language is English', () => {
		vi.mocked(configManager.getResponseLanguage).mockReturnValue('English');

		const enriched = (service as any).enrichDescription({
			description: 'Feature description',
			details: 'Implementation details',
			testStrategy: 'Test strategy'
		});

		expect(enriched).toContain('## Implementation Details');
		expect(enriched).toContain('## Test Strategy');
		expect((service as any).enrichDescription({})).toBe(
			'No description provided'
		);
	});

	it('includes language in generate-from-tasks request and retries without language on strict schema errors', async () => {
		const successPayload = {
			success: true,
			brief: {
				id: 'brief-1',
				url: 'https://example.com/briefs/brief-1',
				title: '中文项目计划',
				description: '描述',
				taskCount: 1,
				createdAt: new Date().toISOString()
			},
			taskMapping: []
		};

		const fetchMock = vi
			.fn()
			.mockResolvedValue(createJsonResponse(200, successPayload))
			.mockResolvedValueOnce(
				createJsonResponse(
					400,
					{
						error: {
							message: 'Invalid request: additional properties include language'
						}
					},
					'Bad Request'
				)
			)
			.mockResolvedValueOnce(createJsonResponse(200, successPayload));
		vi.stubGlobal('fetch', fetchMock);

		const result = await service.generateBriefFromTasks();

		expect(result.success).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);

		const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(firstBody.options.language).toBe('Chinese');

		const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
		expect(secondBody.options.language).toBeUndefined();
	});
});

function createTaskFixture(): Task {
	return {
		id: 1,
		title: '任务 1',
		description: '这是一个任务',
		status: 'pending',
		priority: 'medium',
		dependencies: [],
		subtasks: [],
		details: '实现内容',
		testStrategy: '测试内容'
	} as unknown as Task;
}

function createJsonResponse(status: number, data: unknown, statusText = 'OK') {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText,
		headers: {
			get: (name: string) =>
				name.toLowerCase() === 'content-type' ? 'application/json' : null
		},
		json: async () => data,
		text: async () => JSON.stringify(data)
	} as Response;
}
