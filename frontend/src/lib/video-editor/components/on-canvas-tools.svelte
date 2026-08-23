<!-- Direct crop, anchor, text, and motion-path editing over the preview. -->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import type {
		CropSettings,
		ItemTransform,
		KeyframeProperty,
		SpatialBezierTangents,
		TimelineItem
	} from '$lib/video-editor/project/types';
	import {
		buildMotionPathPoints,
		calculateAnchorDrag,
		calculateCropFromDrag,
		CROP_EDGE_PROPERTY,
		positionKeyframeFrames,
		resolveCrop,
		type CropEdge,
		type MotionPathPoint,
		type Point
	} from '$lib/video-editor/preview/on-canvas-tools';
	import { withSpatialTangent } from '$lib/video-editor/timeline/vector-keyframes';

	type CanvasTool = 'transform' | 'crop' | 'anchor' | 'text' | 'motion';
	type AnimatedValues = Partial<Record<KeyframeProperty, number>>;

	let {
		item,
		canvasWidth,
		canvasHeight,
		currentFrame,
		isPlaying = false,
		ontransformdraft,
		oncropdraft,
		ontextdraft,
		ontextediting,
		oncommitvalues,
		oncommitposition,
		oncreatespatial,
		oncommitspatial,
		oncommittext,
		onseek,
		onedit
	}: {
		item: TimelineItem;
		canvasWidth: number;
		canvasHeight: number;
		currentFrame: number;
		isPlaying?: boolean;
		ontransformdraft: (transform: ItemTransform | null) => void;
		oncropdraft: (crop: CropSettings | null) => void;
		ontextdraft: (text: string | null) => void;
		ontextediting: (editing: boolean) => void;
		oncommitvalues: (frame: number, values: AnimatedValues) => boolean;
		oncommitposition: (frame: number, x: number, y: number) => boolean;
		oncreatespatial: (frame: number) => boolean;
		oncommitspatial: (frame: number, spatial: SpatialBezierTangents) => boolean;
		oncommittext: (text: string) => void;
		onseek: (frame: number) => void;
		onedit: () => void;
	} = $props();

	let root = $state<HTMLDivElement | null>(null);
	let textEditor = $state<HTMLDivElement | null>(null);
	let activeTool = $state<CanvasTool>('transform');
	let draftTransform = $state<ItemTransform | null>(null);
	let draftCrop = $state<CropSettings | null>(null);
	let draftText = $state<string | null>(null);
	let motionDraft = $state<{ frame: number; x: number; y: number } | null>(null);
	let spatialDraft = $state<{ frame: number; spatial: SpatialBezierTangents } | null>(null);
	let activeMotionFrame = $state<number | null>(null);
	let textSession = $state(false);
	let screenScale = $state(1);
	let cancellingText = false;
	let previousItemId = '';
	let cancelActiveGesture: (() => void) | null = null;

	const transform = $derived(draftTransform ?? item.transform ?? {});
	const width = $derived(Math.max(16, transform.width ?? canvasWidth));
	const height = $derived(Math.max(16, transform.height ?? canvasHeight));
	const anchorX = $derived(transform.anchorX ?? width / 2);
	const anchorY = $derived(transform.anchorY ?? height / 2);
	const rotation = $derived(transform.rotation ?? 0);
	const canCrop = $derived(item.type === 'video' || item.type === 'image');
	const canEditText = $derived(item.type === 'text');
	const hasMotion = $derived(positionKeyframeFrames(item).length > 0);
	const motionPoints = $derived(
		buildMotionPathPoints({
			item,
			canvasWidth,
			canvasHeight,
			preview: motionDraft ?? undefined,
			spatialPreview: spatialDraft ?? undefined
		})
	);
	const activeMotionPoint = $derived(
		motionPoints.find(
			(point) => point.isKeyframe && point.frame === (activeMotionFrame ?? currentFrame)
		)
	);
	const currentTransform = $derived.by(() => {
		const point = motionPoints.find((candidate) => candidate.frame === motionDraft?.frame);
		return (
			point ?? {
				x: canvasWidth / 2 + (transform.x ?? 0),
				y: canvasHeight / 2 + (transform.y ?? 0)
			}
		);
	});
	const boxStyle = $derived(
		[
			`left:${50 + ((transform.x ?? 0) / canvasWidth) * 100}%`,
			`top:${50 + ((transform.y ?? 0) / canvasHeight) * 100}%`,
			`width:${(width / canvasWidth) * 100}%`,
			`height:${(height / canvasHeight) * 100}%`,
			`transform:translate(${(-anchorX / width) * 100}%,${(-anchorY / height) * 100}%) rotate(${rotation}deg)`
		].join(';')
	);

	$effect(() => {
		if (item.id === previousItemId) return;
		previousItemId = item.id;
		cancelDrafts();
		activeTool = 'transform';
	});

	$effect(() => {
		if (activeTool === 'crop' && !canCrop) activeTool = 'transform';
		if (activeTool === 'text' && !canEditText) activeTool = 'transform';
		if (activeTool === 'motion' && !hasMotion) activeTool = 'transform';
	});

	$effect(() => {
		if (activeTool !== 'text' || !canEditText) return;
		startTextSession();
	});

	$effect(() => {
		if (!isPlaying) return;
		motionDraft = null;
		spatialDraft = null;
		if (activeTool === 'motion') activeTool = 'transform';
	});

	$effect(() => {
		const node = root;
		if (!node) return;
		const update = () => {
			const rect = node.getBoundingClientRect();
			screenScale = Math.max(
				0.0001,
				Math.min(rect.width / canvasWidth, rect.height / canvasHeight)
			);
		};
		const observer = new ResizeObserver(update);
		observer.observe(node);
		update();
		return () => observer.disconnect();
	});

	onDestroy(() => cancelActiveGesture?.());

	function canvasPoint(event: PointerEvent): Point {
		const rect = root?.getBoundingClientRect();
		if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
		return {
			x: ((event.clientX - rect.left) / rect.width) * canvasWidth,
			y: ((event.clientY - rect.top) / rect.height) * canvasHeight
		};
	}

	function resolvedTransform(): Required<
		Pick<ItemTransform, 'x' | 'y' | 'width' | 'height' | 'rotation'>
	> &
		ItemTransform {
		return {
			...transform,
			x: transform.x ?? 0,
			y: transform.y ?? 0,
			width,
			height,
			rotation
		};
	}

	function setTool(tool: CanvasTool): void {
		if (tool === activeTool) return;
		if (textSession) finishText(true);
		cancelDrafts();
		activeTool = tool;
	}

	function cancelDrafts(): void {
		cancelActiveGesture?.();
		draftTransform = null;
		draftCrop = null;
		motionDraft = null;
		spatialDraft = null;
		ontransformdraft(null);
		oncropdraft(null);
		ontextdraft(null);
		if (textSession) {
			textSession = false;
			ontextediting(false);
		}
	}

	function attachPointerGesture(
		event: PointerEvent,
		onmove: (point: Point, event: PointerEvent) => void,
		oncommit: () => void,
		oncancel: () => void
	): void {
		event.preventDefault();
		event.stopPropagation();
		const pointerId = event.pointerId;
		const pointerTarget = event.currentTarget instanceof Element ? event.currentTarget : null;
		let finished = false;
		const move = (next: PointerEvent) => {
			if (next.pointerId !== pointerId) return;
			onmove(canvasPoint(next), next);
		};
		const cleanup = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', end);
			window.removeEventListener('pointercancel', cancel);
			window.removeEventListener('keydown', keydown);
			pointerTarget?.removeEventListener('lostpointercapture', lostCapture);
			if (pointerTarget?.hasPointerCapture(pointerId))
				pointerTarget.releasePointerCapture(pointerId);
			if (cancelActiveGesture === cancelGesture) cancelActiveGesture = null;
		};
		const end = (next: PointerEvent) => {
			if (finished || next.pointerId !== pointerId) return;
			finished = true;
			onmove(canvasPoint(next), next);
			cleanup();
			oncommit();
		};
		const cancel = (next?: PointerEvent) => {
			if (finished || (next && next.pointerId !== pointerId)) return;
			finished = true;
			cleanup();
			oncancel();
		};
		const keydown = (next: KeyboardEvent) => {
			if (next.key !== 'Escape') return;
			next.preventDefault();
			cancel();
		};
		const lostCapture = (next: Event) => {
			if (next instanceof PointerEvent) cancel(next);
			else cancel();
		};
		const cancelGesture = () => cancel();
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', end);
		window.addEventListener('pointercancel', cancel);
		window.addEventListener('keydown', keydown);
		pointerTarget?.addEventListener('lostpointercapture', lostCapture);
		try {
			pointerTarget?.setPointerCapture(pointerId);
		} catch {
			// Window listeners still own the gesture when capture is unavailable.
		}
		cancelActiveGesture = cancelGesture;
	}

	function startTransform(event: PointerEvent, mode: 'move' | 'resize'): void {
		if (activeTool !== 'transform') return;
		const start = canvasPoint(event);
		const base = resolvedTransform();
		attachPointerGesture(
			event,
			(point) => {
				const dx = point.x - start.x;
				const dy = point.y - start.y;
				draftTransform =
					mode === 'move'
						? { ...base, x: base.x + dx, y: base.y + dy }
						: {
								...base,
								width: Math.max(16, base.width + dx),
								height: Math.max(16, base.height + dy)
							};
				ontransformdraft(draftTransform);
			},
			() => {
				const next = draftTransform;
				if (next) {
					const values =
						mode === 'move' ? { x: next.x, y: next.y } : { width: next.width, height: next.height };
					const committed =
						mode === 'move' && hasMotion && next.x !== undefined && next.y !== undefined
							? oncommitposition(currentFrame, next.x, next.y)
							: oncommitvalues(currentFrame, values);
					if (committed) onedit();
				}
				draftTransform = null;
				ontransformdraft(null);
			},
			() => {
				draftTransform = null;
				ontransformdraft(null);
			}
		);
	}

	function startCrop(event: PointerEvent, edge: CropEdge): void {
		const start = canvasPoint(event);
		const startCrop = resolveCrop(item.crop);
		const sourceDimension =
			edge === 'left' || edge === 'right'
				? (item.sourceWidth ?? Math.round(width))
				: (item.sourceHeight ?? Math.round(height));
		attachPointerGesture(
			event,
			(point) => {
				draftCrop = calculateCropFromDrag({
					edge,
					startCrop,
					startPoint: start,
					currentPoint: point,
					rotation,
					mediaWidth: width,
					mediaHeight: height,
					sourceDimension
				});
				oncropdraft(draftCrop);
			},
			() => commitCrop(edge),
			() => {
				draftCrop = null;
				oncropdraft(null);
			}
		);
	}

	function commitCrop(edge: CropEdge): void {
		const next = draftCrop;
		if (next) {
			const property = CROP_EDGE_PROPERTY[edge];
			if (oncommitvalues(currentFrame, { [property]: next[edge] })) onedit();
		}
		draftCrop = null;
		oncropdraft(null);
	}

	function cropKeydown(event: KeyboardEvent, edge: CropEdge): void {
		const inward =
			(edge === 'left' && event.key === 'ArrowRight') ||
			(edge === 'right' && event.key === 'ArrowLeft') ||
			(edge === 'top' && event.key === 'ArrowDown') ||
			(edge === 'bottom' && event.key === 'ArrowUp');
		const outward =
			(edge === 'left' && event.key === 'ArrowLeft') ||
			(edge === 'right' && event.key === 'ArrowRight') ||
			(edge === 'top' && event.key === 'ArrowUp') ||
			(edge === 'bottom' && event.key === 'ArrowDown');
		if (!inward && !outward) return;
		event.preventDefault();
		const step = (event.shiftKey ? 10 : 1) * (inward ? 1 : -1);
		const start = { x: 0, y: 0 };
		const local =
			edge === 'left'
				? { x: step, y: 0 }
				: edge === 'right'
					? { x: -step, y: 0 }
					: edge === 'top'
						? { x: 0, y: step }
						: { x: 0, y: -step };
		const radians = (rotation * Math.PI) / 180;
		const world = {
			x: local.x * Math.cos(radians) - local.y * Math.sin(radians),
			y: local.x * Math.sin(radians) + local.y * Math.cos(radians)
		};
		draftCrop = calculateCropFromDrag({
			edge,
			startCrop: item.crop,
			startPoint: start,
			currentPoint: world,
			rotation,
			mediaWidth: width,
			mediaHeight: height,
			sourceDimension:
				edge === 'left' || edge === 'right'
					? (item.sourceWidth ?? Math.round(width))
					: (item.sourceHeight ?? Math.round(height))
		});
		commitCrop(edge);
	}

	function startAnchor(event: PointerEvent): void {
		const start = canvasPoint(event);
		const base = resolvedTransform();
		attachPointerGesture(
			event,
			(point) => {
				draftTransform = calculateAnchorDrag(base, start, point);
				ontransformdraft(draftTransform);
			},
			() => {
				const next = draftTransform;
				if (
					next &&
					oncommitvalues(currentFrame, {
						x: next.x,
						y: next.y,
						anchorX: next.anchorX,
						anchorY: next.anchorY
					})
				)
					onedit();
				draftTransform = null;
				ontransformdraft(null);
			},
			() => {
				draftTransform = null;
				ontransformdraft(null);
			}
		);
	}

	function anchorKeydown(event: KeyboardEvent): void {
		const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
		if (!dx && !dy) return;
		event.preventDefault();
		const step = event.shiftKey ? 10 : 1;
		const start = { x: 0, y: 0 };
		const next = calculateAnchorDrag(resolvedTransform(), start, {
			x: dx * step,
			y: dy * step
		});
		if (
			oncommitvalues(currentFrame, {
				x: next.x,
				y: next.y,
				anchorX: next.anchorX,
				anchorY: next.anchorY
			})
		)
			onedit();
	}

	function startTextSession(): void {
		if (textSession) return;
		textSession = true;
		draftText = item.text ?? '';
		ontextdraft(draftText);
		ontextediting(true);
		requestAnimationFrame(() => {
			const editor = textEditor;
			if (!editor) return;
			editor.textContent = draftText ?? '';
			editor.focus();
			const selection = window.getSelection();
			const range = document.createRange();
			range.selectNodeContents(editor);
			selection?.removeAllRanges();
			selection?.addRange(range);
		});
	}

	function updateText(value: string): void {
		draftText = value;
		ontextdraft(value);
	}

	function finishText(commit: boolean): void {
		if (!textSession) return;
		const value = draftText ?? item.text ?? '';
		textSession = false;
		ontextediting(false);
		ontextdraft(null);
		draftText = null;
		if (commit && value !== (item.text ?? '')) {
			oncommittext(value);
			onedit();
		}
	}

	function textKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			cancellingText = true;
			finishText(false);
			activeTool = 'transform';
			requestAnimationFrame(() => (cancellingText = false));
		} else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			finishText(true);
			activeTool = 'transform';
		}
	}

	function pastePlainText(event: ClipboardEvent): void {
		event.preventDefault();
		const text = event.clipboardData?.getData('text/plain') ?? '';
		const selection = window.getSelection();
		if (!selection?.rangeCount) return;
		const range = selection.getRangeAt(0);
		range.deleteContents();
		const node = document.createTextNode(text);
		range.insertNode(node);
		range.setStartAfter(node);
		range.collapse(true);
		selection.removeAllRanges();
		selection.addRange(range);
		updateText(textEditor?.innerText ?? '');
	}

	function startMotionPoint(event: PointerEvent, point: MotionPathPoint): void {
		activeMotionFrame = point.frame;
		onseek(point.frame);
		const start = canvasPoint(event);
		let axis: 'x' | 'y' | null = null;
		attachPointerGesture(
			event,
			(current, pointer) => {
				let dx = current.x - start.x;
				let dy = current.y - start.y;
				if (pointer.shiftKey) {
					axis ??= Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
					if (axis === 'x') dy = 0;
					else dx = 0;
				}
				motionDraft = {
					frame: point.frame,
					x: point.x + dx - canvasWidth / 2,
					y: point.y + dy - canvasHeight / 2
				};
			},
			() => {
				if (motionDraft && oncommitposition(motionDraft.frame, motionDraft.x, motionDraft.y))
					onedit();
				motionDraft = null;
			},
			() => (motionDraft = null)
		);
	}

	function createMotionHandles(event: MouseEvent, point: MotionPathPoint): void {
		event.preventDefault();
		event.stopPropagation();
		activeMotionFrame = point.frame;
		onseek(point.frame);
		if (!point.spatial && oncreatespatial(point.frame)) onedit();
	}

	function startMotionHandle(
		event: PointerEvent,
		point: MotionPathPoint,
		handle: 'in' | 'out'
	): void {
		if (!point.spatial) return;
		event.stopPropagation();
		activeMotionFrame = point.frame;
		onseek(point.frame);
		const start = canvasPoint(event);
		const initial = handle === 'in' ? point.spatial.inTangent : point.spatial.outTangent;
		attachPointerGesture(
			event,
			(current, pointer) => {
				let tangent = {
					x: initial.x + current.x - start.x,
					y: initial.y + current.y - start.y
				};
				if (pointer.shiftKey) {
					if (Math.abs(tangent.x) >= Math.abs(tangent.y)) tangent = { x: tangent.x, y: 0 };
					else tangent = { x: 0, y: tangent.y };
				}
				const base = pointer.altKey ? { ...point.spatial!, continuous: false } : point.spatial!;
				spatialDraft = {
					frame: point.frame,
					spatial: withSpatialTangent(base, handle, tangent)
				};
			},
			() => {
				if (spatialDraft && oncommitspatial(spatialDraft.frame, spatialDraft.spatial)) onedit();
				spatialDraft = null;
			},
			() => (spatialDraft = null)
		);
	}

	function motionHandleKeydown(
		event: KeyboardEvent,
		point: MotionPathPoint,
		handle: 'in' | 'out'
	): void {
		if (!point.spatial) return;
		const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
		if (!dx && !dy) return;
		event.preventDefault();
		const step = event.shiftKey ? 10 : 1;
		const current = handle === 'in' ? point.spatial.inTangent : point.spatial.outTangent;
		const base = event.altKey ? { ...point.spatial, continuous: false } : point.spatial;
		if (
			oncommitspatial(
				point.frame,
				withSpatialTangent(base, handle, {
					x: current.x + dx * step,
					y: current.y + dy * step
				})
			)
		)
			onedit();
	}

	function toggleMotionContinuity(
		event: MouseEvent,
		point: MotionPathPoint,
		handle: 'in' | 'out'
	): void {
		event.preventDefault();
		event.stopPropagation();
		if (!point.spatial) return;
		const tangent = handle === 'in' ? point.spatial.inTangent : point.spatial.outTangent;
		const next = point.spatial.continuous
			? { ...point.spatial, continuous: false }
			: withSpatialTangent({ ...point.spatial, continuous: true }, handle, tangent);
		if (oncommitspatial(point.frame, next)) onedit();
	}

	function motionKeydown(event: KeyboardEvent, point: MotionPathPoint): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onseek(point.frame);
			return;
		}
		const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
		if (!dx && !dy) return;
		event.preventDefault();
		const step = event.shiftKey ? 10 : 1;
		if (
			oncommitposition(
				point.frame,
				point.x - canvasWidth / 2 + dx * step,
				point.y - canvasHeight / 2 + dy * step
			)
		)
			onedit();
	}
