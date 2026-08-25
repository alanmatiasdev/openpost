<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Input } from '$lib/components/ui/input';
	import type { ShapeType, TimelineItem } from '$lib/video-editor/project/types';
	import { updateItemProperties } from '$lib/video-editor/timeline/actions/items';
	import { hasPathVertexKeyframes } from '$lib/video-editor/timeline/path-vertex-keyframes';

	let { item, onedit }: { item: TimelineItem; onedit: () => void } = $props();

	const shapeTypes: Array<{ type: ShapeType; label: () => string }> = [
		{ type: 'rectangle', label: m.video_editor_shape_primitive_rectangle },
		{ type: 'circle', label: m.video_editor_shape_primitive_circle },
		{ type: 'ellipse', label: m.video_editor_shape_primitive_ellipse },
		{ type: 'triangle', label: m.video_editor_shape_primitive_triangle },
		{ type: 'star', label: m.video_editor_shape_primitive_star },
		{ type: 'polygon', label: m.video_editor_shape_primitive_polygon },
		{ type: 'heart', label: m.video_editor_shape_primitive_heart },
		{ type: 'path', label: m.video_editor_shape_primitive_pen }
	];
	const pathTopologyLocked = $derived(
		item.shapeType === 'path' && hasPathVertexKeyframes(item.keyframes)
	);
	type StrokePathProperty =
		| 'trimPathStart'
		| 'trimPathEnd'
		| 'trimPathOffset'
		| 'taperStartWidth'
		| 'taperEndWidth'
		| 'taperStartLength'
		| 'taperEndLength';
	interface StrokePathField {
		property: StrokePathProperty;
		label: string;
		minimum: number;
		maximum: number;
		defaultValue: number;
	}
	const trimPathFields: StrokePathField[] = [
		{
			property: 'trimPathStart',
			label: m.video_editor_shape_trim_start(),
			minimum: 0,
			maximum: 100,
			defaultValue: 0
		},
		{
			property: 'trimPathEnd',
			label: m.video_editor_shape_trim_end(),
			minimum: 0,
			maximum: 100,
			defaultValue: 100
		},
		{
			property: 'trimPathOffset',
			label: m.video_editor_shape_trim_offset(),
			minimum: -360,
			maximum: 360,
			defaultValue: 0
		}
	];
	const taperFields: StrokePathField[] = [
		{
			property: 'taperStartWidth',
			label: m.video_editor_shape_taper_start_width(),
			minimum: 0,
			maximum: 200,
			defaultValue: 100
		},
		{
			property: 'taperStartLength',
			label: m.video_editor_shape_taper_start_length(),
			minimum: 0,
			maximum: 100,
			defaultValue: 0
		},
		{
			property: 'taperEndWidth',
			label: m.video_editor_shape_taper_end_width(),
			minimum: 0,
			maximum: 200,
			defaultValue: 100
		},
		{
			property: 'taperEndLength',
			label: m.video_editor_shape_taper_end_length(),
			minimum: 0,
			maximum: 100,
			defaultValue: 0
		}
	];

	function commit(patch: Partial<TimelineItem>): void {
		updateItemProperties(item.id, patch, 'UPDATE_SHAPE_PROPERTIES');
		onedit();
	}

	function numberPatch(property: keyof TimelineItem, value: number): void {
		if (Number.isFinite(value)) commit({ [property]: value });
	}

	function strokePathPatch(field: StrokePathField, value: number): void {
		if (!Number.isFinite(value)) return;
		commit({ [field.property]: Math.max(field.minimum, Math.min(field.maximum, value)) });
	}

	function setMaskEnabled(enabled: boolean): void {
		if (enabled && pathTopologyLocked && item.pathClosed === false) return;
		commit({
			isMask: enabled,
			blendMode: enabled ? 'normal' : undefined,
			maskType: enabled ? 'clip' : undefined,
			maskFeather: enabled ? 0 : undefined,
			maskOpacity: enabled ? 100 : undefined,
			maskInvert: enabled ? false : undefined,
			pathClosed: enabled ? true : item.pathClosed
		});
	}

	function setMaskType(maskType: 'clip' | 'alpha'): void {
		const existingFeather = item.maskFeather ?? 0;
		commit({
			maskType,
			maskFeather: maskType === 'alpha' ? (existingFeather > 0 ? existingFeather : 10) : 0
		});
	}
</script>

