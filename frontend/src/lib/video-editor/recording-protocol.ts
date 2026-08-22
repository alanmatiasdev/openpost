export type RecordingWriterRequest =
	| { type: 'init'; track_id: string; path: string }
	| {
			type: 'chunk';
			track_id: string;
			index: number;
			timestamp_us: number;
			media_start_us: number;
			media_end_us: number;
			session_start_us: number;
			session_end_us: number;
			flush_sequence: number;
			data: ArrayBuffer;
	  }
	| { type: 'close'; track_id: string }
	| { type: 'abort'; track_id: string };

export type RecordingWriterResponse =
	| { type: 'ready'; track_id: string }
	| {
			type: 'written';
			track_id: string;
			index: number;
			timestamp_us: number;
			position: number;
			bytes: number;
			media_start_us: number;
			media_end_us: number;
			session_start_us: number;
			session_end_us: number;
			flush_sequence: number;
			checksum: string;
	  }
	| { type: 'closed'; track_id: string }
	| { type: 'aborted'; track_id: string }
	| { type: 'error'; track_id: string; message: string };
