import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi
} from 'vitest';
import { AutopilotCommand } from '../../../../src/commands/autopilot/index.js';
import { NextCommand } from '../../../../src/commands/autopilot/next.command.js';

vi.mock('@tm/core', () => ({
	createTmCore: vi.fn()
}));

vi.mock('../../../../src/utils/project-root.js', () => ({
	getProjectRoot: vi.fn().mockReturnValue('/test/project')
}));

import { createTmCore } from '@tm/core';
import { getProjectRoot } from '../../../../src/utils/project-root.js';

describe('Autopilot NextCommand', () => {
	let command: NextCommand;
	let consoleLogSpy: any;
	let consoleErrorSpy: any;
	let processExitSpy: any;
	let mockTmCore: any;

	beforeEach(() => {
		vi.clearAllMocks();
		command = new NextCommand();

		consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('process.exit called');
		});

		(getProjectRoot as Mock).mockReturnValue('/test/project');

		mockTmCore = {
			workflow: {
				hasWorkflow: vi.fn().mockResolvedValue(true),
				resume: vi.fn().mockResolvedValue(undefined),
				getStatus: vi.fn().mockReturnValue({
					taskId: '12',
					phase: 'SUBTASK_LOOP',
					tddPhase: 'RED',
					branchName: 'task-12',
					currentSubtask: { id: '2', title: 'Add tests', attempts: 0 }
				}),
				getNextAction: vi.fn().mockReturnValue({
					action: 'generate_test',
					description: 'Generate failing test',
					nextSteps: 'Write failing tests first.',
					phase: 'SUBTASK_LOOP',
					tddPhase: 'RED'
				}),
				getContext: vi.fn().mockReturnValue({ lastTestResults: undefined })
			},
			tasks: {
				start: vi.fn().mockResolvedValue({
					started: true,
					command: {
						executable: 'codex',
						args: ['exec', 'Implement RED phase'],
						cwd: '/test/project'
					}
				})
			},
			config: {
				getConfig: vi.fn().mockReturnValue({
					models: { main: { provider: 'codex-cli', modelId: 'gpt-5.3-codex' } }
				})
			}
		};

		(createTmCore as Mock).mockResolvedValue(mockTmCore);
	});

	afterEach(() => {
		consoleLogSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		processExitSpy.mockRestore();
	});

	it('infers codex executor from config and generates execution hint for RED phase', async () => {
		const execute = (command as any).execute.bind(command);
		await execute({ json: true });

		expect(mockTmCore.tasks.start).toHaveBeenCalledWith(
			'12.2',
			expect.objectContaining({
				dryRun: true,
				updateStatus: false,
				executor: 'codex'
			})
		);

		const output = JSON.parse(consoleLogSpy.mock.calls[0][0]);
		expect(output.action).toBe('generate_test');
		expect(output.execution.executor).toBe('codex');
		expect(output.execution.workItemId).toBe('12.2');
		expect(output.execution.command).toContain('codex');
		expect(output.nextSteps).toContain('Launch coding agent');
	});

	it('uses explicit executor option over inferred config', async () => {
		const execute = (command as any).execute.bind(command);
		await execute({ json: true, executor: 'claude' });

		expect(mockTmCore.tasks.start).toHaveBeenCalledWith(
			'12.2',
			expect.objectContaining({
				executor: 'claude'
			})
		);
	});

	it('registers executor option on autopilot parent command', () => {
		const autopilot = new AutopilotCommand();
		const option = autopilot.options.find((o) => o.long === '--executor');
		expect(option).toBeDefined();
	});
});
