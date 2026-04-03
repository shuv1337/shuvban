import { useCallback } from "react";

import { listLinearIssues } from "@/runtime/integrations-query";
import type { LinearIssueSearchResult } from "@/runtime/types";
import { useTrpcQuery } from "@/runtime/use-trpc-query";

export function useLinearIssues(search: string, enabled: boolean, workspaceId: string | null) {
	const queryFn = useCallback(async (): Promise<LinearIssueSearchResult[]> => {
		return await listLinearIssues(workspaceId, { search, limit: 20 });
	}, [search, workspaceId]);
	return useTrpcQuery<LinearIssueSearchResult[]>({
		enabled: enabled && search.trim().length > 0,
		queryFn,
		retainDataOnError: true,
	});
}
