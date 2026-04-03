import { describe, expect, it } from "vitest";

import {
	type ExternalIssueSource,
	type ExternalIssueSyncState,
	getTaskAutoReviewActionLabel,
	getTaskAutoReviewCancelButtonLabel,
} from "@/types";

describe("getTaskAutoReviewActionLabel", () => {
	it("returns the expected label for each auto review mode", () => {
		expect(getTaskAutoReviewActionLabel("commit")).toBe("commit");
		expect(getTaskAutoReviewActionLabel("pr")).toBe("PR");
		expect(getTaskAutoReviewActionLabel("move_to_trash")).toBe("move to trash");
	});

	it("falls back to commit when the mode is missing", () => {
		expect(getTaskAutoReviewActionLabel(undefined)).toBe("commit");
	});

	it("returns the expected cancel button label for each auto review mode", () => {
		expect(getTaskAutoReviewCancelButtonLabel("commit")).toBe("Cancel Auto-commit");
		expect(getTaskAutoReviewCancelButtonLabel("pr")).toBe("Cancel Auto-PR");
		expect(getTaskAutoReviewCancelButtonLabel("move_to_trash")).toBe("Cancel Auto-trash");
	});
});

describe("external issue board types", () => {
	it("accepts Linear external source and sync state payloads", () => {
		const source: ExternalIssueSource = {
			provider: "linear",
			issueId: "issue-1",
			identifier: "ENG-123",
			url: "https://linear.app/example/ENG-123",
			teamId: "team-1",
			projectId: null,
			parentIssueId: null,
			lastRemoteUpdatedAt: 1,
			lastSyncedAt: 2,
			remoteState: {
				id: "state-1",
				name: "Todo",
				type: "backlog",
			},
			labelNames: ["linear"],
		};
		const sync: ExternalIssueSyncState = {
			status: "idle",
			lastError: null,
		};

		expect(source.identifier).toBe("ENG-123");
		expect(sync.status).toBe("idle");
	});
});
