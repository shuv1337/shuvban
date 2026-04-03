import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef } from "react";

import { syncImportedIssueStatus } from "@/runtime/integrations-query";
import type { RuntimeBoardCard } from "@/runtime/types";
import type { BoardColumnId, BoardData } from "@/types";

function replaceBoardCard(board: BoardData, taskId: string, nextCard: RuntimeBoardCard): BoardData {
	return {
		...board,
		columns: board.columns.map((column) => ({
			...column,
			cards: column.cards.map((card) => (card.id === taskId ? { ...card, ...nextCard } : card)),
		})),
	};
}

function markCardSyncing(board: BoardData, taskId: string): BoardData {
	return {
		...board,
		columns: board.columns.map((column) => ({
			...column,
			cards: column.cards.map((card) =>
				card.id === taskId
					? {
							...card,
							externalSync: {
								status: "syncing",
								lastError: card.externalSync?.lastError ?? null,
							},
						}
					: card,
			),
		})),
	};
}

export function useImportedIssueSync({
	workspaceId,
	board,
	setBoard,
}: {
	workspaceId: string | null;
	board: BoardData;
	setBoard: Dispatch<SetStateAction<BoardData>>;
}): void {
	const previousColumnsRef = useRef<Map<string, BoardColumnId>>(new Map());
	const initializedWorkspaceIdRef = useRef<string | null>(null);

	useEffect(() => {
		previousColumnsRef.current = new Map();
		initializedWorkspaceIdRef.current = workspaceId;
	}, [workspaceId]);

	useEffect(() => {
		if (!workspaceId) {
			return;
		}
		const currentColumns = new Map<string, BoardColumnId>();
		const transitions: Array<{ taskId: string; fromColumnId: BoardColumnId; toColumnId: BoardColumnId }> = [];
		for (const column of board.columns) {
			for (const card of column.cards) {
				currentColumns.set(card.id, column.id);
				if (!card.externalSource || card.externalSource.provider !== "linear") {
					continue;
				}
				const previousColumnId = previousColumnsRef.current.get(card.id);
				if (!previousColumnId || previousColumnId === column.id) {
					continue;
				}
				transitions.push({
					taskId: card.id,
					fromColumnId: previousColumnId,
					toColumnId: column.id,
				});
			}
		}
		const shouldPrimeOnly = previousColumnsRef.current.size === 0;
		previousColumnsRef.current = currentColumns;
		if (shouldPrimeOnly) {
			return;
		}
		let cancelled = false;
		void (async () => {
			for (const transition of transitions) {
				if (cancelled) {
					return;
				}
				setBoard((current) => markCardSyncing(current, transition.taskId));
				try {
					const updatedCard = await syncImportedIssueStatus(workspaceId, {
						taskId: transition.taskId,
						fromColumnId: transition.fromColumnId,
					});
					if (cancelled) {
						return;
					}
					setBoard((current) => replaceBoardCard(current, transition.taskId, updatedCard));
				} catch {
					if (cancelled) {
						return;
					}
					setBoard((current) => ({
						...current,
						columns: current.columns.map((column) => ({
							...column,
							cards: column.cards.map((card) =>
								card.id === transition.taskId
									? {
											...card,
											externalSync: {
												status: "error",
												lastError: "Could not sync issue status to Linear.",
											},
										}
									: card,
							),
						})),
					}));
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [board, setBoard, workspaceId]);
}
