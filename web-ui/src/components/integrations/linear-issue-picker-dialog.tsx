import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useImportLinearIssue } from "@/hooks/use-import-linear-issue";
import { useLinearIssues } from "@/hooks/use-linear-issues";
import type { LinearIssueSearchResult } from "@/runtime/types";

export function LinearIssuePickerDialog({
	open,
	onOpenChange,
	workspaceId,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workspaceId: string | null;
}): React.ReactElement {
	const [search, setSearch] = useState("");
	const { data, isLoading } = useLinearIssues(search, open, workspaceId);
	const { importIssue, isImporting } = useImportLinearIssue(workspaceId);
	const issues = useMemo(() => data ?? [], [data]);

	const handleImport = async (issue: LinearIssueSearchResult) => {
		try {
			await importIssue(issue.issueId);
			onOpenChange(false);
		} catch {
			// Toast handled by hook.
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange} contentClassName="max-w-2xl">
			<DialogHeader title="Import from Linear" icon={<Search size={16} />} />
			<DialogBody>
				<div className="mb-3">
					<input
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Search Linear issues"
						className="h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
					/>
				</div>
				<div className="max-h-[420px] overflow-y-auto rounded-md border border-border bg-surface-0">
					{isLoading ? (
						<div className="flex items-center justify-center gap-2 p-4 text-sm text-text-secondary">
							<Spinner size={14} />
							Searching Linear…
						</div>
					) : issues.length > 0 ? (
						issues.map((issue) => (
							<div
								key={issue.issueId}
								className="flex items-center gap-3 border-b border-border p-3 last:border-b-0"
							>
								<div className="min-w-0 flex-1">
									<div className="text-xs font-medium text-status-blue">{issue.identifier}</div>
									<div className="truncate text-sm text-text-primary">{issue.title}</div>
									<div className="mt-1 text-[11px] text-text-tertiary">
										{issue.teamKey ?? issue.teamName ?? "No team"}
										{issue.projectName ? ` • ${issue.projectName}` : ""}
										{issue.state ? ` • ${issue.state.name}` : ""}
									</div>
								</div>
								<Button
									variant="primary"
									size="sm"
									disabled={isImporting}
									onClick={() => void handleImport(issue)}
								>
									Import
								</Button>
							</div>
						))
					) : (
						<div className="p-4 text-sm text-text-secondary">Search for a Linear issue to import.</div>
					)}
				</div>
			</DialogBody>
			<DialogFooter>
				<Button onClick={() => onOpenChange(false)}>Close</Button>
			</DialogFooter>
		</Dialog>
	);
}
