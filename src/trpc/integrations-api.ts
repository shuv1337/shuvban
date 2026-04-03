import { type RuntimeBoardCard, type RuntimeBoardData, runtimeBoardCardSchema } from "../core/api-contract";
import type { LinearIntegrationConfig } from "../integrations/config-store";
import { getDefaultLinearIntegrationConfig, loadLinearIntegrationConfig } from "../integrations/config-store";
import { importLinearIssueIntoBoard } from "../integrations/issue-import";
import { refreshImportedIssueMetadata, syncImportedIssueStatus } from "../integrations/issue-sync";
import type { LinearRuntimeClient } from "../integrations/linear-client";
import { createLinearRuntimeClient } from "../integrations/linear-client";
import {
	importedIssueRefreshInputSchema,
	importedIssueStatusSyncInputSchema,
	importedLinearIssueResponseSchema,
	integrationStatusSchema,
	linearCreateIssueInputSchema,
	linearCreateIssueResponseSchema,
	linearIssueImportInputSchema,
	linearIssueListInputSchema,
	linearIssueLookupInputSchema,
	linearIssueSchema,
	linearIssueSearchResultSchema,
} from "../integrations/linear-types";
import { writeIntegrationTelemetryEvent } from "../integrations/telemetry";
import { mutateWorkspaceState } from "../state/workspace-state";
import type { RuntimeTrpcContext } from "./app-router";

export interface CreateIntegrationsApiDependencies {
	loadLinearConfig?: () => Promise<LinearIntegrationConfig>;
	createLinearClient?: () => LinearRuntimeClient;
	broadcastRuntimeWorkspaceStateUpdated: (workspaceId: string, workspacePath: string) => Promise<void> | void;
}

function resolveBaseRef(git: {
	currentBranch: string | null;
	defaultBranch: string | null;
	branches: string[];
}): string {
	return git.currentBranch ?? git.defaultBranch ?? git.branches[0] ?? "main";
}

function findTask(
	board: RuntimeBoardData,
	taskId: string,
): { card: RuntimeBoardCard; columnId: RuntimeBoardData["columns"][number]["id"] } | null {
	for (const column of board.columns) {
		const card = column.cards.find((candidate) => candidate.id === taskId);
		if (card) {
			return { card, columnId: column.id };
		}
	}
	return null;
}

function replaceTask(board: RuntimeBoardData, taskId: string, nextCard: RuntimeBoardCard): RuntimeBoardData {
	return {
		...board,
		columns: board.columns.map((column) => ({
			...column,
			cards: column.cards.map((card) => (card.id === taskId ? nextCard : card)),
		})),
	};
}

function isTaskSessionActive(sessions: Record<string, { state: string | null | undefined }>, taskId: string): boolean {
	const session = sessions[taskId];
	return session?.state === "running" || session?.state === "awaiting_review";
}

function assertLinearExternalCard(card: RuntimeBoardCard): RuntimeBoardCard & {
	externalSource: NonNullable<RuntimeBoardCard["externalSource"]>;
} {
	if (!card.externalSource || card.externalSource.provider !== "linear") {
		throw new Error("Task is not linked to a Linear issue.");
	}
	return {
		...card,
		externalSource: card.externalSource,
	};
}

