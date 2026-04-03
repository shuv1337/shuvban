import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ExternalIssueBadge } from "@/components/integrations/external-issue-badge";

describe("ExternalIssueBadge", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it("renders the issue identifier and source link", async () => {
		await act(async () => {
			root.render(
				<ExternalIssueBadge
					card={{
						id: "task-1",
						prompt: "Task",
						startInPlanMode: false,
						baseRef: "main",
						createdAt: 1,
						updatedAt: 1,
						externalSource: {
							provider: "linear",
							issueId: "issue-1",
							identifier: "ENG-123",
							url: "https://linear.app/example/ENG-123",
							teamId: null,
							projectId: null,
							parentIssueId: null,
							lastRemoteUpdatedAt: null,
							lastSyncedAt: null,
						},
						externalSync: { status: "idle", lastError: null },
					}}
				/>,
			);
		});

		const anchor = container.querySelector("a");
		expect(anchor?.textContent).toContain("ENG-123");
		expect(anchor?.getAttribute("href")).toBe("https://linear.app/example/ENG-123");
	});
});
