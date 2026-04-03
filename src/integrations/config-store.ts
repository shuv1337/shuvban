import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

import { lockedFileSystem } from "../fs/locked-file-system";
import { getRuntimeHomePath } from "../state/workspace-state";

const linearStatusMappingSchema = z.object({
	backlogStateId: z.string().trim().min(1).nullable().default(null),
	inProgressStateId: z.string().trim().min(1).nullable().default(null),
	reviewStateId: z.string().trim().min(1).nullable().default(null),
	doneStateId: z.string().trim().min(1).nullable().default(null),
});
export type LinearStatusMapping = z.infer<typeof linearStatusMappingSchema>;

const linearIntegrationConfigSchema = z.object({
	defaultTeamId: z.string().trim().min(1).nullable().default(null),
	searchableTeamIds: z.array(z.string().trim().min(1)).default([]),
	statusMapping: linearStatusMappingSchema.default({
		backlogStateId: null,
		inProgressStateId: null,
		reviewStateId: null,
		doneStateId: null,
	}),
	importFormatting: z
		.object({
			includeSourceUrl: z.boolean().default(true),
		})
		.default({ includeSourceUrl: true }),
});
export type LinearIntegrationConfig = z.infer<typeof linearIntegrationConfigSchema>;

const integrationsConfigSchema = z.object({
	linear: linearIntegrationConfigSchema.default({
		defaultTeamId: null,
		searchableTeamIds: [],
		statusMapping: {
			backlogStateId: null,
			inProgressStateId: null,
			reviewStateId: null,
			doneStateId: null,
		},
		importFormatting: { includeSourceUrl: true },
	}),
});

type IntegrationsConfigFile = z.infer<typeof integrationsConfigSchema>;

const DEFAULT_LINEAR_CONFIG: LinearIntegrationConfig = integrationsConfigSchema.parse({}).linear;

function getIntegrationsDirectoryPath(): string {
	return join(getRuntimeHomePath(), "integrations");
}

function getIntegrationsConfigPath(): string {
	return join(getRuntimeHomePath(), "integrations.json");
}

async function readJsonFileIfExists(path: string): Promise<unknown | null> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as unknown;
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return null;
		}
		if (error instanceof Error) {
			throw new Error(`Could not read integration config at ${path}. ${error.message}`);
		}
		throw error;
	}
}

async function ensureIntegrationsDirectory(): Promise<void> {
	await mkdir(dirname(getIntegrationsConfigPath()), { recursive: true });
	await mkdir(getIntegrationsDirectoryPath(), { recursive: true });
}

export async function loadIntegrationConfig(): Promise<IntegrationsConfigFile> {
	const configPath = getIntegrationsConfigPath();
	const raw = await readJsonFileIfExists(configPath);
	if (raw === null) {
		return integrationsConfigSchema.parse({});
	}
	const parsed = integrationsConfigSchema.safeParse(raw);
	if (!parsed.success) {
		throw new Error(
			`Invalid integration config at ${configPath}. ${parsed.error.issues[0]?.message ?? "Unknown error."}`,
		);
	}
	return parsed.data;
}

export async function loadLinearIntegrationConfig(): Promise<LinearIntegrationConfig> {
	return (await loadIntegrationConfig()).linear;
}

export async function saveLinearIntegrationConfig(config: LinearIntegrationConfig): Promise<LinearIntegrationConfig> {
	await ensureIntegrationsDirectory();
	const nextFile = integrationsConfigSchema.parse({ linear: config });
	await lockedFileSystem.writeJsonFileAtomic(getIntegrationsConfigPath(), nextFile, { lock: null });
	return nextFile.linear;
}

export function getDefaultLinearIntegrationConfig(): LinearIntegrationConfig {
	return {
		defaultTeamId: DEFAULT_LINEAR_CONFIG.defaultTeamId,
		searchableTeamIds: [...DEFAULT_LINEAR_CONFIG.searchableTeamIds],
		statusMapping: { ...DEFAULT_LINEAR_CONFIG.statusMapping },
		importFormatting: { ...DEFAULT_LINEAR_CONFIG.importFormatting },
	};
}
