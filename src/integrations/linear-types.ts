import { z } from "zod";

import {
	runtimeBoardCardExternalSourceSchema,
	runtimeBoardCardExternalSyncSchema,
	runtimeExternalIssueProviderSchema,
	runtimeExternalIssueRemoteStateSchema,
} from "../core/api-contract";

export const integrationProviderSchema = runtimeExternalIssueProviderSchema;
export type IntegrationProvider = z.infer<typeof integrationProviderSchema>;

export const integrationStatusSchema = z.object({
	provider: integrationProviderSchema,
	configured: z.boolean(),
	statusLabel: z.enum(["configured", "missing_api_key"]),
	message: z.string(),
	defaultTeamId: z.string().nullable(),
	searchableTeamIds: z.array(z.string()),
});
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

export const linearIssueLabelSchema = z.object({
	id: z.string(),
	name: z.string(),
	color: z.string().nullable(),
});
export type LinearIssueLabel = z.infer<typeof linearIssueLabelSchema>;

export const linearWorkflowStateSchema = runtimeExternalIssueRemoteStateSchema.extend({
	teamId: z.string().nullable(),
});
export type LinearWorkflowState = z.infer<typeof linearWorkflowStateSchema>;

export const linearIssueSchema = z.object({
	provider: z.literal("linear"),
	issueId: z.string(),
	identifier: z.string(),
	title: z.string(),
	description: z.string().nullable(),
	url: z.string(),
	teamId: z.string().nullable(),
	teamKey: z.string().nullable(),
	teamName: z.string().nullable(),
	projectId: z.string().nullable(),
	projectName: z.string().nullable(),
	parentIssueId: z.string().nullable(),
	parentIdentifier: z.string().nullable(),
	parentTitle: z.string().nullable(),
	state: linearWorkflowStateSchema.nullable(),
	labelNames: z.array(z.string()),
	labels: z.array(linearIssueLabelSchema),
	createdAt: z.number().nullable(),
	updatedAt: z.number().nullable(),
});
export type LinearIssue = z.infer<typeof linearIssueSchema>;

export const linearIssueSearchResultSchema = linearIssueSchema.pick({
	provider: true,
	issueId: true,
	identifier: true,
	title: true,
	url: true,
	teamId: true,
	teamKey: true,
	teamName: true,
	projectId: true,
	projectName: true,
	parentIssueId: true,
	parentIdentifier: true,
	parentTitle: true,
	state: true,
	labelNames: true,
	updatedAt: true,
});
export type LinearIssueSearchResult = z.infer<typeof linearIssueSearchResultSchema>;

export const linearIssueListInputSchema = z.object({
	search: z.string().trim().min(1),
	teamIds: z.array(z.string().trim().min(1)).optional(),
	limit: z.number().int().positive().max(50).optional(),
});
export type LinearIssueListInput = z.infer<typeof linearIssueListInputSchema>;

export const linearIssueLookupInputSchema = z.object({
	issueId: z.string().trim().min(1),
});
export type LinearIssueLookupInput = z.infer<typeof linearIssueLookupInputSchema>;

export const linearIssueImportInputSchema = z.object({
	issueId: z.string().trim().min(1),
});
export type LinearIssueImportInput = z.infer<typeof linearIssueImportInputSchema>;

export const importedLinearIssueResponseSchema = z.object({
	issue: linearIssueSchema,
	card: z.object({
		id: z.string(),
		prompt: z.string(),
		externalSource: runtimeBoardCardExternalSourceSchema,
		externalSync: runtimeBoardCardExternalSyncSchema.optional(),
	}),
});
export type ImportedLinearIssueResponse = z.infer<typeof importedLinearIssueResponseSchema>;

export const importedIssueRefreshInputSchema = z.object({
	taskId: z.string().trim().min(1),
});
export type ImportedIssueRefreshInput = z.infer<typeof importedIssueRefreshInputSchema>;

export const importedIssueStatusSyncInputSchema = z.object({
	taskId: z.string().trim().min(1),
	fromColumnId: z.enum(["backlog", "in_progress", "review", "trash"]).nullable().optional(),
	force: z.boolean().optional(),
});
export type ImportedIssueStatusSyncInput = z.infer<typeof importedIssueStatusSyncInputSchema>;

export const linearCreateIssueInputSchema = z.object({
	title: z.string().trim().min(1),
	description: z.string().trim().optional(),
	teamId: z.string().trim().min(1),
	projectId: z.string().trim().optional(),
	parentIssueId: z.string().trim().optional(),
});
export type LinearCreateIssueInput = z.infer<typeof linearCreateIssueInputSchema>;

export const linearCreateIssueResponseSchema = linearIssueSchema;
export type LinearCreateIssueResponse = z.infer<typeof linearCreateIssueResponseSchema>;
