import { writeStructuredRuntimeLog } from "../telemetry/runtime-log";
import { captureNodeException } from "../telemetry/sentry-node";

export interface IntegrationTelemetryContext {
	workspaceId?: string | null;
	repoPath?: string | null;
	taskId?: string | null;
	issueId?: string | null;
	identifier?: string | null;
	provider?: string | null;
	agentId?: string | null;
	operation?: string | null;
}

function cleanFields(fields: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

export function writeIntegrationTelemetryEvent(
	event: string,
	context: IntegrationTelemetryContext,
	extra?: Record<string, unknown>,
): void {
	writeStructuredRuntimeLog(
		cleanFields({
			event,
			area: "integrations",
			provider: context.provider,
			workspaceId: context.workspaceId,
			repoPath: context.repoPath,
			taskId: context.taskId,
			issueId: context.issueId,
			identifier: context.identifier,
			agentId: context.agentId,
			operation: context.operation,
			...extra,
		}),
	);
}

export async function measureIntegrationOperation<T>(
	eventBase: string,
	context: IntegrationTelemetryContext,
	operation: () => Promise<T>,
): Promise<T> {
	const startedAt = Date.now();
	writeIntegrationTelemetryEvent(`${eventBase}.start`, context);
	try {
		const result = await operation();
		writeIntegrationTelemetryEvent(`${eventBase}.complete`, context, {
			durationMs: Date.now() - startedAt,
			ok: true,
		});
		return result;
	} catch (error) {
		writeIntegrationTelemetryEvent(`${eventBase}.error`, context, {
			durationMs: Date.now() - startedAt,
			ok: false,
			errorName: error instanceof Error ? error.name : "Error",
			errorMessage: error instanceof Error ? error.message : String(error),
		});
		captureNodeException(error, { area: "integrations" });
		throw error;
	}
}
