import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
	hasValidSession: vi.fn(),
	getContext: vi.fn(),
	getInstance: vi.fn(),
	ensureOrgSelected: vi.fn(),
	prompt: vi.fn()
}));

vi.mock('@tm/core', () => ({
	AuthDomain: class {
		hasValidSession = mocked.hasValidSession;
	},
	AuthManager: {
		getInstance: mocked.getInstance
	}
}));

vi.mock('inquirer', () => ({
	default: {
		prompt: mocked.prompt
	}
}));

vi.mock('./auth-ui.js', () => ({
	authenticateWithBrowserMFA: vi.fn()
}));

vi.mock('./org-selection.js', () => ({
	ensureOrgSelected: mocked.ensureOrgSelected
}));

import { ensureAuthenticated } from './auth-guard.js';

describe('ensureAuthenticated non-interactive behavior', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocked.getInstance.mockReturnValue({
			getContext: mocked.getContext
		});
	});

	it('fails fast when not authenticated in non-interactive mode', async () => {
		mocked.hasValidSession.mockResolvedValue(false);

		const result = await ensureAuthenticated({ nonInteractive: true });

		expect(result.authenticated).toBe(false);
		expect(result.error).toContain('Not authenticated');
		expect(mocked.prompt).not.toHaveBeenCalled();
	});

	it('fails fast when no org selected and multiple orgs require manual selection', async () => {
		mocked.hasValidSession.mockResolvedValue(true);
		mocked.getContext.mockReturnValue(null);
		mocked.ensureOrgSelected.mockResolvedValue({
			success: false,
			message: 'Multiple organizations available but none selected'
		});

		const result = await ensureAuthenticated({ nonInteractive: true });

		expect(result.authenticated).toBe(false);
		expect(result.error).toContain('Multiple organizations');
		expect(mocked.ensureOrgSelected).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ nonInteractive: true, silent: true })
		);
		expect(mocked.prompt).not.toHaveBeenCalled();
	});
});
