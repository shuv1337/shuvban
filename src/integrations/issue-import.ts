import type { RuntimeBoardCard, RuntimeBoardCardExternalSource, RuntimeBoardData } from "../core/api-contract";
import { addTaskToColumn, type RuntimeCreateTaskInput } from "../core/task-board-mutations";
import type { LinearIssue } from "./linear-types";

function normalizeIssueDescription(description: string | null): string {
	return description?.trim() ?? "";
}

export function formatImportedLinearIssuePrompt(issue: LinearIssue): string {
	const lines = [`[${issue.identifier}] ${issue.title}`, "", `Source: ${issue.url}`];
	const description = normalizeIssueDescription(issue.description);
	if (description) {
		lines.push("", description);
	}
	return lines.join("\n").trim();
}

export function buildImportedLinearExternalSource(issue: LinearIssue): RuntimeBoardCardExternalSource {
	return {
		provider: "linear",
		issueId: issue.issueId,
		identifier: issue.identifier,
		url: issue.url,
		teamId: issue.teamId,
		projectId: issue.projectId,
		parentIssueId: issue.parentIssueId,
		lastRemoteUpdatedAt: issue.updatedAt,
		lastSyncedAt: null,
		remoteState: issue.state
			? {
					id: issue.state.id,
					name: issue.state.name,
					type: issue.state.type,
				}
			: null,
		labelNames: [...issue.labelNames],
	};
}

export function createImportedLinearTaskInput(issue: LinearIssue, baseRef: string): RuntimeCreateTaskInput {
	return {
		prompt: formatImportedLinearIssuePrompt(issue),
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit",
		baseRef,
	};
}

export function importLinearIssueIntoBoard(options: {
	board: RuntimeBoardData;
	issue: LinearIssue;
	baseRef: string;
	randomUuid: () => string;
	now?: number;
}): { board: RuntimeBoardData; task: RuntimeBoardCard } {
	const created = addTaskToColumn(
		options.board,
		"backlog",
		createImportedLinearTaskInput(options.issue, options.baseRef),
		options.randomUuid,
		options.now,
	);
	const task: RuntimeBoardCard = {
		...created.task,
		externalSource: buildImportedLinearExternalSource(options.issue),
		externalSync: {
			status: "idle",
			lastError: null,
		},
	};
	const board = {
		...created.board,
		columns: created.board.columns.map((column) => {
			if (column.id !== "backlog") {
				return column;
			}
			return {
				...column,
				cards: column.cards.map((card) => (card.id === task.id ? task : card)),
			};
		}),
	};
	return { board, task };
}