<section class="flex flex-col gap-2">
	<h3 class="text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase">
		{m.video_editor_shapes()}
	</h3>

	<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
		{m.video_editor_shape_kind()}
		<select
			class="mt-0.5 h-8 w-full rounded border border-[oklch(0.3_0.015_55)] bg-[oklch(0.2_0.01_50)] px-2 text-xs text-white focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
			value={item.shapeType ?? 'rectangle'}
			disabled={pathTopologyLocked}
			onchange={(event) => commit({ shapeType: event.currentTarget.value as ShapeType })}
		>
			{#each shapeTypes as shape (shape.type)}
				<option value={shape.type}>{shape.label()}</option>
			{/each}
		</select>
	</label>
	{#if pathTopologyLocked}
		<p class="rounded bg-amber-400/10 px-2 py-1.5 text-[10px] leading-4 text-amber-100">
			{m.video_editor_path_topology_locked()}
		</p>
	{/if}

	{#if !item.isMask}
		<div class="grid grid-cols-2 gap-1">
			<label class="flex items-center gap-1.5 text-[10px] text-[oklch(0.7_0.01_55)]">
				<input
					type="checkbox"
					class="size-3.5 accent-[oklch(0.66_0.14_45)]"
					checked={item.fillEnabled ?? true}
					onchange={(event) => commit({ fillEnabled: event.currentTarget.checked })}
				/>
				{m.video_editor_shape_fill_enabled()}
			</label>
			<label class="flex items-center gap-1.5 text-[10px] text-[oklch(0.7_0.01_55)]">
				<input
					type="checkbox"
					class="size-3.5 accent-[oklch(0.66_0.14_45)]"
					checked={item.strokeEnabled ?? false}
					onchange={(event) => commit({ strokeEnabled: event.currentTarget.checked })}
				/>
				{m.video_editor_shape_stroke_enabled()}
			</label>
		</div>

		{#if item.fillEnabled ?? true}
			<div class="grid grid-cols-2 gap-1">
				<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
					{m.video_editor_shape_fill_style()}
					<select
						class="mt-0.5 h-8 w-full rounded border border-[oklch(0.3_0.015_55)] bg-[oklch(0.2_0.01_50)] px-1.5 text-xs text-white"
						value={item.fillType ?? 'solid'}
						onchange={(event) =>
							commit({
								fillType: event.currentTarget.value as 'solid' | 'linear'
							})}
					>
						<option value="solid">{m.video_editor_shape_fill_solid()}</option>
						<option value="linear">{m.video_editor_shape_fill_linear()}</option>
					</select>
				</label>
				<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
					{item.fillType === 'linear'
						? m.video_editor_shape_gradient_start()
						: m.video_editor_shape_fill()}
					<Input
						type="color"
						class="mt-0.5 h-8 w-full rounded bg-transparent"
						value={item.fillType === 'linear'
							? (item.gradientStartColor ?? item.fillColor ?? '#f97316')
							: (item.fillColor ?? '#f97316')}
						onchange={(event) =>
							commit(
								item.fillType === 'linear'
									? { gradientStartColor: event.currentTarget.value }
									: { fillColor: event.currentTarget.value }
							)}
					/>
				</label>
			</div>
			{#if item.fillType === 'linear'}
				<div class="grid grid-cols-2 gap-1">
					<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
						{m.video_editor_shape_gradient_end()}
						<Input
							type="color"
							class="mt-0.5 h-8 w-full rounded bg-transparent"
							value={item.gradientEndColor ?? '#fb7185'}
							onchange={(event) => commit({ gradientEndColor: event.currentTarget.value })}
						/>
					</label>
					<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
						{m.video_editor_shape_gradient_angle()}
						<Input
							type="number"
							min="-360"
							max="360"
							step="1"
							class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
							value={item.gradientAngle ?? 0}
							onchange={(event) => numberPatch('gradientAngle', event.currentTarget.valueAsNumber)}
						/>
					</label>
				</div>
			{/if}
		{/if}

		{#if item.strokeEnabled}
			<div class="grid grid-cols-2 gap-1">
				<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
					{m.video_editor_shape_stroke()}
					<Input
						type="color"
						class="mt-0.5 h-8 w-full rounded bg-transparent"
						value={item.strokeColor ?? '#ffffff'}
						onchange={(event) => commit({ strokeColor: event.currentTarget.value })}
					/>
				</label>
				<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
					{m.video_editor_shape_stroke_width()}
					<Input
						type="number"
						min="0"
						max="500"
						step="1"
						class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
						value={item.strokeWidth ?? 8}
						onchange={(event) => numberPatch('strokeWidth', event.currentTarget.valueAsNumber)}
					/>
				</label>
			</div>
			<div class="grid grid-cols-2 gap-1">
				<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
					{m.video_editor_shape_line_cap()}
					<select
						class="mt-0.5 h-8 w-full rounded border border-[oklch(0.3_0.015_55)] bg-[oklch(0.2_0.01_50)] px-1.5 text-xs text-white"
						value={item.strokeLineCap ?? 'butt'}
						onchange={(event) =>
							commit({
								strokeLineCap: event.currentTarget.value as NonNullable<
									TimelineItem['strokeLineCap']
								>
							})}
					>
						<option value="butt">{m.video_editor_shape_line_cap_butt()}</option>
						<option value="round">{m.video_editor_shape_line_cap_round()}</option>
						<option value="square">{m.video_editor_shape_line_cap_square()}</option>
					</select>
				</label>
				<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
					{m.video_editor_shape_line_join()}
					<select
						class="mt-0.5 h-8 w-full rounded border border-[oklch(0.3_0.015_55)] bg-[oklch(0.2_0.01_50)] px-1.5 text-xs text-white"
						value={item.strokeLineJoin ?? 'miter'}
						onchange={(event) =>
							commit({
								strokeLineJoin: event.currentTarget.value as NonNullable<
									TimelineItem['strokeLineJoin']
								>
							})}
					>
						<option value="miter">{m.video_editor_shape_line_join_miter()}</option>
						<option value="round">{m.video_editor_shape_line_join_round()}</option>
						<option value="bevel">{m.video_editor_shape_line_join_bevel()}</option>
					</select>
				</label>
			</div>
			{#if (item.strokeLineJoin ?? 'miter') === 'miter'}
				<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
					{m.video_editor_shape_miter_limit()}
					<Input
						type="number"
						min="1"
						max="100"
						step="0.5"
						class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
						value={item.strokeMiterLimit ?? 4}
						onchange={(event) => numberPatch('strokeMiterLimit', event.currentTarget.valueAsNumber)}
					/>
				</label>
			{/if}

			{#if !item.isMask}
				<fieldset class="space-y-1.5 border-t border-white/10 pt-2">
					<legend
						class="text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase"
					>
						{m.video_editor_shape_trim_paths()}
					</legend>
					<div class="grid grid-cols-2 gap-1">
						{#each trimPathFields as field (field.property)}
							<label class="min-w-0 text-[10px] text-[oklch(0.7_0.01_55)]">
								{field.label}
								<Input
									type="number"
									min={field.minimum}
									max={field.maximum}
									step="1"
									class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
									value={item[field.property] ?? field.defaultValue}
									onchange={(event) => strokePathPatch(field, event.currentTarget.valueAsNumber)}
								/>
							</label>
						{/each}
					</div>
				</fieldset>

				<fieldset class="space-y-1.5 border-t border-white/10 pt-2">
					<legend
						class="text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase"
					>
						{m.video_editor_shape_taper()}
					</legend>
					<div class="grid grid-cols-2 gap-1">
						{#each taperFields as field (field.property)}
							<label class="min-w-0 text-[10px] text-[oklch(0.7_0.01_55)]">
								{field.label}
								<Input
									type="number"
									min={field.minimum}
									max={field.maximum}
									step="1"
									class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
									value={item[field.property] ?? field.defaultValue}
									onchange={(event) => strokePathPatch(field, event.currentTarget.valueAsNumber)}
								/>
							</label>
						{/each}
					</div>
				</fieldset>
			{/if}
		{/if}

		{#if ['rectangle', 'triangle', 'star', 'polygon'].includes(item.shapeType ?? 'rectangle')}
			<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
				{m.video_editor_corner_radius()}
				<Input
					type="number"
					min="0"
					max="1000"
					step="1"
					class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
					value={item.shapeCornerRadius ?? 0}
					onchange={(event) => numberPatch('shapeCornerRadius', event.currentTarget.valueAsNumber)}
				/>
			</label>
		{/if}

		{#if item.shapeType === 'triangle'}
			<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
				{m.video_editor_shape_direction()}
				<select
					class="mt-0.5 h-8 w-full rounded border border-[oklch(0.3_0.015_55)] bg-[oklch(0.2_0.01_50)] px-2 text-xs text-white"
					value={item.shapeDirection ?? 'up'}
					onchange={(event) =>
						commit({
							shapeDirection: event.currentTarget.value as NonNullable<
								TimelineItem['shapeDirection']
							>
						})}
				>
					<option value="up">{m.video_editor_shape_direction_up()}</option>
					<option value="down">{m.video_editor_shape_direction_down()}</option>
					<option value="left">{m.video_editor_shape_direction_left()}</option>
					<option value="right">{m.video_editor_shape_direction_right()}</option>
				</select>
			</label>
		{/if}

		{#if item.shapeType === 'star' || item.shapeType === 'polygon'}
			<div class="grid grid-cols-2 gap-1">
				<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
					{m.video_editor_shape_points()}
					<Input
						type="number"
						min="3"
						max="64"
						step="1"
						class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
						value={item.shapePoints ?? (item.shapeType === 'star' ? 5 : 6)}
						onchange={(event) => numberPatch('shapePoints', event.currentTarget.valueAsNumber)}
					/>
				</label>
				{#if item.shapeType === 'star'}
					<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
						{m.video_editor_shape_inner_radius()}
						<Input
							type="number"
							min="0.05"
							max="0.95"
							step="0.01"
							class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
							value={item.shapeInnerRadius ?? 0.5}
							onchange={(event) =>
								numberPatch('shapeInnerRadius', event.currentTarget.valueAsNumber)}
						/>
					</label>
				{/if}
			</div>
		{/if}
	{/if}

	<div class="border-t border-[oklch(0.3_0.015_55)] pt-2">
		<label class="flex items-center gap-1.5 text-[10px] text-[oklch(0.7_0.01_55)]">
			<input
				type="checkbox"
				class="size-3.5 accent-[oklch(0.66_0.14_45)]"
				checked={item.isMask ?? false}
				disabled={pathTopologyLocked && !item.isMask && item.pathClosed === false}
				onchange={(event) => setMaskEnabled(event.currentTarget.checked)}
			/>
			{m.video_editor_shape_use_as_mask()}
		</label>
	</div>

	{#if item.isMask}
		<p class="text-[10px] leading-4 text-[oklch(0.6_0.01_55)]">
			{m.video_editor_shape_mask_scope()}
		</p>
		<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
			{m.video_editor_shape_mask_type()}
			<select
				class="mt-0.5 h-8 w-full rounded border border-[oklch(0.3_0.015_55)] bg-[oklch(0.2_0.01_50)] px-2 text-xs text-white"
				value={item.maskType ?? 'clip'}
				onchange={(event) => setMaskType(event.currentTarget.value as 'clip' | 'alpha')}
			>
				<option value="clip">{m.video_editor_shape_mask_clip()}</option>
				<option value="alpha">{m.video_editor_shape_mask_alpha()}</option>
			</select>
		</label>

		{#if item.maskType === 'alpha'}
			<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
				{m.video_editor_shape_mask_feather()}
				<Input
					type="number"
					min="0"
					max="100"
					step="1"
					class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
					value={item.maskFeather ?? 10}
					onchange={(event) => numberPatch('maskFeather', event.currentTarget.valueAsNumber)}
				/>
			</label>
		{/if}

		<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
			{m.video_editor_shape_mask_opacity()}
			<Input
				type="number"
				min="0"
				max="100"
				step="1"
				class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
				value={item.maskOpacity ?? 100}
				onchange={(event) => numberPatch('maskOpacity', event.currentTarget.valueAsNumber)}
			/>
		</label>

		<label class="flex items-center gap-1.5 text-[10px] text-[oklch(0.7_0.01_55)]">
			<input
				type="checkbox"
				class="size-3.5 accent-[oklch(0.66_0.14_45)]"
				checked={item.maskInvert ?? false}
				onchange={(event) => commit({ maskInvert: event.currentTarget.checked })}
			/>
			{m.video_editor_shape_mask_invert()}
		</label>

		{#if item.shapeType === 'path'}
			<p
				class="rounded bg-[oklch(0.18_0.01_50)] px-2 py-1.5 text-[10px] leading-4 text-[oklch(0.72_0.01_55)]"
			>
				{m.video_editor_shape_mask_path_hint()}
			</p>
		{/if}
	{/if}
</section>
