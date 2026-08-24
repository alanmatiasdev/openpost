<script lang="ts">
	import { onMount } from 'svelte';
	import { renderQueueRunner } from '../export/render-queue-runner';
	import { renderQueueStore } from '../export/render-queue-store';
	import {
		loadProjectRenderQueue,
		saveProjectRenderQueue
	} from '../export/render-queue-persistence';

	let {
		projectId,
		onerror = () => undefined
	}: { projectId: string; onerror?: (error: Error) => void } = $props();

	let loadedProjectId: string | null = null;
	let loadVersion = 0;
	let lastSignature = '';
	let saveScheduled = false;

	function signature(): string {
		return `${$renderQueueStore.isPaused ? 'paused' : 'running'}|${$renderQueueStore.jobs
			.map((job) => `${job.id}:${job.status}`)
			.join('|')}`;
	}

	function scheduleSave(): void {
		if (!loadedProjectId || saveScheduled) return;
		saveScheduled = true;
		queueMicrotask(() => {
			saveScheduled = false;
			if (!loadedProjectId) return;
			void saveProjectRenderQueue(
				loadedProjectId,
				$renderQueueStore.jobs,
				$renderQueueStore.isPaused
			).catch((cause) => onerror(cause instanceof Error ? cause : new Error(String(cause))));
		});
	}

	$effect(() => {
		const nextSignature = signature();
		if (!loadedProjectId || nextSignature === lastSignature) return;
		lastSignature = nextSignature;
		scheduleSave();
	});

	$effect(() => {
		const targetId = projectId;
		const version = ++loadVersion;
		loadedProjectId = null;
		renderQueueStore.hydrate([], true);
		void loadProjectRenderQueue(targetId)
			.then((restored) => {
				if (version !== loadVersion) return;
				const restoredIds = new Set(restored.jobs.map((job) => job.id));
				const addedWhileLoading = $renderQueueStore.jobs.filter((job) => !restoredIds.has(job.id));
				renderQueueStore.hydrate([...restored.jobs, ...addedWhileLoading], restored.isPaused);
				loadedProjectId = targetId;
				lastSignature = signature();
				if (addedWhileLoading.length > 0) scheduleSave();
			})
			.catch((cause) => {
				if (version !== loadVersion) return;
				renderQueueStore.setPaused(false);
				loadedProjectId = targetId;
				lastSignature = signature();
				onerror(cause instanceof Error ? cause : new Error(String(cause)));
			});
	});

	onMount(() => {
		renderQueueRunner.start();
		return () => {
			if (loadedProjectId) {
				void saveProjectRenderQueue(
					loadedProjectId,
					$renderQueueStore.jobs,
					$renderQueueStore.isPaused
				).catch((cause) => onerror(cause instanceof Error ? cause : new Error(String(cause))));
			}
			renderQueueRunner.stop();
		};
	});
</script>
