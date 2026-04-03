import { LinearClient } from "@linear/sdk";

import type { LinearCreateIssueInput, LinearIssue, LinearIssueSearchResult, LinearWorkflowState } from "./linear-types";
import { measureIntegrationOperation } from "./telemetry";

interface LinearClientIssueNode {
	id: string;
	identifier: string;
	title: string;
	description?: string | null;
	url: string;
	updatedAt?: string | null;
	createdAt?: string | null;
	parent?: Promise<LinearClientIssueNode | null> | LinearClientIssueNode | null;
	project?: Promise<{ id: string; name: string } | null> | { id: string; name: string } | null;
	state?:
		| Promise<{ id: string; name: string; type: string } | null>
		| { id: string; name: string; type: string }
		| null;
	team?:
		| Promise<{ id: string; key?: string | null; name?: string | null } | null>
		| { id: string; key?: string | null; name?: string | null }
		| null;
	labels?: (() => Promise<{ nodes: Array<{ id: string; name: string; color?: string | null }> }>) | null;
}

export interface LinearRuntimeClient {
	isConfigured: () => boolean;
	listIssues: (input: { search: string; teamIds?: string[]; limit?: number }) => Promise<LinearIssueSearchResult[]>;
	getIssue: (issueId: string) => Promise<LinearIssue>;
	updateIssueState: (issueId: string, stateId: string) => Promise<void>;
	createIssue: (input: LinearCreateIssueInput) => Promise<LinearIssue>;
	listWorkflowStates: (teamId?: string | null) => Promise<LinearWorkflowState[]>;
}

function parseTimestamp(value: string | null | undefined): number | null {
	if (!value) {
		return null;
	}
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

async function mapLinearIssue(issue: LinearClientIssueNode): Promise<LinearIssue> {
	const [labelsResult, team, project, parent, state] = await Promise.all([
		issue.labels ? issue.labels().catch(() => ({ nodes: [] })) : Promise.resolve({ nodes: [] }),
		Promise.resolve(issue.team ?? null),
		Promise.resolve(issue.project ?? null),
		Promise.resolve(issue.parent ?? null),
		Promise.resolve(issue.state ?? null),
	]);
	const labels = labelsResult.nodes.map((label) => ({
		id: label.id,
		name: label.name,
		color: label.color ?? null,
	}));
	return {
		provider: "linear",
		issueId: issue.id,
		identifier: issue.identifier,
		title: issue.title,
		description: issue.description ?? null,
		url: issue.url,
		teamId: team?.id ?? null,
		teamKey: team?.key ?? null,
		teamName: team?.name ?? null,
		projectId: project?.id ?? null,
		projectName: project?.name ?? null,
		parentIssueId: parent?.id ?? null,
		parentIdentifier: parent?.identifier ?? null,
		parentTitle: parent?.title ?? null,
		state: state
			? {
					id: state.id,
					name: state.name,
					type: state.type,
					teamId: team?.id ?? null,
				}
			: null,
		labelNames: labels.map((label) => label.name),
		labels,
		createdAt: parseTimestamp(issue.createdAt),
		updatedAt: parseTimestamp(issue.updatedAt),
	};
}

function createUnconfiguredLinearClient(): LinearRuntimeClient {
	const throwUnconfigured = (): never => {
		throw new Error("Linear integration is not configured. Set LINEAR_API_KEY to enable it.");
	};
	return {
		isConfigured: () => false,
		listIssues: async () => throwUnconfigured(),
		getIssue: async () => throwUnconfigured(),
		updateIssueState: async () => throwUnconfigured(),
		createIssue: async () => throwUnconfigured(),
		listWorkflowStates: async () => throwUnconfigured(),
	};
}

export function createLinearRuntimeClient(): LinearRuntimeClient {
	const apiKey = process.env.LINEAR_API_KEY?.trim() ?? "";
	if (!apiKey) {
		return createUnconfiguredLinearClient();
	}
	const client = new LinearClient({ apiKey });

	return {
		isConfigured: () => true,
		listIssues: async ({ search, teamIds, limit }) =>
			await measureIntegrationOperation(
				"integration.linear.request",
				{ provider: "linear", operation: "list_issues" },
				async () => {
					const searchPayload = await client.searchIssues(search, {
						first: limit ?? 20,
						teamId: teamIds && teamIds.length === 1 ? teamIds[0] : undefined,
					});
					const issues = await Promise.all(
						searchPayload.nodes.map(
							async (issue) => await mapLinearIssue(issue as unknown as LinearClientIssueNode),
						),
					);
					if (!teamIds || teamIds.length === 0) {
						return issues.map((issue) => ({
							provider: issue.provider,
							issueId: issue.issueId,
							identifier: issue.identifier,
							title: issue.title,
							url: issue.url,
							teamId: issue.teamId,
							teamKey: issue.teamKey,
							teamName: issue.teamName,
							projectId: issue.projectId,
							projectName: issue.projectName,
							parentIssueId: issue.parentIssueId,
							parentIdentifier: issue.parentIdentifier,
							parentTitle: issue.parentTitle,
							state: issue.state,
							labelNames: issue.labelNames,
							updatedAt: issue.updatedAt,
						}));
					}
					return issues
						.filter((issue) => issue.teamId !== null && teamIds.includes(issue.teamId))
						.map((issue) => ({
							provider: issue.provider,
							issueId: issue.issueId,
							identifier: issue.identifier,
							title: issue.title,
							url: issue.url,
							teamId: issue.teamId,
							teamKey: issue.teamKey,
							teamName: issue.teamName,
							projectId: issue.projectId,
							projectName: issue.projectName,
							parentIssueId: issue.parentIssueId,
							parentIdentifier: issue.parentIdentifier,
							parentTitle: issue.parentTitle,
							state: issue.state,
							labelNames: issue.labelNames,
							updatedAt: issue.updatedAt,
						}));
				},
			),
		getIssue: async (issueId) =>
			await measureIntegrationOperation(
				"integration.linear.request",
				{ provider: "linear", operation: "get_issue", issueId },
				async () => await mapLinearIssue((await client.issue(issueId)) as unknown as LinearClientIssueNode),
			),
		updateIssueState: async (issueId, stateId) => {
			await measureIntegrationOperation(
				"integration.linear.request",
				{ provider: "linear", operation: "update_issue_state", issueId },
				async () => {
					const response = await client.updateIssue(issueId, { stateId });
					if (!response.success) {
						throw new Error(`Linear rejected issue state update for ${issueId}.`);
					}
				},
			);
		},
		createIssue: async (input) =>
			await measureIntegrationOperation(
				"integration.linear.request",
				{ provider: "linear", operation: "create_issue", issueId: input.parentIssueId ?? null },
				async () => {
					const response = await client.createIssue({
						title: input.title,
						description: input.description,
						teamId: input.teamId,
						projectId: input.projectId,
						parentId: input.parentIssueId,
					});
					if (!response.success || !response.issue) {
						throw new Error("Linear did not return a created issue.");
					}
					return await mapLinearIssue(response.issue as unknown as LinearClientIssueNode);
				},
			),
		listWorkflowStates: async (teamId) =>
			await measureIntegrationOperation(
				"integration.linear.request",
				{ provider: "linear", operation: "list_workflow_states" },
				async () => {
					const payload = await client.workflowStates({ first: 100 });
					const states = await Promise.all(
						payload.nodes.map(async (state) => {
							const team = await state.team;
							return {
								id: state.id,
								name: state.name,
								type: state.type,
								teamId: team?.id ?? null,
							};
						}),
					);
					return states.filter((state) => (teamId ? state.teamId === teamId : true));
				},
			),
	};
}