export function createIntegrationsApi(deps: CreateIntegrationsApiDependencies): RuntimeTrpcContext["integrationsApi"] {
	const loadLinearConfigImpl = deps.loadLinearConfig ?? loadLinearIntegrationConfig;
	const createLinearClientImpl = deps.createLinearClient ?? createLinearRuntimeClient;

	return {
		getIntegrationStatus: async () => {
			const config = await loadLinearConfigImpl().catch(() => getDefaultLinearIntegrationConfig());
			const linearClient = createLinearClientImpl();
			return integrationStatusSchema.parse({
				provider: "linear",
				configured: linearClient.isConfigured(),
				statusLabel: linearClient.isConfigured() ? "configured" : "missing_api_key",
				message: linearClient.isConfigured()
					? "Linear is configured via LINEAR_API_KEY."
					: "Set LINEAR_API_KEY in the environment where Shuvban runs to enable Linear integration.",
				defaultTeamId: config.defaultTeamId,
				searchableTeamIds: config.searchableTeamIds,
			});
		},
		listLinearIssues: async (input) => {
			const parsed = linearIssueListInputSchema.parse(input);
			const config = await loadLinearConfigImpl().catch(() => getDefaultLinearIntegrationConfig());
			const linearClient = createLinearClientImpl();
			const issues = await linearClient.listIssues({
				search: parsed.search,
				teamIds: parsed.teamIds && parsed.teamIds.length > 0 ? parsed.teamIds : config.searchableTeamIds,
				limit: parsed.limit,
			});
			return issues.map((issue) => linearIssueSearchResultSchema.parse(issue));
		},
		getLinearIssue: async (input) => {
			const parsed = linearIssueLookupInputSchema.parse(input);
			const linearClient = createLinearClientImpl();
			return linearIssueSchema.parse(await linearClient.getIssue(parsed.issueId));
		},
		importLinearIssue: async (scope, input) => {
			const parsed = linearIssueImportInputSchema.parse(input);
			const linearClient = createLinearClientImpl();
			const issue = await linearClient.getIssue(parsed.issueId);
			const mutation = await mutateWorkspaceState(scope.workspacePath, (state) => {
				const imported = importLinearIssueIntoBoard({
					board: state.board,
					issue,
					baseRef: resolveBaseRef(state.git),
					randomUuid: () => globalThis.crypto.randomUUID(),
				});
				return {
					board: imported.board,
					value: imported.task,
				};
			});
			await deps.broadcastRuntimeWorkspaceStateUpdated(scope.workspaceId, scope.workspacePath);
			writeIntegrationTelemetryEvent(
				"integration.linear.issue_imported",
				{
					provider: "linear",
					workspaceId: scope.workspaceId,
					repoPath: scope.workspacePath,
					taskId: mutation.value.id,
					issueId: issue.issueId,
					identifier: issue.identifier,
					operation: "import_issue",
				},
				{ ok: true },
			);
			return importedLinearIssueResponseSchema.parse({
				issue,
				card: {
					id: mutation.value.id,
					prompt: mutation.value.prompt,
					externalSource: mutation.value.externalSource,
					externalSync: mutation.value.externalSync,
				},
			});
		},
		refreshImportedIssue: async (scope, input) => {
			const parsed = importedIssueRefreshInputSchema.parse(input);
			const linearClient = createLinearClientImpl();
			const snapshot = await mutateWorkspaceState(scope.workspacePath, (state) => {
				const found = findTask(state.board, parsed.taskId);
				if (!found) {
					throw new Error(`Task ${parsed.taskId} was not found.`);
				}
				return {
					board: state.board,
					value: {
						card: assertLinearExternalCard(found.card),
						hasActiveSession: isTaskSessionActive(state.sessions, parsed.taskId),
					},
					save: false,
				};
			});
			const remoteIssue = await linearClient.getIssue(snapshot.value.card.externalSource.issueId);
			const persisted = await mutateWorkspaceState(scope.workspacePath, (state) => {
				const found = findTask(state.board, parsed.taskId);
				if (!found) {
					throw new Error(`Task ${parsed.taskId} was not found.`);
				}
				const nextCard = runtimeBoardCardSchema.parse(
					refreshImportedIssueMetadata({
						card: assertLinearExternalCard(found.card),
						remoteTitle: remoteIssue.title,
						remoteDescription: remoteIssue.description,
						remoteUpdatedAt: remoteIssue.updatedAt,
						teamId: remoteIssue.teamId,
						projectId: remoteIssue.projectId,
						parentIssueId: remoteIssue.parentIssueId,
						state: remoteIssue.state,
						labelNames: remoteIssue.labelNames,
						hasActiveSession: snapshot.value.hasActiveSession,
						workspaceId: scope.workspaceId,
						repoPath: scope.workspacePath,
					}),
				);
				return {
					board: replaceTask(state.board, parsed.taskId, nextCard),
					value: nextCard,
				};
			});
			await deps.broadcastRuntimeWorkspaceStateUpdated(scope.workspaceId, scope.workspacePath);
			return runtimeBoardCardSchema.parse(persisted.value);
		},
		syncImportedIssueStatus: async (scope, input) => {
			const parsed = importedIssueStatusSyncInputSchema.parse(input);
			const config = await loadLinearConfigImpl().catch(() => getDefaultLinearIntegrationConfig());
			const linearClient = createLinearClientImpl();
			const snapshot = await mutateWorkspaceState(scope.workspacePath, (state) => {
				const found = findTask(state.board, parsed.taskId);
				if (!found) {
					throw new Error(`Task ${parsed.taskId} was not found.`);
				}
				return {
					board: state.board,
					value: {
						card: assertLinearExternalCard(found.card),
						columnId: found.columnId,
						agentId: state.sessions[parsed.taskId]?.agentId ?? null,
					},
					save: false,
				};
			});
			const syncedCard = runtimeBoardCardSchema.parse(
				await syncImportedIssueStatus({
					card: snapshot.value.card,
					toColumnId: snapshot.value.columnId,
					fromColumnId: parsed.fromColumnId ?? null,
					config,
					linearClient,
					workspaceId: scope.workspaceId,
					repoPath: scope.workspacePath,
					agentId: snapshot.value.agentId,
				}),
			);
			const persisted = await mutateWorkspaceState(scope.workspacePath, (state) => ({
				board: replaceTask(state.board, parsed.taskId, syncedCard),
				value: syncedCard,
			}));
			await deps.broadcastRuntimeWorkspaceStateUpdated(scope.workspaceId, scope.workspacePath);
			return runtimeBoardCardSchema.parse(persisted.value);
		},
		createLinearIssue: async (_scope, input) => {
			const parsed = linearCreateIssueInputSchema.parse(input);
			const linearClient = createLinearClientImpl();
			return linearCreateIssueResponseSchema.parse(await linearClient.createIssue(parsed));
		},
		createLinearSubIssue: async (_scope, input) => {
			const parsed = linearCreateIssueInputSchema.parse(input);
			if (!parsed.parentIssueId) {
				throw new Error("createLinearSubIssue requires parentIssueId.");
			}
			const linearClient = createLinearClientImpl();
			return linearCreateIssueResponseSchema.parse(await linearClient.createIssue(parsed));
		},
	};
}
