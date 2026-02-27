import { jest } from '@jest/globals';

const mockParsePRD = jest.fn();
jest.unstable_mockModule('../../../scripts/modules/task-manager.js', () => ({
	parsePRD: mockParsePRD
}));

const mockGetDefaultNumTasks = jest.fn(() => 10);
jest.unstable_mockModule('../../../scripts/modules/config-manager.js', () => ({
	getDefaultNumTasks: mockGetDefaultNumTasks
}));

const mockEnableSilentMode = jest.fn();
const mockDisableSilentMode = jest.fn();
const mockIsSilentMode = jest.fn(() => false);
jest.unstable_mockModule('../../../scripts/modules/utils.js', () => ({
	enableSilentMode: mockEnableSilentMode,
	disableSilentMode: mockDisableSilentMode,
	isSilentMode: mockIsSilentMode
}));

const mockResolvePrdPath = jest.fn();
const mockResolveProjectPath = jest.fn();
jest.unstable_mockModule(
	'../../../mcp-server/src/core/utils/path-utils.js',
	() => ({
		resolvePrdPath: mockResolvePrdPath,
		resolveProjectPath: mockResolveProjectPath
	})
);

const mockCreateTmCore = jest.fn();
jest.unstable_mockModule('@tm/core', () => ({
	createTmCore: mockCreateTmCore
}));

const mockCreateLogWrapper = jest.fn((log = {}) => ({
	info: log.info || jest.fn(),
	warn: log.warn || jest.fn(),
	error: log.error || jest.fn(),
	success: log.success || jest.fn()
}));
jest.unstable_mockModule('../../../mcp-server/src/tools/utils.js', () => ({
	createLogWrapper: mockCreateLogWrapper
}));

const mockFs = {
	existsSync: jest.fn(),
	mkdirSync: jest.fn(),
	readFileSync: jest.fn()
};
jest.unstable_mockModule('fs', () => ({
	default: mockFs,
	existsSync: mockFs.existsSync,
	mkdirSync: mockFs.mkdirSync,
	readFileSync: mockFs.readFileSync
}));

const { parsePRDDirect } = await import(
	'../../../mcp-server/src/core/direct-functions/parse-prd.js'
);

describe('parsePRDDirect destination routing', () => {
	const mockLog = {
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
		success: jest.fn()
	};

	beforeEach(() => {
		jest.clearAllMocks();
		mockResolvePrdPath.mockReturnValue('/repo/.taskmaster/docs/prd.md');
		mockResolveProjectPath.mockReturnValue('/repo/.taskmaster/tasks/tasks.json');
		mockGetDefaultNumTasks.mockReturnValue(10);
		mockIsSilentMode.mockReturnValue(false);
		mockFs.existsSync.mockReturnValue(true);
		mockFs.readFileSync.mockReturnValue('Feature PRD content');
		mockParsePRD.mockResolvedValue({
			success: true,
			tasksPath: '/repo/.taskmaster/tasks/tasks.json',
			telemetryData: { provider: 'test' },
			tagInfo: { tag: 'master' }
		});
	});

	it('uses local parsing by default', async () => {
		const result = await parsePRDDirect(
			{
				projectRoot: '/repo',
				input: 'prd.md'
			},
			mockLog,
			{ session: { id: 's-1' }, reportProgress: jest.fn() }
		);

		expect(mockParsePRD).toHaveBeenCalledTimes(1);
		expect(mockCreateTmCore).not.toHaveBeenCalled();
		expect(result.success).toBe(true);
		expect(result.data.outputPath).toBe('/repo/.taskmaster/tasks/tasks.json');
	});

	it('routes to Hamster when destination is hamster', async () => {
		const mockGenerateBriefFromPrd = jest.fn().mockResolvedValue({
			success: true,
			orgId: 'org-123',
			jobId: 'job-456',
			brief: {
				id: 'brief-1',
				title: 'Generated Brief',
				url: 'https://tryhamster.com/home/org/briefs/brief-1',
				status: 'generating'
			}
		});
		const mockUpdateContext = jest.fn().mockResolvedValue(undefined);

		mockCreateTmCore.mockResolvedValue({
			integration: { generateBriefFromPrd: mockGenerateBriefFromPrd },
			auth: { updateContext: mockUpdateContext }
		});

		const result = await parsePRDDirect(
			{
				projectRoot: '/repo',
				input: 'prd.md',
				destination: 'hamster'
			},
			mockLog,
			{ session: { id: 's-2' }, reportProgress: jest.fn() }
		);

		expect(mockParsePRD).not.toHaveBeenCalled();
		expect(mockCreateTmCore).toHaveBeenCalledWith({ projectPath: '/repo' });
		expect(mockGenerateBriefFromPrd).toHaveBeenCalledWith({
			prdContent: 'Feature PRD content'
		});
		expect(mockUpdateContext).toHaveBeenCalledWith(
			expect.objectContaining({
				orgId: 'org-123',
				briefId: 'brief-1',
				briefName: 'Generated Brief',
				briefStatus: 'generating'
			})
		);
		expect(result.success).toBe(true);
		expect(result.data.destination).toBe('hamster');
		expect(result.data.brief.id).toBe('brief-1');
	});

	it('returns error for empty PRD in hamster mode', async () => {
		mockFs.readFileSync.mockReturnValue('   ');

		const result = await parsePRDDirect(
			{
				projectRoot: '/repo',
				input: 'prd.md',
				destination: 'hamster'
			},
			mockLog,
			{ session: { id: 's-3' } }
		);

		expect(result.success).toBe(false);
		expect(result.error.code).toBe('INVALID_INPUT');
		expect(mockCreateTmCore).not.toHaveBeenCalled();
	});
});