</script>

<div bind:this={root} class="pointer-events-none absolute inset-0 z-20" data-on-canvas-tools>
	<div
		class="pointer-events-auto absolute top-2 left-1/2 z-30 flex -translate-x-1/2 gap-0.5 rounded-md border border-white/15 bg-black/80 p-0.5 text-[10px] text-white shadow-lg backdrop-blur"
		role="toolbar"
		aria-label={m.video_editor_canvas_tools()}
	>
		<button
			type="button"
			class:active={activeTool === 'transform'}
			class="rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white [&.active]:bg-[oklch(0.72_0.16_45)] [&.active]:text-black"
			onclick={() => setTool('transform')}>{m.video_editor_canvas_tool_transform()}</button
		>
		{#if canCrop}
			<button
				type="button"
				class:active={activeTool === 'crop'}
				class="rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white [&.active]:bg-[oklch(0.72_0.16_45)] [&.active]:text-black"
				onclick={() => setTool('crop')}>{m.video_editor_canvas_tool_crop()}</button
			>
		{/if}
		<button
			type="button"
			class:active={activeTool === 'anchor'}
			class="rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white [&.active]:bg-[oklch(0.72_0.16_45)] [&.active]:text-black"
			onclick={() => setTool('anchor')}>{m.video_editor_canvas_tool_anchor()}</button
		>
		{#if canEditText}
			<button
				type="button"
				class:active={activeTool === 'text'}
				class="rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white [&.active]:bg-[oklch(0.72_0.16_45)] [&.active]:text-black"
				onclick={() => setTool('text')}>{m.video_editor_canvas_tool_text()}</button
			>
		{/if}
		{#if hasMotion && !isPlaying}
			<button
				type="button"
				class:active={activeTool === 'motion'}
				class="rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white [&.active]:bg-[oklch(0.72_0.16_45)] [&.active]:text-black"
				onclick={() => setTool('motion')}>{m.video_editor_canvas_tool_motion()}</button
			>
		{/if}
	</div>

	{#if activeTool === 'motion' && !isPlaying && motionPoints.length > 0}
		<svg
			class="absolute inset-0 size-full overflow-visible"
			viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
			aria-label={m.video_editor_motion_path()}
		>
			<polyline
				points={motionPoints.map((point) => `${point.x},${point.y}`).join(' ')}
				fill="none"
				stroke="black"
				stroke-width="5"
				stroke-linecap="round"
				stroke-linejoin="round"
				vector-effect="non-scaling-stroke"
			></polyline>
			<polyline
				points={motionPoints.map((point) => `${point.x},${point.y}`).join(' ')}
				fill="none"
				stroke="oklch(0.78 0.16 45)"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				vector-effect="non-scaling-stroke"
			></polyline>
			{#if activeMotionPoint?.spatial && activeMotionPoint.inHandle && activeMotionPoint.outHandle}
				<line
					x1={activeMotionPoint.inHandle.x}
					y1={activeMotionPoint.inHandle.y}
					x2={activeMotionPoint.outHandle.x}
					y2={activeMotionPoint.outHandle.y}
					stroke="black"
					stroke-width="4"
					vector-effect="non-scaling-stroke"
				></line>
				<line
					x1={activeMotionPoint.inHandle.x}
					y1={activeMotionPoint.inHandle.y}
					x2={activeMotionPoint.outHandle.x}
					y2={activeMotionPoint.outHandle.y}
					stroke="white"
					stroke-width="1.5"
					vector-effect="non-scaling-stroke"
				></line>
				{#each ['in', 'out'] as handle}
					{@const handlePoint =
						handle === 'in' ? activeMotionPoint.inHandle : activeMotionPoint.outHandle}
					<circle
						class="pointer-events-none"
						cx={handlePoint.x}
						cy={handlePoint.y}
						r={4 / screenScale}
						fill="white"
						stroke="black"
						stroke-width="2"
						vector-effect="non-scaling-stroke"
					></circle>
					<circle
						class="pointer-events-auto cursor-crosshair focus:outline-none focus-visible:stroke-[oklch(0.78_0.16_45)]"
						cx={handlePoint.x}
						cy={handlePoint.y}
						r={12 / screenScale}
						fill="transparent"
						stroke="transparent"
						stroke-width="2"
						vector-effect="non-scaling-stroke"
						role="button"
						tabindex="0"
						aria-label={handle === 'in'
							? m.video_editor_motion_in_tangent({ frame: activeMotionPoint.frame })
							: m.video_editor_motion_out_tangent({ frame: activeMotionPoint.frame })}
						onpointerdown={(event) =>
							startMotionHandle(event, activeMotionPoint, handle as 'in' | 'out')}
						ondblclick={(event) =>
							toggleMotionContinuity(event, activeMotionPoint, handle as 'in' | 'out')}
						onkeydown={(event) =>
							motionHandleKeydown(event, activeMotionPoint, handle as 'in' | 'out')}
						><title>{m.video_editor_motion_tangent_hint()}</title></circle
					>
				{/each}
			{/if}
			{#each motionPoints.filter((point) => point.isKeyframe) as point (point.frame)}
				<circle
					class="pointer-events-none"
					cx={point.x}
					cy={point.y}
					r={4 / screenScale}
					fill="oklch(0.78 0.16 45)"
					stroke="black"
					stroke-width="2"
					vector-effect="non-scaling-stroke"
				></circle>
				<circle
					class="pointer-events-auto cursor-move focus:outline-none focus-visible:stroke-white"
					cx={point.x}
					cy={point.y}
					r={12 / screenScale}
					fill="transparent"
					stroke="transparent"
					stroke-width="2"
					vector-effect="non-scaling-stroke"
					role="button"
					tabindex="0"
					aria-label={m.video_editor_motion_keyframe({ frame: point.frame })}
					onpointerdown={(event) => startMotionPoint(event, point)}
					ondblclick={(event) => createMotionHandles(event, point)}
					onkeydown={(event) => motionKeydown(event, point)}
				></circle>
			{/each}
			<circle
				class="pointer-events-none"
				cx={currentTransform.x}
				cy={currentTransform.y}
				r={4 / screenScale}
				fill="white"
				stroke="black"
				stroke-width="2"
				vector-effect="non-scaling-stroke"
			></circle>
		</svg>
	{:else}
		<div
			class="pointer-events-auto absolute border border-[oklch(0.72_0.16_45)] shadow-[0_0_0_1px_black]"
			class:cursor-move={activeTool === 'transform'}
			class:cursor-text={canEditText && activeTool === 'transform'}
			style={boxStyle}
			role="presentation"
			data-canvas-item-box
			onpointerdown={(event) => startTransform(event, 'move')}
			ondblclick={() => canEditText && setTool('text')}
		>
			{#if activeTool === 'transform'}
				<button
					type="button"
					class="absolute -right-4 -bottom-4 flex size-8 cursor-nwse-resize items-center justify-center rounded-full bg-transparent focus-visible:outline-2 focus-visible:outline-white"
					aria-label={m.video_editor_preview_resize_selected()}
					onpointerdown={(event) => startTransform(event, 'resize')}
				>
					<span class="size-4 rounded-full border border-black bg-[oklch(0.72_0.16_45)]"></span>
				</button>
			{:else if activeTool === 'crop'}
				<div class="pointer-events-none absolute inset-0 bg-black/15"></div>
				{#each ['left', 'right', 'top', 'bottom'] as edge}
					<button
						type="button"
						role="slider"
						class:left-0={edge === 'left'}
						class:right-0={edge === 'right'}
						class:top-0={edge === 'top'}
						class:bottom-0={edge === 'bottom'}
						class="absolute z-10 flex items-center justify-center bg-transparent focus-visible:outline-2 focus-visible:outline-white"
						class:vertical-handle={edge === 'left' || edge === 'right'}
						class:horizontal-handle={edge === 'top' || edge === 'bottom'}
						aria-label={m.video_editor_crop_handle({ edge })}
						aria-valuemin="0"
						aria-valuemax="99.9"
						aria-valuenow={Math.round(((draftCrop ?? item.crop)?.[edge as CropEdge] ?? 0) * 100)}
						aria-valuetext={`${Math.round(((draftCrop ?? item.crop)?.[edge as CropEdge] ?? 0) * 100)}%`}
						aria-orientation={edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical'}
						onpointerdown={(event) => startCrop(event, edge as CropEdge)}
						onkeydown={(event) => cropKeydown(event, edge as CropEdge)}
					>
						<span
							class:vertical-grip={edge === 'left' || edge === 'right'}
							class:horizontal-grip={edge === 'top' || edge === 'bottom'}
						></span>
					</button>
				{/each}
			{:else if activeTool === 'anchor'}
				<div
					class="pointer-events-none absolute h-px bg-[oklch(0.78_0.16_45)] shadow-[0_0_0_1px_black]"
					style:left="50%"
					style:top="50%"
					style:width={`${Math.hypot(anchorX - width / 2, anchorY - height / 2)}px`}
					style:transform-origin="left center"
					style:transform={`rotate(${Math.atan2(anchorY - height / 2, anchorX - width / 2)}rad)`}
				></div>
				<button
					type="button"
					class="absolute flex size-9 -translate-1/2 cursor-crosshair items-center justify-center rounded-full bg-transparent focus-visible:outline-2 focus-visible:outline-white"
					style:left={`${(anchorX / width) * 100}%`}
					style:top={`${(anchorY / height) * 100}%`}
					aria-label={m.video_editor_anchor_handle()}
					onpointerdown={startAnchor}
					onkeydown={anchorKeydown}
				>
					<span
						class="size-5 rounded-full border-2 border-black bg-[oklch(0.78_0.16_45)] shadow-[0_0_0_1px_white]"
					></span>
				</button>
			{/if}
		</div>
	{/if}

	{#if activeTool === 'text' && canEditText}
		<div
			bind:this={textEditor}
			class="pointer-events-auto absolute z-10 flex overflow-hidden border border-[oklch(0.78_0.16_45)] bg-black/10 whitespace-pre-wrap text-white caret-[oklch(0.78_0.16_45)] shadow-[0_0_0_1px_black] focus:outline-none"
			style={boxStyle}
			style:font-family={item.fontFamily ?? 'Inter, sans-serif'}
			style:font-size={`${((item.fontSize ?? Math.max(18, height / 15)) / canvasWidth) * 100}cqw`}
			style:font-weight={item.fontWeight ?? 600}
			style:line-height={item.lineHeight ?? 1.2}
			style:letter-spacing={`${((item.letterSpacing ?? 0) / canvasWidth) * 100}cqw`}
			style:text-align={item.textAlign ?? 'center'}
			style:color={item.color ?? '#ffffff'}
			style:background-color={item.backgroundColor ?? 'transparent'}
			style:padding={`${((item.paddingY ?? 0) / canvasHeight) * 100}cqh ${((item.paddingX ?? 0) / canvasWidth) * 100}cqw`}
			style:align-items={item.verticalAlign === 'top'
				? 'flex-start'
				: item.verticalAlign === 'bottom'
					? 'flex-end'
					: 'center'}
			contenteditable="plaintext-only"
			role="textbox"
			tabindex="0"
			aria-multiline="true"
			aria-label={m.video_editor_direct_text_editor()}
			oninput={(event) => updateText(event.currentTarget.innerText)}
			onpaste={pastePlainText}
			onkeydown={textKeydown}
			onblur={() => {
				if (!cancellingText) finishText(true);
			}}
		></div>
	{/if}
</div>

<style>
	.vertical-handle {
		top: 50%;
		width: 1.5rem;
		height: 2.75rem;
		transform: translateY(-50%);
		cursor: ew-resize;
	}

	.horizontal-handle {
		left: 50%;
		width: 2.75rem;
		height: 1.5rem;
		transform: translateX(-50%);
		cursor: ns-resize;
	}

	.vertical-grip {
		width: 0.5rem;
		height: 2rem;
		border: 1px solid black;
		border-radius: 0.125rem;
		background: oklch(0.78 0.16 45);
	}

	.horizontal-grip {
		width: 2rem;
		height: 0.5rem;
		border: 1px solid black;
		border-radius: 0.125rem;
		background: oklch(0.78 0.16 45);
	}
</style>
