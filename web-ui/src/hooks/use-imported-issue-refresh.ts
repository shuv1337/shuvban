import type { Dispatch, SetStateAction } from "react";
import { useEffect } from "react";

import { refreshImportedIssue } from "@/runtime/integrations-query";
import type { BoardData } from "@/types";

const IMPORTED_ISSUE_REFRESH_INTERVAL_MS = 60_000;

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

export function useImportedIssueRefresh({
	workspaceId,
	board,
	setBoard,
	enabled,
}: {
	workspaceId: string | null;
	board: BoardData;
	setBoard: Dispatch<SetStateAction<BoardData>>;
	enabled: boolean;
}): void {
	useEffect(() => {
		if (!workspaceId || !enabled) {
			return;
		}
		const importedTaskIds = board.columns
			.flatMap((column) => column.cards)
			.filter((card) => card.externalSource?.provider === "linear")
			.map((card) => card.id);
		if (importedTaskIds.length === 0) {
			return;
		}
		let cancelled = false;
		const tick = async () => {
			for (const taskId of importedTaskIds) {
				if (cancelled) {
					return;
				}
				try {
					const nextCard = await refreshImportedIssue(workspaceId, { taskId });
					if (cancelled) {
						return;
					}
					setBoard((current) => replaceCard(current, taskId, nextCard));
				} catch {
					// Best effort background refresh only.
				}
			}
		};
		const intervalId = window.setInterval(() => {
			void tick();
		}, IMPORTED_ISSUE_REFRESH_INTERVAL_MS);
		return () => {
			cancelled = true;
			window.clearInterval(intervalId);
		};
	}, [board, enabled, setBoard, workspaceId]);
}
