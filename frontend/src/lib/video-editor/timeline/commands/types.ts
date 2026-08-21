/**
 * Snapshot types for the timeline undo/redo system.
 *
 * Commands are metadata only; undo/redo swaps full snapshots. Excludes
 * ephemeral state (isDirty) that shouldn't be in history.
 *
 * Ported from FreeCut (MIT) — commands/types.ts, trimmed to v1.
 */

import type { TimelineItem, TimelineTrack, TimelineTransition } from '../../project/types';

export interface TimelineSnapshot {
	items: TimelineItem[];
	tracks: TimelineTrack[];
	transitions: TimelineTransition[];
	inPoint: number | null;
	outPoint: number | null;
	fps: number;
	scrollPosition: number;
	snapEnabled: boolean;
	currentFrame: number;
}

/** Payload values carried alongside a command type for labels/debugging. */
export type CommandPayloadValue = string | number | boolean | null | string[] | number[];

/** Metadata about what action was performed; actual undo uses snapshots. */
export interface TimelineCommand {
	type: string;
	payload?: Record<string, CommandPayloadValue>;
}

export interface CommandEntry {
	command: TimelineCommand;
	beforeSnapshot: TimelineSnapshot;
	timestamp: number;
}
