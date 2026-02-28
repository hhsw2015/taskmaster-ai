import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
	ensureAuthenticated: vi.fn(),
	displayError: vi.fn(),
	showUpgradeMessage: vi.fn(),
	prompt: vi.fn()
}));

vi.mock('@tm/core', () => ({
	AuthManager: {
		getInstance: vi.fn(() => ({}))
	},
	FileStorage: class {
		async initialize() {}
		async getTagsWithStats() {
			return { tags: [] };
		}
		async loadTasks() {
			return [
				{
					id: 1,
					title: 'Task 1',
					status: 'pending',
					subtasks: []
				}
			];
		}
	},
	PromptService: class {
		async recordAction() {}
	},
	createTmCore: vi.fn()
}));

vi.mock('inquirer', () => ({
	default: {
		prompt: mocked.prompt
	}
}));

vi.mock('../utils/auth-guard.js', () => ({
	ensureAuthenticated: mocked.ensureAuthenticated
}));

vi.mock('../utils/error-handler.js', () => ({
	displayError: mocked.displayError
}));

vi.mock('../utils/project-root.js', () => ({
	getProjectRoot: vi.fn(() => '/tmp/project')
}));

vi.mock('../utils/org-selection.js', () => ({
	ensureOrgSelected: vi.fn()
}));

vi.mock('../utils/brief-selection.js', () => ({
	selectBriefFromInput: vi.fn().mockResolvedValue({ success: true })
}));

vi.mock('../ui/index.js', () => ({
	createUrlLink: (url: string) => url
}));

vi.mock('../export/index.js', () => ({
	selectTasks: vi.fn(),
	showExportPreview: vi.fn(),
	showUpgradeMessage: mocked.showUpgradeMessage,
	showUpgradeMessageIfNeeded: vi.fn(),
	validateTasks: vi.fn(() => ({ isValid: true, errors: [] }))
}));

import { ExportCommand } from './export.command.js';

describe('ExportCommand non-interactive mode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocked.ensureAuthenticated.mockResolvedValue({ authenticated: true });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('registers non-interactive CLI options', () => {
		const command = new ExportCommand();
		const longs = command.options.map((o) => o.long);

		expect(longs).toContain('--yes');
		expect(longs).toContain('--non-interactive');
		expect(longs).toContain('--invite-emails');
		expect(longs).toContain('--all-unexported');
	});

	it('does not prompt when running --yes while connected to a brief', async () => {
		const command = new ExportCommand();

		(command as any).taskMasterCore = {
			auth: {
				getContext: vi.fn().mockReturnValue({ briefId: 'brief-1' })
			},
			config: {
				getActiveTag: vi.fn().mockReturnValue('master')
			}
		};

		vi.spyOn(command as any, 'initializeServices').mockResolvedValue(undefined);
		const standardSpy = vi
			.spyOn(command as any, 'executeStandardExport')
			.mockResolvedValue(undefined);
		const interactiveSpy = vi
			.spyOn(command as any, 'executeInteractiveTagSelection')
			.mockResolvedValue(undefined);

		await (command as any).executeExport({ yes: true });

		expect(mocked.prompt).not.toHaveBeenCalled();
		expect(interactiveSpy).not.toHaveBeenCalled();
		expect(standardSpy).toHaveBeenCalledWith(
			expect.objectContaining({ tag: 'master', nonInteractive: true })
		);
		expect(mocked.showUpgradeMessage).toHaveBeenCalledWith('master');
	});

	it('rejects --invite in non-interactive mode without --invite-emails', async () => {
		const command = new ExportCommand();
		await expect(
			(command as any).resolveInviteEmails({ yes: true, invite: true })
		).rejects.toThrow('Use --invite-emails instead');
	});
});
