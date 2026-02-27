import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCodexExecutionPreflight } from './codex-execution-preflight.js';

function toTomlPath(value: string): string {
	return value.replace(/\\/g, '\\\\');
}

describe('runCodexExecutionPreflight', () => {
	let tempDir: string | undefined;

	afterEach(() => {
		if (tempDir) {
			fs.rmSync(tempDir, { recursive: true, force: true });
			tempDir = undefined;
		}
	});

	it('fails when codex config file does not exist', () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-preflight-'));
		const projectRoot = path.join(tempDir, 'project');
		fs.mkdirSync(projectRoot, { recursive: true });

		const result = runCodexExecutionPreflight(projectRoot, {
			configPath: path.join(tempDir, 'missing-config.toml')
		});

		expect(result.success).toBe(false);
		expect(result.errors[0]).toContain('Codex config file not found');
	});

	it('passes when project is trusted and approval policy is never', () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-preflight-'));
		const projectRoot = path.join(tempDir, 'project');
		fs.mkdirSync(projectRoot, { recursive: true });

		const configPath = path.join(tempDir, 'config.toml');
		fs.writeFileSync(
			configPath,
			`ask_for_approval = "never"

[projects."${toTomlPath(projectRoot)}"]
trust_level = "trusted"
`,
			'utf-8'
		);

		const result = runCodexExecutionPreflight(projectRoot, { configPath });
		expect(result.success).toBe(true);
		expect(result.errors).toHaveLength(0);
		expect(result.trustLevel).toBe('trusted');
		expect(result.approvalPolicy).toBe('never');
	});

	it('fails when project trust is not configured', () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-preflight-'));
		const projectRoot = path.join(tempDir, 'project');
		fs.mkdirSync(projectRoot, { recursive: true });

		const configPath = path.join(tempDir, 'config.toml');
		fs.writeFileSync(configPath, 'ask_for_approval = "never"\n', 'utf-8');

		const result = runCodexExecutionPreflight(projectRoot, { configPath });

		expect(result.success).toBe(false);
		expect(result.errors.join('\n')).toContain('not trusted in Codex config');
	});

	it('fails when project trust level is untrusted', () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-preflight-'));
		const projectRoot = path.join(tempDir, 'project');
		fs.mkdirSync(projectRoot, { recursive: true });

		const configPath = path.join(tempDir, 'config.toml');
		fs.writeFileSync(
			configPath,
			`ask_for_approval = "never"

[projects."${toTomlPath(projectRoot)}"]
trust_level = "untrusted"
`,
			'utf-8'
		);

		const result = runCodexExecutionPreflight(projectRoot, { configPath });

		expect(result.success).toBe(false);
		expect(result.errors.join('\n')).toContain('trust_level is "untrusted"');
	});

	it('fails when approval policy is interactive', () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-preflight-'));
		const projectRoot = path.join(tempDir, 'project');
		fs.mkdirSync(projectRoot, { recursive: true });

		const configPath = path.join(tempDir, 'config.toml');
		fs.writeFileSync(
			configPath,
			`ask_for_approval = "on-request"

[projects."${toTomlPath(projectRoot)}"]
trust_level = "trusted"
`,
			'utf-8'
		);

		const result = runCodexExecutionPreflight(projectRoot, { configPath });

		expect(result.success).toBe(false);
		expect(result.errors.join('\n')).toContain('ask_for_approval = "never"');
	});

	it('supports approval policy inherited from selected profile', () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-preflight-'));
		const projectRoot = path.join(tempDir, 'project');
		fs.mkdirSync(projectRoot, { recursive: true });

		const configPath = path.join(tempDir, 'config.toml');
		fs.writeFileSync(
			configPath,
			`profile = "automation"

[profiles.automation]
approval_policy = "never"

[projects."${toTomlPath(projectRoot)}"]
trust_level = "trusted"
`,
			'utf-8'
		);

		const result = runCodexExecutionPreflight(projectRoot, { configPath });
		expect(result.success).toBe(true);
		expect(result.approvalPolicy).toBe('never');
	});

	it('accepts trusted parent project configuration', () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-preflight-'));
		const workspaceRoot = path.join(tempDir, 'workspace');
		const projectRoot = path.join(workspaceRoot, 'app');
		fs.mkdirSync(projectRoot, { recursive: true });

		const configPath = path.join(tempDir, 'config.toml');
		fs.writeFileSync(
			configPath,
			`ask_for_approval = "never"

[projects."${toTomlPath(workspaceRoot)}"]
trust_level = "trusted"
`,
			'utf-8'
		);

		const result = runCodexExecutionPreflight(projectRoot, { configPath });
		expect(result.success).toBe(true);
		expect(result.trustLevel).toBe('trusted');
	});
});
