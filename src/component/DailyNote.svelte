<script lang="ts">
    import type DailyNoteViewPlugin from "../dailyNoteViewIndex";
    import {
        TAbstractFile,
        TFile,
        WorkspaceLeaf,
    } from "obsidian";
    import { spawnLeafView } from "../leafView";
    import { HOVER_LINK_SOURCE } from "../dailyNoteView";
    import { onDestroy, onMount } from "svelte";

    export let file: TAbstractFile;
    export let plugin: DailyNoteViewPlugin;
    export let leaf: WorkspaceLeaf;
    export let shouldRender: boolean = true;

    let editorEl: HTMLElement;
    let containerEl: HTMLElement;
    let title: string;

    let rendered: boolean = false;

    let createdLeaf: WorkspaceLeaf;
    let unloadTimeout: number | null = null;
    let editorHeight: number = 100; // Default minimum height

    // Track if this component is being destroyed
    let isDestroying = false;

    // Track if the note is collapsed
    let isCollapsed: boolean = false;

    // CodeMirror measures only lines that were on screen. Anything else it
    // guesses with a 30-character line, 3-5x too tall on a wide window, so a
    // placeholder or a kept height may only come from a note that was visible.
    let everVisible = false;
    let visibility: IntersectionObserver | null = null;

    onMount(() => {
        if (file instanceof TFile) {
            title = file.basename;
        }
        if (containerEl) {
            visibility = new IntersectionObserver((entries) => {
                if (entries.some((e) => e.isIntersecting)) everVisible = true;
            });
            visibility.observe(containerEl);
        }
        if (!rendered) {
            estimateHeight().then((h) => {
                if (!rendered && !isDestroying) editorHeight = h;
            });
        }
    });

    // Height the note will take once laid out, from its text and the editor
    // width: wrapped lines at the body line height, plus the editor's padding.
    async function estimateHeight(): Promise<number> {
        if (!(file instanceof TFile) || !editorEl) return 100;
        const text = await plugin.app.vault.cachedRead(file);
        const fontSize = parseFloat(getComputedStyle(editorEl).fontSize) || 16;
        const charsPerLine = Math.max(20, Math.floor(editorEl.clientWidth / (fontSize * 0.5)));
        const lines = text
            .split("\n")
            .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
        return Math.round(lines * fontSize * 1.5) + 32;
    }

    $: if (editorEl && shouldRender && !rendered) {
        showEditor();
    } else if (editorEl && !shouldRender && rendered) {
        scheduleUnload();
    }

    onDestroy(() => {
        isDestroying = true;
        visibility?.disconnect();
        if (unloadTimeout) {
            window.clearTimeout(unloadTimeout);
            unloadTimeout = null;
        }
        if (rendered && createdLeaf) {
            unloadEditor();
        }
    });

    function showEditor() {
        if (!(file instanceof TFile)) return;
        if (rendered) return;
        if (isDestroying) return;

        // Clear any pending unload
        if (unloadTimeout) {
            window.clearTimeout(unloadTimeout);
            unloadTimeout = null;
        }

        try {
            [createdLeaf] = spawnLeafView(plugin, editorEl, leaf);
            createdLeaf.setPinned(true);

            createdLeaf.setViewState({
                type: "markdown",
                state: {
                    file: file.path,
                    mode: "source",
                    source: false,
                    backlinks: !plugin.settings.hideBacklinks,
                    backlinkOpts: {
                        collapseAll: false,
                        extraContext: false,
                        sortOrder: "alphabetical",
                        showSearch: false,
                        searchQuery: "",
                        backlinkCollapsed: false,
                        unlinkedCollapsed: true,
                    },
                },
            });
            createdLeaf.parentLeaf = leaf;

            rendered = true;

            // The real editor is in: release any height kept while this note was
            // unloaded. Never pin the editor's own early height: 400ms after
            // creation CodeMirror still estimates its unrendered lines (cm-gap),
            // often 3-5x too tall, and a pinned min-height outlived the correction
            // as a blank page under the note.
            editorHeight = 100;
        } catch (error) {
            console.error("Error creating leaf view:", error);
        }
    }

    // Schedule unloading the editor with a delay to prevent flickering
    function scheduleUnload() {
        if (unloadTimeout) {
            window.clearTimeout(unloadTimeout);
        }

        // Use a longer timeout to prevent frequent load/unload cycles
        // and ignore spurious inview:false from container resizes
        unloadTimeout = window.setTimeout(() => {
            // Double-check shouldRender before unloading
            if (!shouldRender && rendered) {
                unloadEditor();
            }
        }, 2000);
    }

    // Unload the editor to free up resources
    function unloadEditor() {
        if (!rendered || !createdLeaf) return;

        try {
            // CRITICAL FIX: Before detaching, if this leaf is active,
            // switch to parent leaf to prevent Obsidian from jumping to a random leaf
            const workspace = plugin.app.workspace;
            const activeLeaf = workspace.activeLeaf;

            // Check if the leaf being unloaded is currently active or if activeLeaf is inside our view
            const isThisLeafActive = activeLeaf === createdLeaf;
            const isActiveLeafInOurView =
                activeLeaf && (activeLeaf as any).parentLeaf === leaf;

            if (isThisLeafActive || isActiveLeafInOurView) {
                // Set the parent Daily Notes View leaf as active
                workspace.setActiveLeaf(leaf, { focus: false });
            }

            // Keep the note's measured height while it is unloaded so the
            // placeholder occupies the same space and the page does not shift.
            const keptHeight = containerEl?.getBoundingClientRect().height ?? 0;
            if (everVisible && keptHeight > 0) {
                editorHeight = keptHeight;
            } else {
                estimateHeight().then((h) => {
                    if (!rendered && !isDestroying) editorHeight = h;
                });
            }

            // Detach the leaf
            if (createdLeaf.detach) {
                createdLeaf.detach();
            }

            // Clear the editor element
            if (editorEl) {
                editorEl.empty();
            }

            rendered = false;
        } catch (error) {
            console.error("Error unloading editor:", error);
        }
    }

    function handleFileIconClick() {
        if (!(file instanceof TFile)) return;
        if (leaf && !(leaf as any)?.pinned) {
            leaf.openFile(file);
        } else plugin.app.workspace.getLeaf(false).openFile(file);
    }

    function handleTitleHover(event: MouseEvent) {
        if (!(file instanceof TFile)) return;
        plugin.app.workspace.trigger("hover-link", {
            event,
            source: HOVER_LINK_SOURCE,
            hoverParent: leaf.view,
            targetEl: event.currentTarget as HTMLElement,
            linktext: file.path,
            sourcePath: file.path,
        });
    }

    function handleEditorClick() {
        // @ts-ignore
        const editor = createdLeaf?.view?.editMode?.editor;
        if (editor && !editor.hasFocus()) {
            editor.focus();
        }
    }

    // Toggle collapse/expand state
    function toggleCollapse() {
        isCollapsed = !isCollapsed;
    }
