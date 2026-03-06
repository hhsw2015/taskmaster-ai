import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
	createTmCore: vi.fn(),
	displayError: vi.fn(),
	getProjectRoot: vi.fn(() => '/tmp/project')
}));

vi.mock('@tm/core', () => ({
	createTmCore: mocked.createTmCore
}));

vi.mock('../../utils/error-handler.js', () => ({
	displayError: mocked.displayError
}));

vi.mock('../../utils/project-root.js', () => ({
	getProjectRoot: mocked.getProjectRoot
}));

import { RunCommand } from './run.command.js';

describe('Codex RunCommand', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocked.createTmCore.mockResolvedValue({
			skillRun: {
				run: vi.fn().mockResolvedValue({
					completedTaskIds: ['1'],
					blockedTaskIds: [],
					attempts: { '1': 1 },
					totalRuns: 1,
					finalStatus: 'all_complete'
				})
			},
			close: vi.fn()
		});
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	it('passes parsed options into tmCore.skillRun.run', async () => {
		const command = new RunCommand();
		await (command as any).execute({
			tag: 'master',
			maxRetries: '5',
			executor: 'codex',
			model: 'gpt-5.2-codex',
			reasoningEffort: 'xhigh',
			showExecutorOutput: false,
			execIdleTimeoutMs: '600000',
			execHardTimeoutMs: '90000',
			execTimeoutMs: '120000',
			terminateOnResult: false,
			agentsMode: 'skip',
			mode: 'lite',
			maxTasks: '10'
		});

		expect(mocked.createTmCore).toHaveBeenCalledWith({
			projectPath: '/tmp/project'
		});
		const core = await mocked.createTmCore.mock.results[0].value;
		expect(core.skillRun.run).toHaveBeenCalledWith(
			expect.objectContaining({
				tag: 'master',
				maxRetries: 5,
				executor: 'codex',
				model: 'gpt-5.2-codex',
				reasoningEffort: 'xhigh',
				showExecutorOutput: false,
				execIdleTimeoutMs: 600000,
				execHardTimeoutMs: 90000,
				execTimeoutMs: 120000,
				terminateOnResult: false,
				agentsMode: 'skip',
				mode: 'lite',
				maxTasks: 10,
				continueOnFailure: undefined
			})
		);
	});

	it('defaults to showing executor output when flag is not provided', async () => {
		const command = new RunCommand();
		const executeSpy = vi
			.spyOn(command as any, 'execute')
			.mockResolvedValue(undefined);

		await command.parseAsync([], { from: 'user' });

		expect(executeSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				showExecutorOutput: true
			})
		);
	});

	it('prints longrun mode summary before execution starts', async () => {
		const command = new RunCommand();
		await (command as any).execute({
			tag: 'feature-x',
			executor: 'codex',
			model: 'gpt-5.3-codex',
			reasoningEffort: 'xhigh',
			showExecutorOutput: true
		});

		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining('Starting Codex longrun execution...')
		);
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining('Mode: runner-controlled auto-continue')
		);
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining('Tag: feature-x')
		);
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining('Model: gpt-5.3-codex')
		);
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining('Continue: until all_complete/blocked/error')
		);
	});
});
