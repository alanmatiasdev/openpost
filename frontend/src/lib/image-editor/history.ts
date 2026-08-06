export interface ImageEditorCommand<T> {
	label: string;
	apply(current: T): T;
	revert(current: T): T;
	coalesceKey?: string;
}

interface HistoryEntry<T> {
	label: string;
	before: T;
	after: T;
	coalesceKey?: string;
	createdAt: number;
	estimatedBytes: number;
}

export class ImageEditorHistory<T> {
	private undoStack: HistoryEntry<T>[] = [];
	private redoStack: HistoryEntry<T>[] = [];
	private executionChanged = false;

	constructor(
		private readonly clone: (value: T) => T,
		private readonly limit = 100,
		private readonly equal: (left: T, right: T) => boolean = (left, right) =>
			JSON.stringify(left) === JSON.stringify(right),
		private readonly maximumBytes = 64 * 1024 * 1024,
		private readonly estimateBytes: (value: T) => number = (value) =>
			JSON.stringify(value).length * 2
	) {}

	execute(current: T, command: ImageEditorCommand<T>): T {
		const before = this.clone(current);
		const after = command.apply(this.clone(current));
		this.executionChanged = !this.equal(before, after);
		if (!this.executionChanged) return current;
		const now = Date.now();
		const previous = this.undoStack.at(-1);
		if (
			command.coalesceKey &&
			previous?.coalesceKey === command.coalesceKey &&
			now - previous.createdAt < 1000
		) {
			previous.after = this.clone(after);
			previous.createdAt = now;
			previous.estimatedBytes = this.entryBytes(previous.before, previous.after);
		} else {
			this.undoStack.push({
				label: command.label,
				before,
				after: this.clone(after),
				coalesceKey: command.coalesceKey,
				createdAt: now,
				estimatedBytes: this.entryBytes(before, after)
			});
		}
		this.redoStack = [];
		this.trim();
		return after;
	}

	checkpoint(label: string, before: T, after: T, coalesceKey?: string): void {
		if (this.equal(before, after)) return;
		this.undoStack.push({
			label,
			before: this.clone(before),
			after: this.clone(after),
			coalesceKey,
			createdAt: Date.now(),
			estimatedBytes: this.entryBytes(before, after)
		});
		this.redoStack = [];
		this.trim();
	}

	undo(current: T): T {
		const entry = this.undoStack.pop();
		if (!entry) return current;
		this.redoStack.push(entry);
		return this.clone(entry.before);
	}

	redo(current: T): T {
		const entry = this.redoStack.pop();
		if (!entry) return current;
		this.undoStack.push(entry);
		return this.clone(entry.after);
	}

	get canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	get canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	get lastExecutionChanged(): boolean {
		return this.executionChanged;
	}

	get undoLabel(): string {
		return this.undoStack.at(-1)?.label ?? '';
	}

	get redoLabel(): string {
		return this.redoStack.at(-1)?.label ?? '';
	}

	get estimatedSizeBytes(): number {
		return [...this.undoStack, ...this.redoStack].reduce(
			(total, entry) => total + entry.estimatedBytes,
			0
		);
	}

	get entryCount(): number {
		return this.undoStack.length + this.redoStack.length;
	}

	clear(): void {
		this.undoStack = [];
		this.redoStack = [];
		this.executionChanged = false;
	}

	private entryBytes(before: T, after: T): number {
		return Math.max(0, this.estimateBytes(before)) + Math.max(0, this.estimateBytes(after));
	}

	private trim(): void {
		while (this.undoStack.length > this.limit) this.undoStack.shift();
		while (this.undoStack.length > 1 && this.estimatedSizeBytes > this.maximumBytes) {
			this.undoStack.shift();
		}
	}
}
