import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	ImportedIssueRefreshInput,
	ImportedIssueStatusSyncInput,
	ImportedLinearIssueResponse,
	IntegrationStatus,
	LinearIssueSearchResult,
	RuntimeBoardCard,
} from "@/runtime/types";

export async function fetchLinearIntegrationStatus(workspaceId: string | null): Promise<IntegrationStatus> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.integrations.getIntegrationStatus.query();
}

export async function listLinearIssues(
	workspaceId: string | null,
	input: { search: string; limit?: number },
): Promise<LinearIssueSearchResult[]> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.integrations.listLinearIssues.query(input);
}

export async function importLinearIssue(workspaceId: string, issueId: string): Promise<ImportedLinearIssueResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.integrations.importLinearIssue.mutate({ issueId });
}

export async function refreshImportedIssue(
	workspaceId: string,
	input: ImportedIssueRefreshInput,
): Promise<RuntimeBoardCard> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.integrations.refreshImportedIssue.mutate(input);
}

export async function syncImportedIssueStatus(
	workspaceId: string,
	input: ImportedIssueStatusSyncInput,
): Promise<RuntimeBoardCard> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.integrations.syncImportedIssueStatus.mutate(input);
}
