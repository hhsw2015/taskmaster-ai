import { jest } from '@jest/globals';

const mockReadJSON = jest.fn();
const mockWriteJSON = jest.fn();
const mockEnableSilentMode = jest.fn();
const mockDisableSilentMode = jest.fn();
const mockIsSilentMode = jest.fn(() => false);

jest.unstable_mockModule('../../../scripts/modules/utils.js', () => ({
	readJSON: mockReadJSON,
	writeJSON: mockWriteJSON,
	enableSilentMode: mockEnableSilentMode,
	disableSilentMode: mockDisableSilentMode,
	isSilentMode: mockIsSilentMode
}));

const mockExpandTask = jest.fn();
jest.unstable_mockModule(
	'../../../scripts/modules/task-manager/expand-task.js',
	() => ({
		default: mockExpandTask
	})
);

const mockCreateLogWrapper = jest.fn((log = {}) => ({
	info: log.info || jest.fn(),
	warn: log.warn || jest.fn(),
	error: log.error || jest.fn(),
	success: log.success || jest.fn()
}));
jest.unstable_mockModule('../../../mcp-server/src/tools/utils.js', () => ({
	createLogWrapper: mockCreateLogWrapper
}));

const { expandTaskDirect } = await import(
	'../../../mcp-server/src/core/direct-functions/expand-task.js'
);

describe('expandTaskDirect tag routing', () => {
	const mockLog = {
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
		success: jest.fn()
	};

	beforeEach(() => {
		jest.clearAllMocks();
		mockIsSilentMode.mockReturnValue(false);
		mockReadJSON
			.mockImplementationOnce((tasksPath, projectRoot, tag) =>
				tag === 'backlog'
					? {
							tasks: [{ id: 7, title: 'Backlog task', status: 'pending' }]
						}
					: {
							tasks: [{ id: 1, title: 'Current tag task', status: 'pending' }]
						}
			)
			.mockImplementationOnce((tasksPath, projectRoot, tag) =>
				tag === 'backlog'
					? {
							tasks: [
								{
									id: 7,
									title: 'Backlog task',
									status: 'pending',
									subtasks: [{ id: 1, title: 'Generated subtask' }]
								}
							]
						}
					: {
							tasks: [{ id: 1, title: 'Current tag task', status: 'pending' }]
						}
			);
		mockExpandTask.mockResolvedValue({
			task: {
				id: 7,
				title: 'Backlog task',
				status: 'pending',
				subtasks: [{ id: 1, title: 'Generated subtask' }]
			},
			telemetryData: { provider: 'test' },
			tagInfo: { tag: 'backlog' }
		});
	});

	it('reads and writes using the explicit tag instead of the current tag', async () => {
		const result = await expandTaskDirect(
			{
				tasksJsonPath: '/repo/.taskmaster/tasks/tasks.json',
				projectRoot: '/repo',
				id: '7',
				tag: 'backlog'
			},
			mockLog,
			{ session: { id: 'session-1' } }
		);

		expect(result.success).toBe(true);
		expect(result.data.task.id).toBe(7);
		expect(result.data.subtasksAdded).toBe(1);
		expect(mockReadJSON).toHaveBeenNthCalledWith(
			1,
			'/repo/.taskmaster/tasks/tasks.json',
			'/repo',
			'backlog'
		);
		expect(mockReadJSON).toHaveBeenNthCalledWith(
			2,
			'/repo/.taskmaster/tasks/tasks.json',
			'/repo',
			'backlog'
		);
		expect(mockWriteJSON).toHaveBeenCalledWith(
			'/repo/.taskmaster/tasks/tasks.json',
			expect.objectContaining({
				tasks: expect.arrayContaining([expect.objectContaining({ id: 7 })])
			}),
			'/repo',
			'backlog'
		);
		expect(mockExpandTask).toHaveBeenCalledWith(
			'/repo/.taskmaster/tasks/tasks.json',
			7,
			undefined,
			false,
			'',
			expect.objectContaining({
				projectRoot: '/repo',
				tag: 'backlog'
			}),
			false
		);
	});
});
