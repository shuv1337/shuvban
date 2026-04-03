import { useCallback } from "react";

import { fetchLinearIntegrationStatus } from "@/runtime/integrations-query";
import type { IntegrationStatus } from "@/runtime/types";
import { useTrpcQuery } from "@/runtime/use-trpc-query";

export function useLinearIntegrationStatus(workspaceId: string | null) {
	const queryFn = useCallback(
		async (): Promise<IntegrationStatus> => await fetchLinearIntegrationStatus(workspaceId),
		[workspaceId],
	);
	return useTrpcQuery<IntegrationStatus>({
		enabled: true,
		queryFn,
		retainDataOnError: true,
	});
}
