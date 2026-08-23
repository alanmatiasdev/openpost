<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import type { ShapePathVertex, TimelineItem } from '$lib/video-editor/project/types';
	import { updateItemProperties } from '$lib/video-editor/timeline/actions/items';
	import {
		closestPathSegment,
		fitDrawnPath,
		insertPathVertex,
		movePathHandle,
		movePathVertex,
		pathSvgData,
		pathVertexToBezier,
		pathVertexToCorner,
		removePathVertex
	} from '$lib/video-editor/shapes/path-edit';

	let {
		item,
		canvasWidth,
		canvasHeight,
		boxStyle,
		screenScale,
		onedit
	}: {
		item: TimelineItem;
		canvasWidth: number;
		canvasHeight: number;
		boxStyle: string;
		screenScale: number;
		onedit: () => void;
	} = $props();

	let svg = $state<SVGSVGElement | null>(null);
	let drawing = $state(false);
	let selectedIndex = $state<number | null>(null);
	let draftVertices = $state<ShapePathVertex[] | null>(null);
	let pendingVertex = $state<ShapePathVertex | null>(null);
	let previousItemId = '';

	const width = $derived(Math.max(1, item.transform?.width ?? canvasWidth));
	const height = $derived(Math.max(1, item.transform?.height ?? canvasHeight));
	const storedVertices = $derived(item.pathVertices ?? []);
	const visibleVertices = $derived(
		draftVertices ?? (pendingVertex ? [...storedVertices, pendingVertex] : storedVertices)
	);
	const pathData = $derived(
		pathSvgData(visibleVertices, width, height, drawing ? false : item.pathClosed !== false)
	);
	const selectedVertex = $derived(
		selectedIndex === null ? undefined : visibleVertices[selectedIndex]
	);

	$effect(() => {
		if (item.id === previousItemId) return;
		previousItemId = item.id;
		drawing = (item.pathVertices?.length ?? 0) === 0;
		selectedIndex = null;
		draftVertices = null;
		pendingVertex = null;
	});

	function localPoint(event: PointerEvent | MouseEvent): { x: number; y: number } {
		const matrix = svg?.getScreenCTM();
		if (!matrix) return { x: 0, y: 0 };
		const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
		return {
			x: Math.min(width, Math.max(0, point.x)),
			y: Math.min(height, Math.max(0, point.y))
		};
	}

	function normalizedPoint(point: { x: number; y: number }): [number, number] {
		return [point.x / width, point.y / height];
	}

	function commit(patch: Partial<TimelineItem>): void {
		updateItemProperties(item.id, patch, 'UPDATE_PATH_GEOMETRY');
		onedit();
	}

	function addVertex(event: PointerEvent): void {
		if (!drawing || event.target !== svg) return;
		event.preventDefault();
		const start = normalizedPoint(localPoint(event));
		pendingVertex = {
			position: start,
			inHandle: [0, 0],
			outHandle: [0, 0],
			tangentMode: 'corner'
		};
		const pointerId = event.pointerId;
		const move = (next: PointerEvent) => {
			if (next.pointerId !== pointerId || !pendingVertex) return;
			const current = normalizedPoint(localPoint(next));
			const handle: [number, number] = [current[0] - start[0], current[1] - start[1]];
			pendingVertex = {
				...pendingVertex,
				inHandle: [-handle[0], -handle[1]],
				outHandle: handle,
				tangentMode: Math.hypot(handle[0] * width, handle[1] * height) > 2 ? 'continuous' : 'corner'
			};
		};
		const finish = (next: PointerEvent) => {
			if (next.pointerId !== pointerId || !pendingVertex) return;
			move(next);
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', finish);
			window.removeEventListener('pointercancel', cancel);
			const vertex = pendingVertex;
			pendingVertex = null;
			const vertices = [...storedVertices, vertex];
			selectedIndex = vertices.length - 1;
			commit({ pathVertices: vertices, pathClosed: false });
		};
		const cancel = (next: PointerEvent) => {
			if (next.pointerId !== pointerId) return;
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', finish);
			window.removeEventListener('pointercancel', cancel);
			pendingVertex = null;
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', finish);
		window.addEventListener('pointercancel', cancel);
	}

	function finishDrawing(closed: boolean): void {
		const vertices = storedVertices;
		if (vertices.length < (closed ? 3 : 2)) return;
		const fitted = fitDrawnPath(
			vertices,
			item.transform ?? { width: canvasWidth, height: canvasHeight },
			canvasWidth,
			canvasHeight,
			Math.max(4, (item.strokeWidth ?? 8) / 2)
		);
		drawing = false;
		selectedIndex = null;
		commit({
			pathVertices: fitted.vertices,
			pathClosed: closed,
			transform: fitted.transform,
			fillEnabled: closed ? (item.fillEnabled ?? true) : false,
			strokeEnabled: true
		});
	}

	function attachEditGesture(
		event: PointerEvent,
		update: (point: [number, number], event: PointerEvent) => ShapePathVertex[]
	): void {
		event.preventDefault();
		event.stopPropagation();
		const pointerId = event.pointerId;
		const move = (next: PointerEvent) => {
			if (next.pointerId !== pointerId) return;
			draftVertices = update(normalizedPoint(localPoint(next)), next);
		};
		const finish = (next: PointerEvent) => {
			if (next.pointerId !== pointerId) return;
			move(next);
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', finish);
			window.removeEventListener('pointercancel', cancel);
			const vertices = draftVertices;
			draftVertices = null;
			if (vertices) commit({ pathVertices: vertices });
		};
		const cancel = (next: PointerEvent) => {
			if (next.pointerId !== pointerId) return;
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', finish);
			window.removeEventListener('pointercancel', cancel);
			draftVertices = null;
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', finish);
		window.addEventListener('pointercancel', cancel);
	}

	function startVertex(event: PointerEvent, index: number): void {
		if (drawing && index === 0 && storedVertices.length >= 3) {
			event.preventDefault();
			event.stopPropagation();
			finishDrawing(true);
			return;
		}
		selectedIndex = index;
		const base = storedVertices;
		attachEditGesture(event, (position) => movePathVertex(base, index, position));
	}

	function startHandle(event: PointerEvent, handle: 'in' | 'out'): void {
		if (selectedIndex === null) return;
		const index = selectedIndex;
		const vertex = storedVertices[index];
		if (!vertex) return;
		const base = storedVertices;
		attachEditGesture(event, (position, pointer) =>
			movePathHandle(
				base,
				index,
				handle,
				[position[0] - vertex.position[0], position[1] - vertex.position[1]],
				pointer.altKey
			)
		);
	}

	function toggleVertex(event: MouseEvent, index: number): void {
		event.preventDefault();
		event.stopPropagation();
		const vertex = storedVertices[index];
		if (!vertex) return;
		const hasHandles =
			vertex.inHandle[0] !== 0 ||
			vertex.inHandle[1] !== 0 ||
			vertex.outHandle[0] !== 0 ||
			vertex.outHandle[1] !== 0;
		commit({
			pathVertices: hasHandles
				? pathVertexToCorner(storedVertices, index)
				: pathVertexToBezier(storedVertices, index, item.pathClosed !== false)
		});
	}

	function insertOnPath(event: MouseEvent): void {
		if (drawing || storedVertices.length < 2) return;
		event.preventDefault();
		event.stopPropagation();
		const nearest = closestPathSegment(
			storedVertices,
			normalizedPoint(localPoint(event)),
			item.pathClosed !== false
		);
		if (!nearest) return;
		const vertices = insertPathVertex(storedVertices, nearest.afterIndex, nearest.t);
		selectedIndex = nearest.afterIndex + 1;
		commit({ pathVertices: vertices });
	}

	function insertAfterSelected(): void {
		if (selectedIndex === null || storedVertices.length < 2) return;
		const lastOpenVertex = item.pathClosed === false && selectedIndex === storedVertices.length - 1;
		const afterIndex = lastOpenVertex ? selectedIndex - 1 : selectedIndex;
		const vertices = insertPathVertex(storedVertices, Math.max(0, afterIndex), 0.5);
		selectedIndex = Math.max(0, afterIndex) + 1;
		commit({ pathVertices: vertices });
	}

	function removeSelected(): void {
		if (selectedIndex === null) return;
		const vertices = removePathVertex(
			storedVertices,
			selectedIndex,
			item.pathClosed === false ? 2 : 3
		);
		if (!vertices) return;
		selectedIndex = Math.min(selectedIndex, vertices.length - 1);
		commit({ pathVertices: vertices });
	}

	function vertexKeydown(event: KeyboardEvent, index: number): void {
		if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			selectedIndex = index;
			removeSelected();
			return;
		}
		const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
		if (!dx && !dy) return;
		event.preventDefault();
		const vertex = storedVertices[index];
		if (!vertex) return;
		const step = event.shiftKey ? 10 : 1;
		commit({
			pathVertices: movePathVertex(storedVertices, index, [
				Math.min(1, Math.max(0, vertex.position[0] + (dx * step) / width)),
				Math.min(1, Math.max(0, vertex.position[1] + (dy * step) / height))
			])
		});
	}

	function editorKeydown(event: KeyboardEvent): void {
		if (drawing && (event.key === 'Enter' || event.key === 'Escape')) {
			event.preventDefault();
			finishDrawing(false);
		} else if (drawing && event.key === 'Backspace') {
			event.preventDefault();
			if (storedVertices.length > 0) commit({ pathVertices: storedVertices.slice(0, -1) });
		} else if (!drawing && (event.key === 'Delete' || event.key === 'Backspace')) {
			event.preventDefault();
			removeSelected();
		}
	}

	function vertexPoint(vertex: ShapePathVertex): { x: number; y: number } {
		return { x: vertex.position[0] * width, y: vertex.position[1] * height };
	}

	function handlePoint(vertex: ShapePathVertex, handle: 'in' | 'out'): { x: number; y: number } {
		const offset = handle === 'in' ? vertex.inHandle : vertex.outHandle;
		return {
			x: (vertex.position[0] + offset[0]) * width,
			y: (vertex.position[1] + offset[1]) * height
		};
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -- application surface owns point drawing and keyboard editing -->
<div
	class="pointer-events-auto absolute border border-[oklch(0.72_0.16_45)] shadow-[0_0_0_1px_black]"
	style={boxStyle}
	data-path-editor
	role="application"
	tabindex="0"
	aria-label={drawing
		? m.video_editor_path_draw_instruction()
		: m.video_editor_path_edit_instruction()}
	onpointerdown={addVertex}
	onkeydown={editorKeydown}
>
	<svg
		bind:this={svg}
		class:cursor-crosshair={drawing}
		class="absolute inset-0 size-full overflow-visible"
		viewBox={`0 0 ${width} ${height}`}
	>
		{#if pathData}
			<path
				d={pathData}
				fill="none"
				stroke="black"
				stroke-width="5"
				stroke-linecap="round"
				stroke-linejoin="round"
				vector-effect="non-scaling-stroke"
				pointer-events="none"
			></path>
			<path
				d={pathData}
				fill="none"
				stroke="oklch(0.78 0.16 45)"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				vector-effect="non-scaling-stroke"
				pointer-events="none"
			></path>
			{#if !drawing}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<path
					d={pathData}
					fill="none"
					stroke="transparent"
					stroke-width="18"
					vector-effect="non-scaling-stroke"
					class="cursor-copy"
					ondblclick={insertOnPath}><title>{m.video_editor_path_insert_hint()}</title></path
				>
			{/if}
		{/if}

		{#if selectedVertex && selectedIndex !== null}
			{@const point = vertexPoint(selectedVertex)}
			{#each ['in', 'out'] as handle}
				{@const control = handlePoint(selectedVertex, handle as 'in' | 'out')}
				<line
					x1={point.x}
					y1={point.y}
					x2={control.x}
					y2={control.y}
					stroke="white"
					stroke-width="1.5"
					vector-effect="non-scaling-stroke"
					pointer-events="none"
				></line>
				<circle
					cx={control.x}
					cy={control.y}
					r={8 / screenScale}
					fill="white"
					stroke="black"
					stroke-width="2"
					vector-effect="non-scaling-stroke"
					class="cursor-crosshair focus:outline-none"
					role="button"
					tabindex="0"
					aria-label={handle === 'in'
						? m.video_editor_path_in_handle({ index: selectedIndex + 1 })
						: m.video_editor_path_out_handle({ index: selectedIndex + 1 })}
					onpointerdown={(event) => startHandle(event, handle as 'in' | 'out')}
				></circle>
			{/each}
		{/if}

		{#each visibleVertices as vertex, index (index)}
			{@const point = vertexPoint(vertex)}
			<circle
				cx={point.x}
				cy={point.y}
				r={drawing && index === 0 ? 9 / screenScale : 7 / screenScale}
				fill={index === selectedIndex ? 'white' : 'oklch(0.78 0.16 45)'}
				stroke="black"
				stroke-width="2"
				vector-effect="non-scaling-stroke"
				class="cursor-move focus:outline-none focus-visible:stroke-white"
				role="button"
				tabindex="0"
				aria-label={drawing && index === 0
					? m.video_editor_path_close()
					: m.video_editor_path_vertex({ index: index + 1 })}
				onpointerdown={(event) => startVertex(event, index)}
				ondblclick={(event) => toggleVertex(event, index)}
				onkeydown={(event) => vertexKeydown(event, index)}
			></circle>
		{/each}
	</svg>

	<div class="absolute top-full left-1/2 mt-2 flex -translate-x-1/2 flex-col items-center gap-1">
		<div class="rounded bg-black/85 px-2 py-1 text-[10px] whitespace-nowrap text-white shadow-lg">
			{drawing ? m.video_editor_path_draw_hint() : m.video_editor_path_edit_hint()}
		</div>
		<div class="flex gap-1 rounded bg-black/85 p-1 text-[10px] text-white shadow-lg">
			{#if drawing}
				<button
					type="button"
					class="rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
					disabled={storedVertices.length < 2}
					onclick={() => finishDrawing(false)}>{m.video_editor_path_finish_open()}</button
				>
				<button
					type="button"
					class="rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
					disabled={storedVertices.length < 3}
					onclick={() => finishDrawing(true)}>{m.video_editor_path_finish_closed()}</button
				>
			{:else}
				<button
					type="button"
					class="rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
					disabled={selectedIndex === null}
					onclick={insertAfterSelected}>{m.video_editor_path_add_point()}</button
				>
				<button
					type="button"
					class="rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
					disabled={selectedIndex === null}
					onclick={removeSelected}>{m.video_editor_path_delete_point()}</button
				>
			{/if}
		</div>
	</div>
</div>
