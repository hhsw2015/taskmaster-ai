import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
		const spec = await readFile(specPath, 'utf-8');
		const progress = await readFile(progressPath, 'utf-8');
		expect(agents.match(/TM-LONGRUN-START/g)?.length).toBe(1);
		expect(skill).toContain('Taskmaster Longrun Skill');
		expect(skill.startsWith('---')).toBe(true);
		expect(skill.match(/TM-INTEGRATION-START/g)?.length).toBe(1);
		expect(skill).toContain('Taskmaster Integration Addendum');
		expect(skill).toContain('must not mutate Taskmaster status');
		expect(upstreamAgents).toContain('Global Agent Rules');
		expect(spec).toContain('# SPEC');
		expect(progress).toContain('# PROGRESS');
	});

	it('prefers existing lowercase agent.md as default target', async () => {
		const mockTasksDomain = {
			list: vi.fn().mockResolvedValue({ tasks: [] })
		} as unknown as TasksDomain;
		const service = new SkillRunService(tmpDir, mockTasksDomain);
		const lowerAgentsPath = path.join(tmpDir, 'agent.md');
		await writeFile(lowerAgentsPath, '# Existing agent instructions\n', 'utf-8');

		const result = await service.initAssets();

		expect(result.paths.agentsPath).toBe(lowerAgentsPath);
		const agents = await readFile(lowerAgentsPath, 'utf-8');
		expect(agents).toContain('Existing agent instructions');
		expect(agents).toContain('TM-LONGRUN-START');
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
