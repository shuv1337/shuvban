import type { RuntimeBoardCard, RuntimeBoardColumnId } from "../core/api-contract";
import type { LinearIntegrationConfig } from "./config-store";
import type { LinearRuntimeClient } from "./linear-client";
import { getAvailableStateTeamId, resolveLinearStatusTarget } from "./status-mapper";
import { writeIntegrationTelemetryEvent } from "./telemetry";

export interface SyncStatusTransitionInput {
	card: RuntimeBoardCard;
	toColumnId: RuntimeBoardColumnId;
	fromColumnId: RuntimeBoardColumnId | null;
	config: LinearIntegrationConfig;
	linearClient: LinearRuntimeClient;
	workspaceId?: string | null;
	repoPath?: string | null;
	agentId?: string | null;
}

export async function syncImportedIssueStatus(input: SyncStatusTransitionInput): Promise<RuntimeBoardCard> {
	if (!input.card.externalSource || input.card.externalSource.provider !== "linear") {
		return input.card;
	}
	const externalSource = input.card.externalSource;
	const teamId = getAvailableStateTeamId(externalSource);
	const availableStates = await input.linearClient.listWorkflowStates(teamId);
	const target = resolveLinearStatusTarget({
		columnId: input.toColumnId,
		fromColumnId: input.fromColumnId,
		config: input.config.statusMapping,
		availableStates,
	});
	if (!target) {
		return {
			...input.card,
			externalSync: {
				status: "idle",
				lastError: null,
			},
		};
	}
	try {
		await input.linearClient.updateIssueState(externalSource.issueId, target.stateId);
		writeIntegrationTelemetryEvent(
			"integration.linear.status_sync",
			{
				provider: "linear",
				workspaceId: input.workspaceId,
				repoPath: input.repoPath,
				taskId: input.card.id,
				issueId: externalSource.issueId,
				identifier: externalSource.identifier,
				agentId: input.agentId,
				operation: target.reason,
			},
			{ ok: true },
		);
		return {
			...input.card,
			externalSource: {
				...externalSource,
				lastSyncedAt: Date.now(),
			},
			externalSync: {
				status: "idle",
				lastError: null,
			},
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		writeIntegrationTelemetryEvent(
			"integration.linear.status_sync",
			{
				provider: "linear",
				workspaceId: input.workspaceId,
				repoPath: input.repoPath,
				taskId: input.card.id,
				issueId: externalSource.issueId,
				identifier: externalSource.identifier,
				agentId: input.agentId,
				operation: target.reason,
			},
			{ ok: false, errorName: error instanceof Error ? error.name : "Error", errorMessage: message },
		);
		return {
			...input.card,
			externalSync: {
				status: "error",
				lastError: message,
			},
		};
	}
}

export interface RefreshImportedIssueInput {
	card: RuntimeBoardCard;
	remoteTitle: string;
	remoteDescription: string | null;
	remoteUpdatedAt: number | null;
	teamId: string | null;
	projectId: string | null;
	parentIssueId: string | null;
	state: { id: string; name: string; type: string } | null;
	labelNames: string[];
	hasActiveSession: boolean;
	workspaceId?: string | null;
	repoPath?: string | null;
}

function formatPrompt(identifier: string, title: string, url: string, description: string | null): string {
	const lines = [`[${identifier}] ${title}`, "", `Source: ${url}`];
	if (description?.trim()) {
		lines.push("", description.trim());
	}
	return lines.join("\n").trim();
}

export function refreshImportedIssueMetadata(input: RefreshImportedIssueInput): RuntimeBoardCard {
	if (!input.card.externalSource || input.card.externalSource.provider !== "linear") {
		return input.card;
	}
	if (input.hasActiveSession) {
		writeIntegrationTelemetryEvent(
			"integration.linear.conflict_detected",
			{
				provider: "linear",
				workspaceId: input.workspaceId,
				repoPath: input.repoPath,
				taskId: input.card.id,
				issueId: input.card.externalSource.issueId,
				identifier: input.card.externalSource.identifier,
				operation: "refresh_imported_issue",
			},
			{ ok: false, reason: "active_session" },
		);
		return {
			...input.card,
			externalSync: {
				status: "error",
				lastError:
					"Remote changes detected while the task has an active local session. Refresh manually after reconciling local work.",
			},
		};
	}
	return {
		...input.card,
		prompt: formatPrompt(
			input.card.externalSource.identifier,
			input.remoteTitle,
			input.card.externalSource.url,
			input.remoteDescription,
		),
		externalSource: {
			...input.card.externalSource,
			teamId: input.teamId,
			projectId: input.projectId,
			parentIssueId: input.parentIssueId,
			lastRemoteUpdatedAt: input.remoteUpdatedAt,
			remoteState: input.state,
			labelNames: [...input.labelNames],
		},
		externalSync: {
			status: "idle",
			lastError: null,
		},
	};
}
