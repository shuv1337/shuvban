import type { RuntimeBoardCardExternalSource, RuntimeBoardColumnId } from "../core/api-contract";
import type { LinearStatusMapping } from "./config-store";
import type { LinearWorkflowState } from "./linear-types";

export interface ResolveStatusMappingInput {
	columnId: RuntimeBoardColumnId;
	fromColumnId?: RuntimeBoardColumnId | null;
	config: LinearStatusMapping;
	availableStates: LinearWorkflowState[];
}

export interface ResolvedLinearStatusTarget {
	stateId: string;
	reason: "backlog" | "in_progress" | "review" | "done";
}

function pickStateByIdOrFallback(
	stateId: string | null,
	availableStates: LinearWorkflowState[],
	fallback: (state: LinearWorkflowState) => boolean,
): LinearWorkflowState | null {
	if (stateId) {
		const exact = availableStates.find((state) => state.id === stateId);
		if (exact) {
			return exact;
		}
	}
	return availableStates.find(fallback) ?? null;
}

function isBacklogState(state: LinearWorkflowState): boolean {
	return state.type === "backlog" || state.type === "unstarted" || state.type === "triage";
}

function isInProgressState(state: LinearWorkflowState): boolean {
	return state.type === "started" && !/review/i.test(state.name);
}

function isReviewState(state: LinearWorkflowState): boolean {
	return /review/i.test(state.name) || /qa/i.test(state.name) || /ready/i.test(state.name);
}

function isDoneState(state: LinearWorkflowState): boolean {
	return state.type === "completed";
}

export function resolveLinearStatusTarget(input: ResolveStatusMappingInput): ResolvedLinearStatusTarget | null {
	if (input.columnId === "trash") {
		if (input.fromColumnId !== "review") {
			return null;
		}
		const state = pickStateByIdOrFallback(input.config.doneStateId, input.availableStates, isDoneState);
		return state ? { stateId: state.id, reason: "done" } : null;
	}
	if (input.columnId === "review") {
		const state =
			pickStateByIdOrFallback(input.config.reviewStateId, input.availableStates, isReviewState) ??
			pickStateByIdOrFallback(input.config.inProgressStateId, input.availableStates, isInProgressState);
		return state ? { stateId: state.id, reason: "review" } : null;
	}
	if (input.columnId === "in_progress") {
		const state = pickStateByIdOrFallback(input.config.inProgressStateId, input.availableStates, isInProgressState);
		return state ? { stateId: state.id, reason: "in_progress" } : null;
	}
	if (input.columnId === "backlog") {
		const state = pickStateByIdOrFallback(input.config.backlogStateId, input.availableStates, isBacklogState);
		return state ? { stateId: state.id, reason: "backlog" } : null;
	}
	return null;
}

export function getAvailableStateTeamId(externalSource: RuntimeBoardCardExternalSource): string | null {
	return externalSource.teamId;
}
