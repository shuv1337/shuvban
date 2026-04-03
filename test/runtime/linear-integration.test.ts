import { describe, expect, it } from "vitest";

import type { RuntimeBoardData } from "../../src/core/api-contract";
import { getDefaultLinearIntegrationConfig } from "../../src/integrations/config-store";
import {
	buildImportedLinearExternalSource,
	formatImportedLinearIssuePrompt,
	importLinearIssueIntoBoard,
} from "../../src/integrations/issue-import";
import type { LinearIssue, LinearWorkflowState } from "../../src/integrations/linear-types";
import { resolveLinearStatusTarget } from "../../src/integrations/status-mapper";

function createBoard(): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

function createIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
	return {
		provider: "linear",
		issueId: "issue-1",
		identifier: "ENG-123",
		title: "Implement Linear import",
		description: "Bring Linear issues into backlog.",
		url: "https://linear.app/example/issue/ENG-123",
		teamId: "team-1",
		teamKey: "ENG",
		teamName: "Engineering",
		projectId: "project-1",
		projectName: "Shuvban",
		parentIssueId: null,
		parentIdentifier: null,
		parentTitle: null,
		state: {
			id: "state-backlog",
			name: "Todo",
			type: "backlog",
			teamId: "team-1",
		},
		labelNames: ["integration", "linear"],
		labels: [],
		createdAt: 1,
		updatedAt: 2,
		...overrides,
	};
}

describe("Linear issue import", () => {
	it("formats imported prompts with identifier, source url, and description", () => {
		const prompt = formatImportedLinearIssuePrompt(createIssue());
		expect(prompt).toContain("[ENG-123] Implement Linear import");
		expect(prompt).toContain("Source: https://linear.app/example/issue/ENG-123");
		expect(prompt).toContain("Bring Linear issues into backlog.");
	});

	it("persists external source metadata on imported backlog cards", () => {
		const imported = importLinearIssueIntoBoard({
			board: createBoard(),
			issue: createIssue(),
			baseRef: "main",
			randomUuid: () => "abcde12345",
			now: 123,
		});
		expect(imported.task.externalSource).toEqual(buildImportedLinearExternalSource(createIssue()));
		expect(imported.task.externalSync).toEqual({
			status: "idle",
			lastError: null,
		});
		expect(imported.board.columns[0]?.cards[0]?.id).toBe(imported.task.id);
	});
});

describe("Linear status mapping", () => {
	const states: LinearWorkflowState[] = [
		{ id: "backlog", name: "Todo", type: "backlog", teamId: "team-1" },
		{ id: "started", name: "In Progress", type: "started", teamId: "team-1" },
		{ id: "review", name: "In Review", type: "started", teamId: "team-1" },
		{ id: "done", name: "Done", type: "completed", teamId: "team-1" },
	];

	it("maps backlog, in_progress, and review using configured or inferred states", () => {
		const config = getDefaultLinearIntegrationConfig();
		expect(
			resolveLinearStatusTarget({ columnId: "backlog", config: config.statusMapping, availableStates: states }),
		).toEqual({
			stateId: "backlog",
			reason: "backlog",
		});
		expect(
			resolveLinearStatusTarget({ columnId: "in_progress", config: config.statusMapping, availableStates: states }),
		).toEqual({ stateId: "started", reason: "in_progress" });
		expect(
			resolveLinearStatusTarget({ columnId: "review", config: config.statusMapping, availableStates: states }),
		).toEqual({
			stateId: "review",
			reason: "review",
		});
	});

	it("only maps review to trash as done and ignores unsafe trash transitions", () => {
		const config = getDefaultLinearIntegrationConfig();
		expect(
			resolveLinearStatusTarget({
				columnId: "trash",
				fromColumnId: "review",
				config: config.statusMapping,
				availableStates: states,
			}),
		).toEqual({ stateId: "done", reason: "done" });
		expect(
			resolveLinearStatusTarget({
				columnId: "trash",
				fromColumnId: "backlog",
				config: config.statusMapping,
				availableStates: states,
			}),
		).toBeNull();
	});
});