</script>

<div
    class="daily-note-container"
    data-id="dn-editor-{file.path}"
    bind:this={containerEl}
    style="min-height: {isCollapsed ? 'auto' : editorHeight + 'px'};"
>
    <div class="daily-note">
        {#if title}
            <div class="daily-note-title inline-title">
                <!-- Collapse/Expand button -->
                <!-- svelte-ignore a11y-interactive-supports-focus -->
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <span
                    role="button"
                    data-collapsed={isCollapsed}
                    class="collapse-button"
                    on:click={toggleCollapse}
                    title={isCollapsed ? "Expand" : "Collapse"}
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="lucide lucide-chevron-down"
                        ><path d="m6 9 6 6 6-6" /></svg
                    >
                </span>
                <!-- svelte-ignore a11y-interactive-supports-focus -->
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <span
                    role="link"
                    class="clickable-link"
                    on:click={handleFileIconClick}
                    on:mouseover={handleTitleHover}
                    on:focus={() => {}}
                    data-title={title}>{title}</span
                >
            </div>
        {/if}
        <div
            class="daily-note-editor"
            data-collapsed={isCollapsed}
            aria-hidden="true"
            bind:this={editorEl}
            data-title={title}
            on:click={handleEditorClick}
        >
            {#if !rendered && shouldRender}
                <div class="editor-placeholder">Loading...</div>
            {/if}
            {#if !shouldRender && !rendered}
                <div class="editor-placeholder">Scroll to view content</div>
            {/if}
        </div>
    </div>
</div>

<style>
    .daily-note {
        margin-bottom: var(--size-4-5);
        padding-bottom: var(--size-4-8);
    }

    .daily-note:has(.daily-note-editor[data-collapsed="true"]) {
        margin-bottom: 0;
        padding-bottom: 0;
    }

    .daily-note-editor {
        min-height: 100px;
    }

    .daily-note-editor[data-collapsed="true"] {
        display: none;
    }

    .daily-note .collapse-button {
        display: none;
    }

    .daily-note:hover .collapse-button {
        display: block;
    }

    .daily-note .collapse-button {
        color: var(--text-muted);
    }

    .daily-note .collapse-button:hover {
        color: var(--text-normal);
    }

    .daily-note:has(.is-readable-line-width) .daily-note-title {
        max-width: calc(var(--file-line-width) + var(--size-4-4));
        width: calc(var(--file-line-width) + var(--size-4-4));
        margin-left: auto;
        margin-right: auto;
        margin-bottom: var(--size-4-8);
        display: flex;
        align-items: center;
        justify-content: start;

        gap: var(--size-4-2);
    }

    .collapse-button {
        margin-left: calc(var(--size-4-8) * -1);
    }

    .collapse-button[data-collapsed="true"] {
        transform: rotate(-90deg);

        transition: transform 0.2s ease;
    }

    .daily-note:not(:has(.is-readable-line-width)) .daily-note-title {
        display: flex;
        justify-content: start;
        align-items: center;
        width: 100%;
        padding-left: calc(
            calc(100% - var(--file-line-width)) / 2 - var(--size-4-2)
        );
        padding-right: calc(
            calc(100% - var(--file-line-width)) / 2 - var(--size-4-2)
        );
        margin-top: var(--size-4-8);

        gap: var(--size-4-2);
    }

    .clickable-link {
        cursor: pointer;
        text-decoration: none;
    }

    .clickable-link:hover {
        color: var(--color-accent);
        text-decoration: underline;
    }

    .editor-placeholder {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100px;
        color: var(--text-muted);
        font-style: italic;
    }

    .collapse-button {
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 4px;
        color: var(--text-muted);
        transition: background-color 0.2s ease;
    }

    .collapse-button:hover {
        /* background-color: var(--background-modifier-hover); */
        color: var(--text-normal);
    }
</style>
