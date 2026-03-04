import {
	createErrorResponse,
	handleApiResult,
	withNormalizedProjectRoot
} from '@tm/mcp';
import { z } from 'zod';
import { RULE_PROFILES } from '../../../src/constants/profiles.js';
import { initializeProjectDirect } from '../core/task-master-core.js';

export function registerInitializeProjectTool(server) {
	server.addTool({
		name: 'initialize_project',
		description:
			'Initializes a new Task Master project structure by calling the core initialization logic. Creates necessary folders and configuration files for Task Master in the current directory. If you are using Codex CLI, set withCodex=true (and keep yes=true) so Codex longrun assets are created in the same step.',
		parameters: z.object({
			skipInstall: z
				.boolean()
				.optional()
				.default(false)
				.describe(
					'Skip installing dependencies automatically. Never do this unless you are sure the project is already installed.'
				),
			addAliases: z
				.boolean()
				.optional()
				.default(true)
				.describe(
					'Add shell aliases (tm, taskmaster, hamster, ham) to shell config file.'
				),
			initGit: z
				.boolean()
				.optional()
				.default(true)
				.describe('Initialize Git repository in project root.'),
			storeTasksInGit: z
				.boolean()
				.optional()
				.default(true)
				.describe('Store tasks in Git (tasks.json and tasks/ directory).'),
			yes: z
				.boolean()
				.optional()
				.default(true)
				.describe(
					'Skip prompts and use default values. Always set to true for MCP tools.'
				),
			withCodex: z
				.boolean()
				.optional()
				.default(false)
				.describe(
					'Initialize Codex longrun assets together with project init. For Codex CLI workflows, set this to true.'
				),
			projectRoot: z
				.string()
				.describe(
					'The root directory for the project. ALWAYS SET THIS TO THE PROJECT ROOT DIRECTORY. IF NOT SET, THE TOOL WILL NOT WORK.'
				),
			rules: z
				.array(z.enum(RULE_PROFILES))
				.optional()
				.describe(
					`List of rule profiles to include at initialization. If omitted, defaults to Cursor profile only. Available options: ${RULE_PROFILES.join(', ')}`
				)
		}),
		annotations: {
			title: 'Initialize Project',
			destructiveHint: true
		},
		execute: withNormalizedProjectRoot(async (args, context) => {
			const { log } = context;
			const session = context.session;

			try {
				log.info(
					`Executing initialize_project tool with args: ${JSON.stringify(args)}`
				);

				const result = await initializeProjectDirect(args, log, { session });

				return handleApiResult({
					result,
					log: log,
					errorPrefix: 'Initialization failed',
					projectRoot: args.projectRoot
				});
			} catch (error) {
				const errorMessage = `Project initialization tool failed: ${error.message || 'Unknown error'}`;
				log.error(errorMessage, error);
				return createErrorResponse(errorMessage, { details: error.stack });
			}
		})
	});
}
