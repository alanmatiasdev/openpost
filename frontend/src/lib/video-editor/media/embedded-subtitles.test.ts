import { describe, expect, it } from 'vitest';
import {
	extractMatroskaTextSubtitleTracks,
	extractMatroskaTextSubtitleTracksFromBlob
} from './embedded-subtitles';

const encoder = new TextEncoder();

describe('extractMatroskaTextSubtitleTracks', () => {
	it('extracts timed UTF-8 and ASS tracks in memory and through the streaming path', async () => {
		const buffer = element(
			[0x18, 0x53, 0x80, 0x67],
			[
				element([0x15, 0x49, 0xa9, 0x66], [element([0x2a, 0xd7, 0xb1], uint(1_000_000))]),
				element(
					[0x16, 0x54, 0xae, 0x6b],
					[
						trackEntry(1, 'S_TEXT/UTF8', 'eng', true, false),
						trackEntry(2, 'S_TEXT/ASS', 'por', false, true)
					]
				),
				element(
					[0x1f, 0x43, 0xb6, 0x75],
					[
						element([0xe7], uint(0)),
						element(
							[0xa0],
							[element([0xa1], block(1, 1000, 'Hello from the file')), element([0x9b], uint(2000))]
						),
						element(
							[0xa0],
							[
								element(
									[0xa1],
									block(2, 4000, '0,0,Default,,0,0,0,,{\\an8}{\\i1}Linha um\\NLinha dois')
								),
								element([0x9b], uint(1500))
							]
						)
					]
				)
			]
		);

		const tracks = extractMatroskaTextSubtitleTracks(toArrayBuffer(buffer));

		expect(tracks).toHaveLength(2);
		expect(tracks[0]).toMatchObject({
			trackNumber: 1,
			codecId: 'S_TEXT/UTF8',
			language: 'eng',
			default: true,
			forced: false,
			cues: [{ startSeconds: 1, endSeconds: 3, text: 'Hello from the file' }]
		});
		expect(tracks[1]).toMatchObject({
			trackNumber: 2,
			codecId: 'S_TEXT/ASS',
			language: 'por',
			default: false,
			forced: true,
			cues: [{ startSeconds: 4, endSeconds: 5.5, text: '{\\an8}Linha um\nLinha dois' }]
		});

		const progress: number[] = [];
		const streamed = await extractMatroskaTextSubtitleTracksFromBlob(
			new Blob([toArrayBuffer(buffer)]),
			{
				onProgress: ({ bytesRead }) => progress.push(bytesRead)
			}
		);
		expect(streamed).toEqual(tracks);
		expect(progress.at(-1)).toBe(buffer.byteLength);
	});
});

function trackEntry(
	trackNumber: number,
	codec: string,
	language: string,
	defaultTrack: boolean,
	forced: boolean
): Uint8Array {
	return element(
		[0xae],
		[
			element([0xd7], uint(trackNumber)),
			element([0x83], uint(17)),
			element([0x86], ascii(codec)),
			element([0x22, 0xb5, 0x9c], ascii(language)),
			element([0x88], uint(defaultTrack ? 1 : 0)),
			element([0x55, 0xaa], uint(forced ? 1 : 0))
		]
	);
}

function element(id: number[], payloadParts: Uint8Array[] | Uint8Array): Uint8Array {
	const payload = Array.isArray(payloadParts) ? concat(payloadParts) : payloadParts;
	return concat([new Uint8Array(id), size(payload.length), payload]);
}

function block(trackNumber: number, timecode: number, text: string): Uint8Array {
	return concat([
		new Uint8Array([0x80 | trackNumber, (timecode >> 8) & 0xff, timecode & 0xff, 0x00]),
		encoder.encode(text)
	]);
}

function size(length: number): Uint8Array {
	if (length < 0x7f) return new Uint8Array([0x80 | length]);
	if (length < 0x3fff) return new Uint8Array([0x40 | (length >> 8), length & 0xff]);
	throw new Error('Fixture payload is too large');
}

function uint(value: number): Uint8Array {
	if (value === 0) return new Uint8Array([0]);
	const bytes: number[] = [];
	let next = value;
	while (next > 0) {
		bytes.unshift(next & 0xff);
		next = Math.floor(next / 256);
	}
	return new Uint8Array(bytes);
}

function ascii(value: string): Uint8Array {
	return new Uint8Array([...value].map((character) => character.charCodeAt(0)));
}

function concat(parts: Uint8Array[]): Uint8Array {
	const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.length;
	}
	return result;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	// SAFETY: slicing to the view bounds creates an ArrayBuffer with no unrelated backing bytes.
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
