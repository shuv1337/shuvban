import type { Dispatch, SetStateAction } from "react";
import { useCallback, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { refreshImportedIssue, syncImportedIssueStatus } from "@/runtime/integrations-query";
import type { BoardColumnId, BoardData } from "@/types";

function replaceCard(
	board: BoardData,
	taskId: string,
	nextCard: Awaited<ReturnType<typeof refreshImportedIssue>>,
): BoardData {
	return {
		...board,
		columns: board.columns.map((column) => ({
			...column,
			cards: column.cards.map((card) => (card.id === taskId ? { ...card, ...nextCard } : card)),
		})),
	};
}

export function useImportedIssueActions({
	workspaceId,
	setBoard,
}: {
	workspaceId: string | null;
	setBoard: Dispatch<SetStateAction<BoardData>>;
}) {
	const [loadingTaskIds, setLoadingTaskIds] = useState<Record<string, boolean>>({});

	const setTaskLoading = useCallback((taskId: string, isLoading: boolean) => {
		setLoadingTaskIds((current) => {
			if (isLoading) {
				if (current[taskId]) {
					return current;
				}
				return { ...current, [taskId]: true };
			}
			if (!current[taskId]) {
				return current;
			}
			const next = { ...current };
			delete next[taskId];
			return next;
		});
	}, []);

	const handleRefreshImportedIssue = useCallback(
		async (taskId: string) => {
			if (!workspaceId) {
				return;
			}
			setTaskLoading(taskId, true);
			try {
				const nextCard = await refreshImportedIssue(workspaceId, { taskId });
				setBoard((current) => replaceCard(current, taskId, nextCard));
				showAppToast({
					intent: nextCard.externalSync?.status === "error" ? "warning" : "success",
					message:
						nextCard.externalSync?.status === "error"
							? (nextCard.externalSync.lastError ?? "Remote changes need manual reconciliation.")
							: "Refreshed issue metadata from Linear.",
					timeout: 5000,
				});
			} catch (error) {
				showAppToast({
					intent: "danger",
					message: error instanceof Error ? error.message : String(error),
					timeout: 6000,
				});
			} finally {
				setTaskLoading(taskId, false);
			}
		},
		[setBoard, setTaskLoading, workspaceId],
	);

	const handleSyncImportedIssueStatus = useCallback(
		async (taskId: string, fromColumnId: BoardColumnId | null) => {
			if (!workspaceId) {
				return;
			}
			setTaskLoading(taskId, true);
			try {
				const nextCard = await syncImportedIssueStatus(workspaceId, { taskId, fromColumnId });
				setBoard((current) => replaceCard(current, taskId, nextCard));
				showAppToast({
					intent: nextCard.externalSync?.status === "error" ? "warning" : "success",
					message:
						nextCard.externalSync?.status === "error"
							? (nextCard.externalSync.lastError ?? "Could not sync issue status to Linear.")
							: "Synced issue status to Linear.",
					timeout: 5000,
				});
			} catch (error) {
				showAppToast({
					intent: "danger",
					message: error instanceof Error ? error.message : String(error),
					timeout: 6000,
				});
			} finally {
				setTaskLoading(taskId, false);
			}
		},
		[setBoard, setTaskLoading, workspaceId],
	);

	return {
		loadingTaskIds,
		handleRefreshImportedIssue,
		handleSyncImportedIssueStatus,
	};
}
