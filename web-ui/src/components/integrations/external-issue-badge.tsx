import { AlertCircle, ExternalLink, RefreshCw } from "lucide-react";

import { cn } from "@/components/ui/cn";
import type { BoardCard } from "@/types";

export function ExternalIssueBadge({
	card,
	className,
}: {
	card: BoardCard;
	className?: string;
}): React.ReactElement | null {
	const externalSource = card.externalSource;
	if (!externalSource) {
		return null;
	}
	const syncStatus = card.externalSync?.status ?? "idle";
	const syncTitle =
		syncStatus === "error"
			? (card.externalSync?.lastError ?? "Last sync failed")
			: syncStatus === "syncing"
				? "Syncing with Linear"
				: "Linked to Linear";
	return (
		<a
			href={externalSource.url}
			target="_blank"
			rel="noreferrer"
			title={syncTitle}
			className={cn(
				"inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium no-underline",
				syncStatus === "error"
					? "border-status-red/40 bg-status-red/10 text-status-red"
					: syncStatus === "syncing"
						? "border-status-blue/40 bg-status-blue/10 text-status-blue"
						: "border-border-bright bg-surface-3 text-text-secondary hover:text-text-primary",
				className,
			)}
		>
			<span>{externalSource.identifier}</span>
			{syncStatus === "error" ? <AlertCircle size={10} /> : null}
			{syncStatus === "syncing" ? <RefreshCw size={10} className="animate-spin" /> : null}
			{syncStatus === "idle" ? <ExternalLink size={10} /> : null}
		</a>
	);
}
