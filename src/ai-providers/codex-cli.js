/**
 * src/ai-providers/codex-cli.js
 *
 * Codex CLI provider implementation using the ai-sdk-provider-codex-cli package.
 * This provider uses the local OpenAI Codex CLI with OAuth (preferred) or
 * an optional OPENAI_CODEX_API_KEY if provided.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createCodexCli } from 'ai-sdk-provider-codex-cli';
import {
	getCodexCliSettingsForCommand,
	getSupportedModelsForProvider
} from '../../scripts/modules/config-manager.js';
import { log } from '../../scripts/modules/utils.js';
import { BaseAIProvider } from './base-provider.js';

/**
 * OpenAI model reasoning effort support.
 * Different models support different reasoning effort levels.
 * This is provider-specific logic that belongs here, not in the general model catalog.
 *
 * See: https://platform.openai.com/docs/guides/reasoning
 */
const REASONING_EFFORT_SUPPORT = {
	// GPT-5.1 base does not support xhigh
	'gpt-5.1': ['none', 'low', 'medium', 'high'],
	// GPT-5.1 Codex Max supports full range
	'gpt-5.1-codex-max': ['none', 'low', 'medium', 'high', 'xhigh'],
	// GPT-5.2 supports full range
	'gpt-5.2': ['none', 'low', 'medium', 'high', 'xhigh'],
	// GPT-5.3 Codex supports full range
	'gpt-5.3-codex': ['none', 'low', 'medium', 'high', 'xhigh'],
	// GPT-5.2 Pro only supports medium and above
	'gpt-5.2-pro': ['medium', 'high', 'xhigh'],
	// GPT-5 supports full range
	'gpt-5': ['none', 'low', 'medium', 'high', 'xhigh']
};

// Default for models not explicitly listed
const DEFAULT_REASONING_EFFORTS = ['none', 'low', 'medium', 'high'];

// Ordering for effort levels (lowest to highest)
const EFFORT_ORDER = ['none', 'low', 'medium', 'high', 'xhigh'];

export class CodexCliProvider extends BaseAIProvider {
	constructor() {
		super();
		this.name = 'Codex CLI';
		// Codex CLI has native schema support, no explicit JSON schema mode required
		this.needsExplicitJsonSchema = false;
		// Codex CLI does not support temperature parameter
		this.supportsTemperature = false;
		// Load supported models from supported-models.json
		this.supportedModels = getSupportedModelsForProvider('codex-cli');

		// Validate that models were loaded successfully
		if (this.supportedModels.length === 0) {
			log(
				'warn',
				'No supported models found for codex-cli provider. Check supported-models.json configuration.'
			);
		}

		// CLI availability check cache
		this._codexCliChecked = false;
		this._codexCliAvailable = null;
		this._preferredCodexPath = null;
	}

	/**
	 * Codex CLI does not require an API key when using OAuth via `codex login`.
	 * @returns {boolean}
	 */
	isRequiredApiKey() {
		return false;
	}

	/**
	 * Returns the environment variable name used when an API key is provided.
	 * Even though the API key is optional for Codex CLI (OAuth-first),
	 * downstream resolution expects a non-throwing implementation.
	 * Uses OPENAI_CODEX_API_KEY to avoid conflicts with OpenAI provider.
	 * @returns {string}
	 */
	getRequiredApiKeyName() {
		return 'OPENAI_CODEX_API_KEY';
	}

	/**
	 * Optional CLI availability check; provide helpful guidance if missing.
	 */
	validateAuth() {
		if (process.env.NODE_ENV === 'test') return;

		if (!this._codexCliChecked) {
			try {
				execSync('codex --version', { stdio: 'pipe', timeout: 1000 });
				this._codexCliAvailable = true;
				this._preferredCodexPath = this._detectSystemCodexPath();
			} catch (error) {
				this._codexCliAvailable = false;
				this._preferredCodexPath = null;
				log(
					'warn',
					'Codex CLI not detected. Install with: npm i -g @openai/codex or enable fallback with allowNpx.'
				);
			} finally {
				this._codexCliChecked = true;
			}
		}
	}

	/**
	 * Detects a system/global codex JS entrypoint path.
	 * Using a JS entrypoint keeps compatibility with older ai-sdk-provider-codex-cli
	 * versions that execute explicit `codexPath` as `node <path>`.
	 *
	 * @returns {string|null} Absolute path to codex.js when found, otherwise null
	 */
	_detectSystemCodexPath() {
		try {
			const npmGlobalRoot = execSync('npm root -g', {
				stdio: ['ignore', 'pipe', 'ignore'],
				timeout: 1000
			})
				.toString()
				.trim();
			const globalCodexJs = path.join(
				npmGlobalRoot,
				'@openai',
				'codex',
				'bin',
				'codex.js'
			);
			if (fs.existsSync(globalCodexJs)) {
				return globalCodexJs;
			}
		} catch {
			// Fall through
		}

		try {
			const codexOnPath = execSync('command -v codex', {
				stdio: ['ignore', 'pipe', 'ignore'],
				timeout: 1000
			})
				.toString()
				.trim();
			if (codexOnPath.endsWith('.js') && fs.existsSync(codexOnPath)) {
				return codexOnPath;
			}
		} catch {
			// Fall through
		}

		return null;
	}

