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
						skillPath: '/tmp/project/.codex/skills/taskmaster-longrun/SKILL.md',
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
});
