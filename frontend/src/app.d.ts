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

	interface Window {
		showSaveFilePicker?(options: OpenPostSaveFilePickerOptions): Promise<FileSystemFileHandle>;
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
