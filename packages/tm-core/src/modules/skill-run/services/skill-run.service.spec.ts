import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	PACKAGE_NAME,
	TASKMASTER_VERSION
} from '../../../common/constants/index.js';
import type { Task } from '../../../common/types/index.js';
import type { TasksDomain } from '../../tasks/tasks-domain.js';
import { SkillRunService } from './skill-run.service.js';

describe('SkillRunService', () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(path.join(os.tmpdir(), 'tm-skillrun-'));
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
		delete process.env.TM_REMOTE_SKILL_FETCH_TIMEOUT_MS;
	});

	it('initializes assets idempotently', async () => {
		const mockTasksDomain = {
			list: vi.fn().mockResolvedValue({ tasks: [] })
		} as unknown as TasksDomain;
		const service = new SkillRunService(tmpDir, mockTasksDomain);

		await service.initAssets();
		await service.initAssets();

		const agentsPath = path.join(tmpDir, 'AGENTS.md');
		const skillPath = path.join(
			tmpDir,
			'.codex',
			'skills',
			'taskmaster-longrun',
			'SKILL.md'
		);
		const upstreamAgentsPath = path.join(
			tmpDir,
			'.codex',
			'skills',
			'taskmaster-longrun',
			'AGENTS.md'
		);
		const launcherPath = path.join(
			tmpDir,
			'.taskmaster',
			'bin',
			'codex-longrun'
		);
		const specAssetPath = path.join(
			tmpDir,
			'.codex',
			'skills',
			'taskmaster-longrun',
			'assets',
			'SPEC_TEMPLATE.md'
		);
		const progressAssetPath = path.join(
			tmpDir,
			'.codex',
			'skills',
			'taskmaster-longrun',
			'assets',
			'PROGRESS_TEMPLATE.md'
		);
		const todoAssetPath = path.join(
			tmpDir,
			'.codex',
			'skills',
			'taskmaster-longrun',
			'assets',
			'todo_template.csv'
		);
		const specPath = path.join(
			tmpDir,
			'.codex-tasks',
			'taskmaster-longrun',
			'SPEC.md'
		);
		const progressPath = path.join(
			tmpDir,
			'.codex-tasks',
			'taskmaster-longrun',
			'PROGRESS.md'
		);
		const agents = await readFile(agentsPath, 'utf-8');
		const skill = await readFile(skillPath, 'utf-8');
		const upstreamAgents = await readFile(upstreamAgentsPath, 'utf-8');
		const specAsset = await readFile(specAssetPath, 'utf-8');
		const progressAsset = await readFile(progressAssetPath, 'utf-8');
		const todoAsset = await readFile(todoAssetPath, 'utf-8');
		const spec = await readFile(specPath, 'utf-8');
		const progress = await readFile(progressPath, 'utf-8');
		const launcher = await readFile(launcherPath, 'utf-8');
		expect(agents.match(/TM-LONGRUN-START/g)?.length).toBe(1);
		expect(agents).toContain('Taskmaster Quick Triggers');
		expect(agents).toContain('当用户说“拆分任务”时');
		expect(agents).toContain('当用户说“开始实现”时');
		expect(agents).toContain('./.taskmaster/bin/codex-longrun');
		expect(agents).toContain('不要在普通聊天模式下直接实现任务');
		expect(skill).toContain('Taskmaster Longrun Skill');
		expect(skill.startsWith('---')).toBe(true);
		expect(skill.match(/TM-INTEGRATION-START/g)?.length).toBe(1);
		expect(skill).toContain('Taskmaster Integration Addendum');
		expect(skill).toContain('must not mutate Taskmaster status');
		expect(upstreamAgents).toContain('Global Agent Rules');
		expect(specAsset).toContain('# SPEC');
		expect(progressAsset).toContain('# PROGRESS');
		expect(todoAsset).toContain('id,task,status');
		expect(spec).toContain('# SPEC');
		expect(progress).toContain('# PROGRESS');
		expect(launcher).toContain(
			`exec npx -y --package ${PACKAGE_NAME}@${TASKMASTER_VERSION} task-master codex run "$@"`
		);
	});

	it('uses AGENTS.md as default target even when lowercase agent.md exists', async () => {
		const mockTasksDomain = {
			list: vi.fn().mockResolvedValue({ tasks: [] })
		} as unknown as TasksDomain;
		const service = new SkillRunService(tmpDir, mockTasksDomain);
		const lowerAgentsPath = path.join(tmpDir, 'agent.md');
		await writeFile(lowerAgentsPath, '# Existing agent instructions\n', 'utf-8');

		const result = await service.initAssets();
		const upperAgentsPath = path.join(tmpDir, 'AGENTS.md');

		expect(result.paths.agentsPath).toBe(upperAgentsPath);
		const agents = await readFile(lowerAgentsPath, 'utf-8');
		expect(agents).toContain('Existing agent instructions');
		expect(agents).not.toContain('TM-LONGRUN-START');
		const upperAgents = await readFile(upperAgentsPath, 'utf-8');
		expect(upperAgents).toContain('TM-LONGRUN-START');
	});

	it('fails in fail mode when file exists but hook is missing', async () => {
		const mockTasksDomain = {
			list: vi.fn().mockResolvedValue({ tasks: [] })
		} as unknown as TasksDomain;
		const service = new SkillRunService(tmpDir, mockTasksDomain);
		const agentsPath = path.join(tmpDir, 'AGENTS.md');
		await writeFile(agentsPath, '# Existing instructions\n', 'utf-8');

		await expect(
			service.initAssets({
				agentsPath: 'AGENTS.md',
				agentsMode: 'fail'
			})
		).rejects.toThrow(/AGENTS hook missing/i);

		const after = await readFile(agentsPath, 'utf-8');
		expect(after).toBe('# Existing instructions\n');
	});

	it('upgrades existing legacy TM-LONGRUN hook to include skill AGENTS path', async () => {
		const mockTasksDomain = {
			list: vi.fn().mockResolvedValue({ tasks: [] })
		} as unknown as TasksDomain;
		const service = new SkillRunService(tmpDir, mockTasksDomain);
		const agentsPath = path.join(tmpDir, 'AGENTS.md');
		const legacyHook = [
			'# Existing instructions',
			'',
			'<!-- TM-LONGRUN-START -->',
			'## Taskmaster Longrun Hook',
			'When implementation starts, load AGENTS first, then load @.codex/skills/taskmaster-longrun/SKILL.md, then execute one Taskmaster task per Codex run.',
			'<!-- TM-LONGRUN-END -->',
			''
		].join('\n');
		await writeFile(agentsPath, legacyHook, 'utf-8');

		const result = await service.initAssets();
		expect(result.updated).toContain('AGENTS.md');

		const content = await readFile(agentsPath, 'utf-8');
		expect(content).toContain('@.codex/skills/taskmaster-longrun/AGENTS.md');
		expect(content).toContain('Taskmaster Quick Triggers');
		expect(content.match(/TM-LONGRUN-START/g)?.length).toBe(1);
	});

	it('upgrades skill file when frontmatter is missing', async () => {
		const mockTasksDomain = {
			list: vi.fn().mockResolvedValue({ tasks: [] })
		} as unknown as TasksDomain;
		const service = new SkillRunService(tmpDir, mockTasksDomain);
		const skillPath = path.join(
			tmpDir,
			'.codex',
			'skills',
			'taskmaster-longrun',
			'SKILL.md'
		);
		await mkdir(path.dirname(skillPath), { recursive: true });
		await writeFile(skillPath, '# old skill\n', 'utf-8');

		await service.initAssets();

		const upgraded = await readFile(skillPath, 'utf-8');
		expect(upgraded.startsWith('---')).toBe(true);
		expect(upgraded).toContain('Taskmaster Longrun Skill');
		expect(upgraded).toContain('Taskmaster Integration Addendum');
	});

	it('falls back when remote template fetch times out', async () => {
		vi.useFakeTimers();
		process.env.TM_REMOTE_SKILL_FETCH_TIMEOUT_MS = '5';
		const originalNodeEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = 'development';
		try {
			const mockTasksDomain = {
				list: vi.fn().mockResolvedValue({ tasks: [] })
			} as unknown as TasksDomain;
			const service = new SkillRunService(tmpDir, mockTasksDomain);
			const fetchMock = vi.fn().mockImplementation(
				async (_url: string, init?: { signal?: AbortSignal }) =>
					new Promise((resolve, reject) => {
						if (!init?.signal) {
							resolve(new Response('remote-content', { status: 200 }));
							return;
						}
						init.signal.addEventListener('abort', () => {
							reject(new Error('aborted'));
						});
					})
			);
			vi.stubGlobal('fetch', fetchMock);

			const promise = (service as any).loadRemoteTemplate(
				'https://example.com/skill.md',
				'fallback-template'
			);
			await vi.advanceTimersByTimeAsync(10);

			await expect(promise).resolves.toBe('fallback-template');
			expect(fetchMock).toHaveBeenCalledWith(
				'https://example.com/skill.md',
				expect.objectContaining({
					signal: expect.any(AbortSignal)
				})
			);
		} finally {
			process.env.NODE_ENV = originalNodeEnv;
		}
	});

	it('creates a windows launcher and command when platform is win32', async () => {
		const originalPlatform = process.platform;
		Object.defineProperty(process, 'platform', {
			value: 'win32'
		});
		try {
			const mockTasksDomain = {
				list: vi.fn().mockResolvedValue({ tasks: [] })
			} as unknown as TasksDomain;
			const service = new SkillRunService(tmpDir, mockTasksDomain);

			const result = await service.initAssets();
			const launcher = await readFile(result.paths.launcherPath, 'utf-8');
			const agents = await readFile(result.paths.agentsPath, 'utf-8');

			expect(result.paths.launcherPath).toBe(
				path.join(tmpDir, '.taskmaster', 'bin', 'codex-longrun.cmd')
			);
			expect(result.paths.launcherCommand).toBe(
				'.\\.taskmaster\\bin\\codex-longrun.cmd'
			);
			expect(launcher).toContain(
				`npx -y --package ${PACKAGE_NAME}@${TASKMASTER_VERSION} task-master codex run %*`
			);
			expect(agents).toContain('.\\.taskmaster\\bin\\codex-longrun.cmd');
		} finally {
			Object.defineProperty(process, 'platform', {
				value: originalPlatform
			});
		}
	});

	it('runs one task and marks done when executor succeeds', async () => {
		const task: Task = {
			id: '1',
			title: 'demo task',
			description: 'd',
			status: 'pending',
			priority: 'medium',
			dependencies: [],
			details: 'details',
			testStrategy: 'test',
			subtasks: []
		};
		const getNext = vi
			.fn()
			.mockResolvedValueOnce(task)
			.mockResolvedValueOnce(null);
		const updateStatus = vi.fn().mockResolvedValue(undefined);
		const list = vi.fn().mockResolvedValue({ tasks: [task] });
		const mockTasksDomain = {
			getNext,
			updateStatus,
			list
		} as unknown as TasksDomain;
		const service = new SkillRunService(tmpDir, mockTasksDomain);
		vi.spyOn(service as any, 'executeCodex').mockResolvedValue({
			exitCode: 0,
			signal: null,
			durationMs: 12,
			logFile: path.join(tmpDir, 'log.txt'),
			timedOut: false,
			timeoutMs: 1000,
			timeoutKind: null,
			parsedResult: null
		});

		const result = await service.run({ maxRetries: 1 });
		expect(result.finalStatus).toBe('all_complete');
		expect(result.completedTaskIds).toContain('1');
		expect(updateStatus).toHaveBeenCalledWith('1', 'in-progress', undefined);
		expect(updateStatus).toHaveBeenCalledWith('1', 'done', undefined);

		const checkpointPath = path.join(
			tmpDir,
			'.codex-tasks',
			'taskmaster-longrun',
			'checkpoint.json'
		);
		const todoPath = path.join(
			tmpDir,
			'.codex-tasks',
			'taskmaster-longrun',
			'TODO.csv'
		);
		const specPath = path.join(
			tmpDir,
			'.codex-tasks',
			'taskmaster-longrun',
			'SPEC.md'
		);
		const progressPath = path.join(
			tmpDir,
			'.codex-tasks',
			'taskmaster-longrun',
			'PROGRESS.md'
		);
		const checkpointRaw = await readFile(checkpointPath, 'utf-8');
		const todoRaw = await readFile(todoPath, 'utf-8');
		const specRaw = await readFile(specPath, 'utf-8');
		const progressRaw = await readFile(progressPath, 'utf-8');
		expect(checkpointRaw).toContain('"doneTaskIds"');
		expect(todoRaw).toContain('id,task,status,acceptance_criteria');
		expect(specRaw).toContain('# SPEC');
		expect(progressRaw).toContain('# PROGRESS');
	});

	it('supports lite mode with lightweight TODO.csv only', async () => {
		const task: Task = {
			id: '1',
			title: 'lite task',
			description: 'd',
			status: 'pending',
			priority: 'medium',
			dependencies: [],
			details: 'details',
			testStrategy: 'test',
			subtasks: []
		};
		const mockTasksDomain = {
			getNext: vi.fn().mockResolvedValueOnce(task).mockResolvedValueOnce(null),
			updateStatus: vi.fn().mockResolvedValue(undefined),
			list: vi.fn().mockResolvedValue({ tasks: [task] })
		} as unknown as TasksDomain;
		const service = new SkillRunService(tmpDir, mockTasksDomain);
		vi.spyOn(service as any, 'executeCodex').mockResolvedValue({
			exitCode: 0,
			signal: null,
			durationMs: 10,
			logFile: path.join(tmpDir, 'log.txt'),
			timedOut: false,
			timeoutMs: 1000,
			timeoutKind: null,
			parsedResult: null
		});

		await service.run({ mode: 'lite', maxRetries: 1 });

		const todoPath = path.join(tmpDir, 'TODO.csv');
		const specPath = path.join(
			tmpDir,
			'.codex-tasks',
			'taskmaster-longrun',
			'SPEC.md'
		);
		const progressPath = path.join(
			tmpDir,
			'.codex-tasks',
			'taskmaster-longrun',
			'PROGRESS.md'
		);
		const todoRaw = await readFile(todoPath, 'utf-8');
		expect(todoRaw).toContain('id,task,status,completed_at,notes');
		expect(todoRaw).not.toContain('acceptance_criteria');
		await expect(readFile(specPath, 'utf-8')).rejects.toThrow();
		await expect(readFile(progressPath, 'utf-8')).rejects.toThrow();
	});

	it('marks task done from parsed TM_RESULT even when exit code is non-zero', async () => {
		const task: Task = {
			id: '1',
			title: 'parsed success task',
			description: 'd',
			status: 'pending',
			priority: 'medium',
			dependencies: [],
			details: 'details',
			testStrategy: 'test',
			subtasks: []
		};
		const getNext = vi
			.fn()
			.mockResolvedValueOnce(task)
			.mockResolvedValueOnce(null);
		const updateStatus = vi.fn().mockResolvedValue(undefined);
		const list = vi.fn().mockResolvedValue({ tasks: [task] });
		const mockTasksDomain = {
			getNext,
			updateStatus,
			list
		} as unknown as TasksDomain;
		const service = new SkillRunService(tmpDir, mockTasksDomain);
		vi.spyOn(service as any, 'executeCodex').mockResolvedValue({
			exitCode: 1,
			signal: 'SIGTERM',
			durationMs: 20,
			logFile: path.join(tmpDir, 'log.txt'),
			timedOut: false,
			timeoutMs: 1000,
			timeoutKind: null,
			parsedResult: {
				status: 'done',
				validation: 'pass',
				summary: 'ok',
				raw: '{"status":"done","validation":"pass","summary":"ok"}'
			}
		});

		const result = await service.run({ maxRetries: 1 });

		expect(result.finalStatus).toBe('all_complete');
		expect(result.completedTaskIds).toContain('1');
		expect(updateStatus).toHaveBeenCalledWith('1', 'done', undefined);
	});

	it('treats timeout without parsed result as failure', async () => {
		const task: Task = {
			id: '1',
			title: 'timeout task',
			description: 'd',
			status: 'pending',
			priority: 'medium',
			dependencies: [],
			details: 'details',
			testStrategy: 'test',
			subtasks: []
		};
		const getNext = vi.fn().mockResolvedValueOnce(task);
		const updateStatus = vi.fn().mockResolvedValue(undefined);
		const list = vi.fn().mockResolvedValue({ tasks: [task] });
		const mockTasksDomain = {
			getNext,
			updateStatus,
			list
		} as unknown as TasksDomain;
		const service = new SkillRunService(tmpDir, mockTasksDomain);
		vi.spyOn(service as any, 'executeCodex').mockResolvedValue({
			exitCode: null,
			signal: 'SIGTERM',
			durationMs: 21,
			logFile: path.join(tmpDir, 'log.txt'),
			timedOut: true,
			timeoutMs: 5000,
			timeoutKind: 'hard',
			parsedResult: null
		});

		const result = await service.run({
			maxRetries: 0,
			continueOnFailure: false
		});

		expect(result.finalStatus).toBe('error');
		expect(result.errorMessage).toContain('failed');
		expect(updateStatus).toHaveBeenCalledWith('1', 'blocked', undefined);
	});

	it('continues by default when continueOnFailure is not provided', async () => {
		const task1: Task = {
			id: '1',
			title: 'first task',
			description: 'd1',
			status: 'pending',
			priority: 'medium',
			dependencies: [],
			details: 'details-1',
			testStrategy: 'test-1',
			subtasks: []
		};
		const task2: Task = {
			id: '2',
			title: 'second task',
			description: 'd2',
			status: 'pending',
			priority: 'medium',
			dependencies: [],
			details: 'details-2',
			testStrategy: 'test-2',
			subtasks: []
		};
		const getNext = vi
			.fn()
			.mockResolvedValueOnce(task1)
			.mockResolvedValueOnce(task2)
			.mockResolvedValueOnce(null);
		const updateStatus = vi.fn().mockResolvedValue(undefined);
		const list = vi.fn().mockResolvedValue({ tasks: [task1, task2] });
		const mockTasksDomain = {
			getNext,
			updateStatus,
			list
		} as unknown as TasksDomain;
		const service = new SkillRunService(tmpDir, mockTasksDomain);
		vi.spyOn(service as any, 'executeCodex')
			.mockResolvedValueOnce({
				exitCode: 1,
				signal: null,
				durationMs: 10,
				logFile: path.join(tmpDir, 'task1.log'),
				timedOut: false,
				parsedResult: null
			})
			.mockResolvedValueOnce({
				exitCode: 0,
				signal: null,
				durationMs: 12,
				logFile: path.join(tmpDir, 'task2.log'),
				timedOut: false,
				parsedResult: null
			});

		const result = await service.run({
			maxRetries: 1
		});

		expect(result.finalStatus).toBe('all_complete');
		expect(updateStatus).toHaveBeenCalledWith('1', 'pending', undefined);
		expect(updateStatus).toHaveBeenCalledWith('2', 'done', undefined);
	});

	it('injects machine-readable result instructions into prompt', () => {
		const mockTasksDomain = {
			list: vi.fn().mockResolvedValue({ tasks: [] })
		} as unknown as TasksDomain;
		const service = new SkillRunService(tmpDir, mockTasksDomain);
		const prompt = (service as any).composePrompt(
			{
				id: '1',
				title: 'prompt task',
				description: 'd',
				status: 'pending',
				priority: 'medium',
				dependencies: [],
				details: 'details',
				testStrategy: 'test',
				subtasks: []
			},
			(service as any).resolvePaths()
		);

		expect(prompt).toContain('TM_RESULT:');
		expect(prompt).toContain('不要调用 task-master-local 的状态更新能力');
	});
});
