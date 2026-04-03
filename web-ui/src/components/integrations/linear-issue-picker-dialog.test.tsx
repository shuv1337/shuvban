import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LinearIssuePickerDialog } from "@/components/integrations/linear-issue-picker-dialog";

const importIssue = vi.fn();
const useLinearIssues = vi.fn();

vi.mock("@/hooks/use-import-linear-issue", () => ({
	useImportLinearIssue: () => ({ importIssue, isImporting: false }),
}));

vi.mock("@/hooks/use-linear-issues", () => ({
	useLinearIssues: (...args: unknown[]) => useLinearIssues(...args),
}));

describe("LinearIssuePickerDialog", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		importIssue.mockReset();
		useLinearIssues.mockReset();
		useLinearIssues.mockReturnValue({
			data: [
				{
					provider: "linear",
					issueId: "issue-1",
					identifier: "ENG-123",
					title: "Import me",
					url: "https://linear.app/example/ENG-123",
					teamId: "team-1",
					teamKey: "ENG",
					teamName: "Engineering",
					projectId: null,
					projectName: null,
					parentIssueId: null,
					parentIdentifier: null,
					parentTitle: null,
					state: { id: "todo", name: "Todo", type: "backlog", teamId: "team-1" },
					labelNames: [],
					updatedAt: 1,
				},
			],
			isLoading: false,
		});
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("renders Linear search results and imports a selected issue", async () => {
		await act(async () => {
			root.render(<LinearIssuePickerDialog open onOpenChange={() => {}} workspaceId="workspace-1" />);
		});

		expect(document.body.textContent).toContain("ENG-123");
		expect(document.body.textContent).toContain("Import me");
		const importButton = Array.from(document.body.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Import",
		);
		expect(importButton).toBeDefined();

		await act(async () => {
			importButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(importIssue).toHaveBeenCalledWith("issue-1");
	});
});
