/**
 * @fileoverview Skill Run domain facade.
 */

import type { ConfigManager } from '../config/managers/config-manager.js';
import type { TasksDomain } from '../tasks/tasks-domain.js';
import { SkillRunService } from './services/skill-run.service.js';
import type {
	SkillRunInitOptions,
	SkillRunInitResult,
	SkillRunOptions,
	SkillRunResult
} from './types.js';

export class SkillRunDomain {
	private service: SkillRunService | null = null;
	private tasksDomain: TasksDomain | null = null;
	private readonly projectRoot: string;

	constructor(configManager: ConfigManager) {
		this.projectRoot = configManager.getProjectRoot();
	}

	setTasksDomain(tasksDomain: TasksDomain): void {
		this.tasksDomain = tasksDomain;
		this.service = new SkillRunService(this.projectRoot, this.tasksDomain);
	}

	async initAssets(options: SkillRunInitOptions = {}): Promise<SkillRunInitResult> {
		return this.getService().initAssets(options);
	}

	async run(options: SkillRunOptions = {}): Promise<SkillRunResult> {
		return this.getService().run(options);
	}

	private getService(): SkillRunService {
		if (!this.tasksDomain) {
			throw new Error('SkillRunDomain is not initialized with TasksDomain');
		}
		if (!this.service) {
			this.service = new SkillRunService(this.projectRoot, this.tasksDomain);
		}
		return this.service;
	}
}
