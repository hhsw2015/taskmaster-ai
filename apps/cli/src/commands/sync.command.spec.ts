import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => {
	const contextRef = {
		current: {
			orgId: 'org-1',
			briefId: 'brief-1',
			briefName: 'Brief 1'
		} as any
	};

	const spinner = {
		start: vi.fn(),
		succeed: vi.fn(),
		fail: vi.fn(),
		isSpinning: false,
		text: ''
	};
	spinner.start.mockReturnValue(spinner);

	return {
		contextRef,
		ensureAuthenticated: vi.fn(),
		displayError: vi.fn(),
		selectBriefFromInput: vi.fn(),
		selectBriefInteractive: vi.fn(),
		ensureOrgSelected: vi.fn(),
		prompt: vi.fn(),
		createTmCore: vi.fn(),
		exportTasks: vi.fn(),
		authManager: {
			getContext: vi.fn(() => contextRef.current),
			updateContext: vi.fn(),
			getOrganizations: vi.fn(),
			getBriefs: vi.fn()
		},
		spinner,
		oraFactory: vi.fn(() => spinner)
	};
});

vi.mock('@tm/core', () => ({
	AuthManager: {
		getInstance: vi.fn(() => mocked.authManager)
	},
	createTmCore: mocked.createTmCore
}));

vi.mock('inquirer', () => ({
	default: {
		prompt: mocked.prompt
	}
}));

vi.mock('ora', () => ({
	default: mocked.oraFactory
}));

vi.mock('../utils/auth-guard.js', () => ({
	ensureAuthenticated: mocked.ensureAuthenticated
}));

vi.mock('../utils/brief-selection.js', () => ({
	selectBriefFromInput: mocked.selectBriefFromInput,
	selectBriefInteractive: mocked.selectBriefInteractive
}));

vi.mock('../utils/error-handler.js', () => ({
	displayError: mocked.displayError
}));

vi.mock('../utils/org-selection.js', () => ({
	ensureOrgSelected: mocked.ensureOrgSelected
}));

vi.mock('../utils/project-root.js', () => ({
	getProjectRoot: vi.fn(() => '/tmp/project')
}));

import { SyncCommand } from './sync.command.js';

describe('SyncCommand', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocked.spinner.start.mockReturnValue(mocked.spinner);
		mocked.contextRef.current = {
			orgId: 'org-1',
			briefId: 'brief-1',
			briefName: 'Brief 1'
		};
		mocked.ensureAuthenticated.mockResolvedValue({ authenticated: true });
		mocked.exportTasks.mockResolvedValue({
			success: true,
			taskCount: 3,
			briefId: 'brief-1',
			orgId: 'org-1',
			message: 'ok'
		});
		mocked.createTmCore.mockResolvedValue({
			auth: {
				getContext: vi.fn(() => mocked.contextRef.current)
			},
			config: {
				getActiveTag: vi.fn(() => 'master')
			},
			integration: {
				exportTasks: mocked.exportTasks
			}
		});
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('registers sync push options', () => {
		const command = new SyncCommand();
		const push = command.commands.find((cmd) => cmd.name() === 'push');

		expect(push).toBeDefined();
		const longs = push!.options.map((option) => option.long);
		expect(longs).toContain('--brief');
		expect(longs).toContain('--tag');
		expect(longs).toContain('--mode');
		expect(longs).toContain('--yes');
		expect(longs).toContain('--non-interactive');
	});

	it('pushes local tag to explicit brief in non-interactive mode', async () => {
		mocked.contextRef.current = {
			orgId: 'org-1'
		};
		mocked.selectBriefFromInput.mockImplementation(async () => {
			mocked.contextRef.current = {
				orgId: 'org-1',
				briefId: 'brief-2',
				briefName: 'Brief 2'
			};
			return { success: true };
		});

		const command = new SyncCommand();
		await (command as any).executePush({
			yes: true,
			brief: 'https://tryhamster.com/home/test/briefs/brief-2',
			tag: 'master_zh'
		});

		expect(mocked.selectBriefFromInput).toHaveBeenCalled();
		expect(mocked.exportTasks).toHaveBeenCalledWith({
			briefId: 'brief-2',
			orgId: 'org-1',
			tag: 'master_zh',
			mode: 'append'
		});
		expect(mocked.displayError).not.toHaveBeenCalled();
	});

	it('passes replace mode through to core export', async () => {
		mocked.contextRef.current = {
			orgId: 'org-1',
			briefId: 'brief-2',
			briefName: 'Brief 2'
		};

		const command = new SyncCommand();
		await (command as any).executePush({
			yes: true,
			mode: 'replace',
			tag: 'master'
		});

		expect(mocked.exportTasks).toHaveBeenCalledWith({
			briefId: 'brief-2',
			orgId: 'org-1',
			tag: 'master',
			mode: 'replace'
		});
	});

	it('fails fast in non-interactive mode when brief is not selected', async () => {
		mocked.contextRef.current = {
			orgId: 'org-1'
		};

		const command = new SyncCommand();
		await (command as any).executePush({
			yes: true
		});

		expect(mocked.exportTasks).not.toHaveBeenCalled();
		expect(command.getLastResult()).toMatchObject({
			success: false,
			action: 'cancelled'
		});
		expect(command.getLastResult()?.message).toContain('No brief selected');
	});
});
