import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../../../common/types/index.js';
import { runCodexExecutionPreflight } from '../../../common/utils/codex-execution-preflight.js';
import { TaskExecutionService } from './task-execution-service.js';

vi.mock('../../../common/utils/codex-execution-preflight.js', () => ({
	runCodexExecutionPreflight: vi.fn(() => ({
		success: true,
		errors: [],
		projectRoot: process.cwd(),
		configPath: '/tmp/.codex/config.toml'
	}))
}));

function createTask(overrides: Partial<Task> = {}): Task {
	return {
		id: '1',
		title: 'Implement executor selection',
		description: 'Ensure executor is configurable.',
		status: 'pending',
		priority: 'medium',
		dependencies: [],
		details: 'Add codex and claude support.',
		testStrategy: 'Add unit tests.',
		subtasks: [],
		...overrides
	};
}

function createTaskServiceMock(task: Task) {
	return {
		getTaskList: vi.fn().mockResolvedValue({
			tasks: [task]
		}),
		getTask: vi.fn().mockResolvedValue(task),
		updateTaskStatus: vi.fn().mockResolvedValue(undefined),
		getNextTask: vi.fn().mockResolvedValue(task)
	} as any;
}

describe('TaskExecutionService', () => {
	it('prepares a claude command by default', async () => {
		vi.mocked(runCodexExecutionPreflight).mockReturnValue({
			success: true,
			errors: [],
			projectRoot: process.cwd(),
			configPath: '/tmp/.codex/config.toml'
		});
		const task = createTask();
		const service = new TaskExecutionService(createTaskServiceMock(task));

		const result = await service.startTask('1', { dryRun: true });

		expect(result.started).toBe(true);
		expect(result.command?.executable).toBe('claude');
		expect(result.command?.args[0]).toContain('Task #1');
	});

	it('prepares a codex command when executor is codex', async () => {
		vi.mocked(runCodexExecutionPreflight).mockReturnValue({
			success: true,
			errors: [],
			projectRoot: process.cwd(),
			configPath: '/tmp/.codex/config.toml'
		});
		const task = createTask();
		const service = new TaskExecutionService(createTaskServiceMock(task));

		const result = await service.startTask('1', {
			dryRun: true,
			executor: 'codex'
		});

		expect(result.started).toBe(true);
		expect(result.command?.executable).toBe('codex');
		expect(result.command?.args[0]).toContain('Task #1');
		expect(runCodexExecutionPreflight).not.toHaveBeenCalled();
	});

	it('falls back to claude when an unknown executor is provided', async () => {
		vi.mocked(runCodexExecutionPreflight).mockReturnValue({
			success: true,
			errors: [],
			projectRoot: process.cwd(),
			configPath: '/tmp/.codex/config.toml'
		});
		const task = createTask();
		const service = new TaskExecutionService(createTaskServiceMock(task));

		const result = await service.startTask('1', {
			dryRun: true,
			executor: 'unknown' as any
		});

		expect(result.started).toBe(true);
		expect(result.command?.executable).toBe('claude');
	});

	it('blocks codex execution when preflight check fails', async () => {
		vi.mocked(runCodexExecutionPreflight).mockReturnValue({
			success: false,
			errors: ['Project "/test/project" trust_level is "untrusted".'],
			projectRoot: '/test/project',
			configPath: '/tmp/.codex/config.toml'
		});
		const task = createTask();
		const service = new TaskExecutionService(createTaskServiceMock(task));

		const result = await service.startTask('1', {
			executor: 'codex'
		});

		expect(result.started).toBe(false);
		expect(result.command).toBeUndefined();
		expect(result.error).toContain('Codex execution blocked');
		expect(result.error).toContain('trust_level');
		expect(runCodexExecutionPreflight).toHaveBeenCalled();
	});
});
