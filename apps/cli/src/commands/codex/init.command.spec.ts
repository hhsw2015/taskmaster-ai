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

import { InitCommand } from './init.command.js';

describe('Codex InitCommand', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocked.createTmCore.mockResolvedValue({
			skillRun: {
				initAssets: vi.fn().mockResolvedValue({
					paths: {
						agentsPath: '/tmp/project/AGENTS.md',
						skillAgentsPath:
							'/tmp/project/.codex/skills/taskmaster-longrun/AGENTS.md',
						skillPath: '/tmp/project/.codex/skills/taskmaster-longrun/SKILL.md',
						launcherPath: '/tmp/project/.taskmaster/bin/codex-longrun',
						launcherCommand: './.taskmaster/bin/codex-longrun',
						sessionDir: '/tmp/project/.codex-tasks/taskmaster-longrun'
					},
					created: [],
					updated: [],
					skipped: []
				})
			},
			close: vi.fn()
		});
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	it('maps options to tmCore.skillRun.initAssets', async () => {
		const command = new InitCommand();
		await (command as any).execute({
			skillPath: '.codex/skills/custom/SKILL.md',
			agentsPath: 'AGENTS.md',
			agentsMode: 'fail',
			mode: 'lite',
			sessionDir: '.codex-tasks/custom'
		});

		expect(mocked.createTmCore).toHaveBeenCalledWith({
			projectPath: '/tmp/project'
		});
		const core = await mocked.createTmCore.mock.results[0].value;
		expect(core.skillRun.initAssets).toHaveBeenCalledWith({
			skillPath: '.codex/skills/custom/SKILL.md',
			agentsPath: 'AGENTS.md',
			agentsMode: 'fail',
			mode: 'lite',
			sessionDir: '.codex-tasks/custom'
			});
	});

	it('prints machine-readable load hints in text mode', async () => {
		const command = new InitCommand();
		await (command as any).execute({});

		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining(
				'TM_IMMEDIATE_ACTION: LOAD @.codex/skills/taskmaster-longrun/AGENTS.md'
			)
		);
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining(
				'TM_IMMEDIATE_ACTION: LOAD @.codex/skills/taskmaster-longrun/SKILL.md'
			)
		);
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining(
				'TM_IMMEDIATE_ACTION: RUN ./.taskmaster/bin/codex-longrun'
			)
		);
	});

	it('returns load hints and immediate action in json mode', async () => {
		const command = new InitCommand();
		await (command as any).execute({ json: true });
		const calls = (console.log as any).mock.calls;
		const jsonOutput = calls[calls.length - 1][0];
		const parsed = JSON.parse(jsonOutput);
		expect(parsed.loadHints).toEqual([
			'@.codex/skills/taskmaster-longrun/AGENTS.md',
			'@.codex/skills/taskmaster-longrun/SKILL.md'
		]);
		expect(parsed.start_command).toBe('./.taskmaster/bin/codex-longrun');
		expect(parsed.immediate_action).toContain(
			'@.codex/skills/taskmaster-longrun/AGENTS.md'
		);
		expect(parsed.immediate_action).toContain('./.taskmaster/bin/codex-longrun');
	});
});
