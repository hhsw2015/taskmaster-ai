import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_VERSION = 'unknown';
const PACKAGE_JSON_NAME = 'package.json';

function hasTaskMasterBin(packageJson) {
	if (!packageJson || typeof packageJson !== 'object') {
		return false;
	}

	const bin = packageJson.bin;
	if (!bin || typeof bin !== 'object') {
		return false;
	}

	return (
		Object.prototype.hasOwnProperty.call(bin, 'task-master') ||
		Object.prototype.hasOwnProperty.call(bin, 'task-master-ai')
	);
}

function readJsonFile(filePath) {
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf8'));
	} catch {
		return null;
	}
}

export function resolveTaskMasterPackageJsonPath(
	startDir = path.dirname(fileURLToPath(import.meta.url))
) {
	let currentDir = startDir;

	while (true) {
		const candidatePath = path.join(currentDir, PACKAGE_JSON_NAME);
		if (fs.existsSync(candidatePath)) {
			const packageJson = readJsonFile(candidatePath);
			if (hasTaskMasterBin(packageJson)) {
				return candidatePath;
			}
		}

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) {
			return null;
		}
		currentDir = parentDir;
	}
}

/**
 * Reads the version from the Task Master CLI package.json at runtime.
 * Falls back to npm_package_version and then 'unknown'.
 * @returns {string} The version string or 'unknown'.
 */
export function getTaskMasterVersion() {
	const packageJsonPath = resolveTaskMasterPackageJsonPath();
	if (!packageJsonPath) {
		return process.env.npm_package_version || DEFAULT_VERSION;
	}

	const packageJson = readJsonFile(packageJsonPath);
	if (!packageJson || typeof packageJson.version !== 'string') {
		return process.env.npm_package_version || DEFAULT_VERSION;
	}

	const version = packageJson.version.trim();
	return version.length > 0
		? version
		: process.env.npm_package_version || DEFAULT_VERSION;
}