	/**
	 * Resolve codex executable preference.
	 * Priority:
	 * 1) User-configured codexPath
	 * 2) System codex on PATH (preferred default)
	 * 3) Provider internal fallback resolution (bundled/npx)
	 *
	 * @param {object} settings - Codex CLI settings from config
	 * @returns {object} settings with codexPath injected when system codex is available
	 */
	_resolveExecutableSettings(settings) {
		// Respect explicit user configuration first.
		if (settings?.codexPath) {
			return settings;
		}

		// Reuse validateAuth detection cache in non-test runtime.
		if (!this._codexCliChecked) {
			this.validateAuth();
		}

		if (this._codexCliAvailable) {
			const preferredCodexPath =
				this._preferredCodexPath || this._detectSystemCodexPath();
			if (preferredCodexPath) {
				this._preferredCodexPath = preferredCodexPath;
				return { ...settings, codexPath: preferredCodexPath };
			}
		}

		return settings;
	}

	/**
	 * Gets a validated reasoningEffort for the model.
	 * If no effort is specified, returns the model's highest supported effort.
	 * If an unsupported effort is specified, caps it to the highest supported.
	 * @param {string} modelId - The model ID to check
	 * @param {string} [requestedEffort] - The requested reasoning effort (optional)
	 * @returns {string} The validated reasoning effort
	 */
	_getValidatedReasoningEffort(modelId, requestedEffort) {
		// Get supported efforts for this model, or use defaults
		const supportedEfforts =
			REASONING_EFFORT_SUPPORT[modelId] || DEFAULT_REASONING_EFFORTS;

		// Get the highest supported effort for this model
		const highestSupported = supportedEfforts.reduce((highest, effort) => {
			const currentIndex = EFFORT_ORDER.indexOf(effort);
			const highestIndex = EFFORT_ORDER.indexOf(highest);
			return currentIndex > highestIndex ? effort : highest;
		}, supportedEfforts[0]);

		// If no effort requested, use the model's highest supported
		if (!requestedEffort) {
			log(
				'debug',
				`No reasoning effort specified for ${modelId}. Using '${highestSupported}'.`
			);
			return highestSupported;
		}

		// If the requested effort is supported, use it
		if (supportedEfforts.includes(requestedEffort)) {
			return requestedEffort;
		}

		// Cap to the highest supported effort
		log(
			'warn',
			`Reasoning effort '${requestedEffort}' not supported by ${modelId}. Using '${highestSupported}' instead.`
		);

		return highestSupported;
	}

	/**
	 * Creates a Codex CLI client instance
	 * @param {object} params
	 * @param {string} [params.commandName] - Command name for settings lookup
	 * @param {string} [params.modelId] - Model ID for capability validation
	 * @param {string} [params.apiKey] - Optional API key (injected as OPENAI_API_KEY for Codex CLI)
	 * @returns {Function}
	 */
	getClient(params = {}) {
		try {
			// Merge global + command-specific settings from config
			const rawSettings =
				getCodexCliSettingsForCommand(params.commandName) || {};
			const settings = this._resolveExecutableSettings(rawSettings);

			// Get validated reasoningEffort - always pass to override Codex CLI global config
			const validatedReasoningEffort = this._getValidatedReasoningEffort(
				params.modelId,
				settings.reasoningEffort
			);

			// Inject API key only if explicitly provided; OAuth is the primary path
			const defaultSettings = {
				...settings,
				reasoningEffort: validatedReasoningEffort,
				...(params.apiKey
					? { env: { ...(settings.env || {}), OPENAI_API_KEY: params.apiKey } }
					: {})
			};

			return createCodexCli({ defaultSettings });
		} catch (error) {
			const msg = String(error?.message || '');
			const code = error?.code;
			if (code === 'ENOENT' || /codex/i.test(msg)) {
				const enhancedError = new Error(
					`Codex CLI not available. Please install Codex CLI first. Original error: ${error.message}`
				);
				enhancedError.cause = error;
				this.handleError('Codex CLI initialization', enhancedError);
			} else {
				this.handleError('client initialization', error);
			}
		}
	}
}
