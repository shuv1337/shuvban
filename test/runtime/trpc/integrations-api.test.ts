import { describe, expect, it, vi } from "vitest";

import type { RuntimeBoardData } from "../../../src/core/api-contract";
import type { LinearIssue } from "../../../src/integrations/linear-types";
import { createIntegrationsApi } from "../../../src/trpc/integrations-api";

vi.mock("../../../src/state/workspace-state.js", async () => {
	const actual = await vi.importActual<typeof import("../../../src/state/workspace-state.js")>(
		"../../../src/state/workspace-state.js",
	);
	return {
		...actual,
		mutateWorkspaceState: vi.fn(async (_cwd, mutate) => {
			const result = mutate({
				repoPath: "/tmp/repo",
				statePath: "/tmp/state",
				git: { currentBranch: "main", defaultBranch: "main", branches: ["main"] },
				board: createBoard(),
				sessions: {},
				revision: 0,
			});
			return {
				value: result.value,
				state: {
					repoPath: "/tmp/repo",
					statePath: "/tmp/state",
					git: { currentBranch: "main", defaultBranch: "main", branches: ["main"] },
					board: result.board,
					sessions: {},
					revision: 1,
				},
				saved: result.save !== false,
			};
		}),
	};
});

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
		title: "Import me",
		description: "hello",
		url: "https://linear.app/example/ENG-123",
		teamId: "team-1",
		teamKey: "ENG",
		teamName: "Engineering",
		projectId: null,
		projectName: null,
		parentIssueId: null,
		parentIdentifier: null,
		parentTitle: null,
		state: { id: "todo", name: "Todo", type: "backlog", teamId: "team-1" },
		labelNames: [],
		labels: [],
		createdAt: 1,
		updatedAt: 2,
		...overrides,
	};
}

describe("createIntegrationsApi", () => {
	it("returns configured status when Linear client is available", async () => {
		const api = createIntegrationsApi({
			loadLinearConfig: async () => ({
				defaultTeamId: "team-1",
				searchableTeamIds: ["team-1"],
				statusMapping: {
					backlogStateId: null,
					inProgressStateId: null,
					reviewStateId: null,
					doneStateId: null,
				},
				importFormatting: { includeSourceUrl: true },
			}),
			createLinearClient: () => ({
				isConfigured: () => true,
				listIssues: async () => [],
				getIssue: async () => createIssue(),
				updateIssueState: async () => undefined,
				createIssue: async () => createIssue(),
				listWorkflowStates: async () => [],
			}),
			broadcastRuntimeWorkspaceStateUpdated: vi.fn(),
		});

		await expect(api.getIntegrationStatus()).resolves.toMatchObject({
			configured: true,
			provider: "linear",
		});
	});

	it("imports a Linear issue into backlog and returns card metadata", async () => {
		const broadcast = vi.fn();
		const api = createIntegrationsApi({
			createLinearClient: () => ({
				isConfigured: () => true,
				listIssues: async () => [],
				getIssue: async () => createIssue(),
				updateIssueState: async () => undefined,
				createIssue: async () => createIssue(),
				listWorkflowStates: async () => [],
			}),
			broadcastRuntimeWorkspaceStateUpdated: broadcast,
		});
		const response = await api.importLinearIssue(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ issueId: "issue-1" },
		);

		expect(response.issue.identifier).toBe("ENG-123");
		expect(response.card.externalSource.identifier).toBe("ENG-123");
		expect(broadcast).toHaveBeenCalledWith("workspace-1", "/tmp/repo");
	});
});
