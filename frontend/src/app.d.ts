// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	interface OpenPostFilePickerType {
		description: string;
		accept: { [mimeType: string]: string[] };
	}

	interface OpenPostSaveFilePickerOptions {
		suggestedName: string;
		types: OpenPostFilePickerType[];
	}

	interface OpenPostEyeDropperResult {
		sRGBHex: string;
	}

	interface OpenPostEyeDropper {
		open(): Promise<OpenPostEyeDropperResult>;
	}

	interface Window {
		showSaveFilePicker?(options: OpenPostSaveFilePickerOptions): Promise<FileSystemFileHandle>;
		EyeDropper?: new () => OpenPostEyeDropper;
	}

	interface StorageManager {
		getDirectory?(): Promise<FileSystemDirectoryHandle>;
	}

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
