import { useCallback, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { importLinearIssue } from "@/runtime/integrations-query";

export function useImportLinearIssue(workspaceId: string | null) {
	const [isImporting, setIsImporting] = useState(false);

	const importIssue = useCallback(
		async (issueId: string) => {
			if (!workspaceId) {
				throw new Error("Select a project before importing from Linear.");
			}
			setIsImporting(true);
			try {
				const imported = await importLinearIssue(workspaceId, issueId);
				showAppToast({
					intent: "success",
					message: `Imported ${imported.issue.identifier} into backlog.`,
					timeout: 4000,
				});
				return imported;
			} catch (error) {
				showAppToast({
					intent: "danger",
					message: error instanceof Error ? error.message : String(error),
					timeout: 6000,
				});
				throw error;
			} finally {
				setIsImporting(false);
			}
		},
		[workspaceId],
	);

	return {
		importIssue,
		isImporting,
	};
}
