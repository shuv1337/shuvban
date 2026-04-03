import { Plug, PlugZap } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { IntegrationStatus } from "@/runtime/types";

export function LinearConnectPanel({
	status,
	onImport,
}: {
	status: IntegrationStatus | null;
	onImport?: () => void;
}): React.ReactElement {
	const configured = status?.configured ?? false;
	return (
		<div className="rounded-lg border border-border bg-surface-2 p-3">
			<div className="flex items-start gap-3">
				<div className="mt-0.5 text-text-secondary">
					{configured ? <PlugZap size={16} className="text-status-green" /> : <Plug size={16} />}
				</div>
				<div className="min-w-0 flex-1">
					<div className="text-sm font-medium text-text-primary">Linear</div>
					<div className="mt-1 text-xs text-text-secondary">
						{status?.message ?? "Checking Linear integration status..."}
					</div>
					{configured && status ? (
						<div className="mt-2 text-[11px] text-text-tertiary">
							Default team: {status.defaultTeamId ?? "Not set"}
						</div>
					) : null}
				</div>
				{configured && onImport ? (
					<Button variant="primary" size="sm" onClick={onImport}>
						Import
					</Button>
				) : null}
			</div>
		</div>
	);
}
