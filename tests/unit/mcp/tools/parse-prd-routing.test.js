import { jest } from '@jest/globals';

const mockParsePRDDirect = jest.fn();
jest.unstable_mockModule('../../../../mcp-server/src/core/task-master-core.js', () => ({
	parsePRDDirect: mockParsePRDDirect
}));

const mockCheckProgressCapability = jest.fn((reportProgress) => reportProgress);
const mockHandleApiResult = jest.fn(({ result }) => result);
const mockCreateErrorResponse = jest.fn((message) => ({
	success: false,
	error: { message }
}));
const mockWithNormalizedProjectRoot = jest.fn((executeFn) => executeFn);

jest.unstable_mockModule('@tm/mcp', () => ({
	checkProgressCapability: mockCheckProgressCapability,
	createErrorResponse: mockCreateErrorResponse,
	handleApiResult: mockHandleApiResult,
	withNormalizedProjectRoot: mockWithNormalizedProjectRoot
}));

const mockResolveTag = jest.fn(({ tag }) => tag || 'master');
jest.unstable_mockModule('../../../../scripts/modules/utils.js', () => ({
	resolveTag: mockResolveTag
}));

const { registerParsePRDTool } = await import(
	'../../../../mcp-server/src/tools/parse-prd.js'
);

describe('MCP Tool: parse_prd routing', () => {
	let execute;
	const mockServer = {
		addTool: jest.fn((tool) => {
			execute = tool.execute;
		})
	};

	const mockLog = {
		info: jest.fn(),
		error: jest.fn()
	};

	beforeEach(() => {
		jest.clearAllMocks();
		registerParsePRDTool(mockServer);
	});

	it('registers schema with destination and local default', () => {
		const toolConfig = mockServer.addTool.mock.calls[0][0];
		expect(toolConfig.name).toBe('parse_prd');

		const parsedWithDefault = toolConfig.parameters.parse({
			projectRoot: '/repo'
		});
		expect(parsedWithDefault.destination).toBe('local');

		const parsedCloud = toolConfig.parameters.parse({
			projectRoot: '/repo',
			destination: 'hamster'
		});
		expect(parsedCloud.destination).toBe('hamster');
	});

	it('passes destination through to parsePRDDirect', async () => {
		mockParsePRDDirect.mockResolvedValue({
			success: true,
			data: { destination: 'hamster' }
		});

		const result = await execute(
			{
				projectRoot: '/repo',
				input: '/repo/.taskmaster/docs/prd.md',
				tag: 'feature-x',
				destination: 'hamster'
			},
			{
				log: mockLog,
				session: { id: 'session-1' },
				reportProgress: jest.fn()
			}
		);

		expect(mockResolveTag).toHaveBeenCalledWith({
			projectRoot: '/repo',
			tag: 'feature-x'
		});
		expect(mockParsePRDDirect).toHaveBeenCalledWith(
			expect.objectContaining({
				projectRoot: '/repo',
				destination: 'hamster',
				tag: 'feature-x'
			}),
			mockLog,
			expect.objectContaining({
				session: { id: 'session-1' }
			})
		);
		expect(result.success).toBe(true);
		expect(result.data.destination).toBe('hamster');
	});
});
