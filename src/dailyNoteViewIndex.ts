import {
    Plugin,
    Workspace,
    WorkspaceLeaf,
    moment,
    TFolder,
} from "obsidian";

import { around } from "monkey-around";
import { isDailyNoteLeaf } from "./leafView";
import "./style/index.css";
import {
    DailyNoteSettings,
    DailyNoteSettingTab,
    DEFAULT_SETTINGS,
} from "./dailyNoteSettings";
import { TimeField } from "./types/time";
import {
    getAllDailyNotes,
    getDailyNote,
    createDailyNote,
} from "obsidian-daily-notes-interface";
import { createUpDownNavigationExtension } from "./component/UpAndDownNavigate";
import {
    DAILY_NOTE_VIEW_TYPE,
    HOVER_LINK_SOURCE,
    DailyNoteView,
} from "./dailyNoteView";

export default class DailyNoteViewPlugin extends Plugin {
    private view: DailyNoteView;
    private lastCheckedDay: string;

    declare settings: DailyNoteSettings;

    async onload() {
        this.addSettingTab(new DailyNoteSettingTab(this.app, this));
        await this.loadSettings();
        this.patchWorkspace();
        this.patchWorkspaceLeaf();

        this.lastCheckedDay = moment().format("YYYY-MM-DD");

        // Register the up and down navigation extension
        this.settings.useArrowUpOrDownToNavigate &&
            this.registerEditorExtension([
                createUpDownNavigationExtension({
                    app: this.app,
                    plugin: this,
                }),
                // setActiveEditorExt({ app: this.app, plugin: this }),
            ]);

        this.registerView(
            DAILY_NOTE_VIEW_TYPE,
            (leaf: WorkspaceLeaf) => (this.view = new DailyNoteView(leaf, this))
        );

        // Allow the daily note titles to trigger the core Page Preview plugin
        // (and plugins like Hover Editor that hook into it)
        this.registerHoverLinkSource(HOVER_LINK_SOURCE, {
            display: "Daily Notes Editor",
            defaultMod: false,
        });

        this.addRibbonIcon(
            "calendar-range",
            "Open Daily Note Editor",
            (evt: MouseEvent) => this.openDailyNoteEditor()
        );
        this.addCommand({
            id: "open-daily-note-editor",
            name: "Open Daily Note Editor",
            callback: () => this.openDailyNoteEditor(),
        });

        this.initCssRules();

        // Create daily note and/or open the Daily Notes Editor on startup if enabled
        this.app.workspace.onLayoutReady(async () => {
            if (this.settings.autoCreateDailyNote) {
                await this.ensureTodaysDailyNoteExists();
            }
            if (this.settings.createAndOpenOnStartup) {
                if (
                    this.app.workspace.getLeavesOfType(DAILY_NOTE_VIEW_TYPE)
                        .length > 0
                )
                    return;
                await this.openDailyNoteEditor();
            }
        });

        // Also check periodically (every 15 minutes) for day changes
        this.registerInterval(
            window.setInterval(this.checkDayChange.bind(this), 1000 * 60 * 15)
        );

        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file) => {
                if (file instanceof TFolder) {
                    menu.addItem((item) => {
                        item.setIcon("calendar-range");
                        item.setTitle("Open daily notes for this folder");
                        item.onClick(() => {
                            this.openFolderView(file.path);
                        });
                    });
                }
            })
        );
    }

    onunload() {
        this.app.workspace.detachLeavesOfType(DAILY_NOTE_VIEW_TYPE);
        document.body.toggleClass("daily-notes-hide-frontmatter", false);
        document.body.toggleClass("daily-notes-hide-backlinks", false);
    }

    async openDailyNoteEditor() {
        const workspace = this.app.workspace;
        const leaf = workspace.getLeaf(true);
        await leaf.setViewState({ type: DAILY_NOTE_VIEW_TYPE });
        workspace.revealLeaf(leaf);
    }

    async openFolderView(folderPath: string, timeField: TimeField = "mtime") {
        const workspace = this.app.workspace;
        const leaf = workspace.getLeaf(true);
        await leaf.setViewState({ type: DAILY_NOTE_VIEW_TYPE });

        // Get the view and set the selection mode to folder
        const view = leaf.view as DailyNoteView;
        view.setSelectionMode("folder", folderPath);
        view.setTimeField(timeField);

        workspace.revealLeaf(leaf);
    }

    async ensureTodaysDailyNoteExists() {
        try {
            const currentDate = moment();
            const allDailyNotes = getAllDailyNotes();
            const currentDailyNote = getDailyNote(currentDate, allDailyNotes);

            if (!currentDailyNote) {
                await createDailyNote(currentDate);
            }
        } catch (error) {
            console.error("Failed to create daily note:", error);
        }
    }

    initCssRules() {
        document.body.toggleClass(
            "daily-notes-hide-frontmatter",
            this.settings.hideFrontmatter
        );
        document.body.toggleClass(
            "daily-notes-hide-backlinks",
            this.settings.hideBacklinks
        );
    }

    patchWorkspace() {
        const uninstaller = around(Workspace.prototype, {
            getActiveViewOfType: (next: any) =>
                function (t: any) {
                    const result = next.call(this, t);
                    if (!result) {
                        if (t?.VIEW_TYPE === "markdown") {
                            const activeLeaf = this.activeLeaf;
                            if (activeLeaf?.view instanceof DailyNoteView) {
                                return activeLeaf.view.editMode;
                            } else {
                                return result;
                            }
                        }
                    }
                    return result;
                },
            setActiveLeaf: (next: any) =>
                function (e: WorkspaceLeaf, t?: any) {
                    if ((e as any).parentLeaf) {
                        (e as any).parentLeaf.activeTime = Date.now();

                        next.call(this, (e as any).parentLeaf, t);
                        if ((e.view as any).editMode) {
                            // No-op on 1.14+ (setter ignores MarkdownView; the getter
                            // falls back to getActiveViewOfType); kept for older versions
                            this.activeEditor = e.view;
                            (e as any).parentLeaf.view.editMode = e.view;
                        }
                        return;
                    }
                    return next.call(this, e, t);
                },
        });
        this.register(uninstaller);
    }

    // Used for patch workspaceleaf pinned behaviors
    patchWorkspaceLeaf() {
        this.register(
            around(WorkspaceLeaf.prototype, {
                getRoot(old) {
                    return function () {
                        const top = old.call(this);
                        return top?.getRoot === this.getRoot
                            ? top
                            : top?.getRoot();
                    };
                },
                setPinned(old) {
                    return function (pinned: boolean) {
                        old.call(this, pinned);
                        if (isDailyNoteLeaf(this) && !pinned)
                            this.setPinned(true);
                    };
                },
            })
        );
    }

    public async loadSettings() {
        const data = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
        // Migrate: createAndOpenOnStartup used to also auto-create the daily note
        if (data?.autoCreateDailyNote === undefined && data?.createAndOpenOnStartup) {
            this.settings.autoCreateDailyNote = true;
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private async checkDayChange(): Promise<void> {
        const currentDay = moment().format("YYYY-MM-DD");

        if (currentDay !== this.lastCheckedDay) {
            this.lastCheckedDay = currentDay;
            console.log("Day changed, updating daily notes view");

            if (this.settings.autoCreateDailyNote) {
                await this.ensureTodaysDailyNoteExists();
            }

            const dailyNoteLeaves =
                this.app.workspace.getLeavesOfType(DAILY_NOTE_VIEW_TYPE);
            if (dailyNoteLeaves.length > 0) {
                for (const leaf of dailyNoteLeaves) {
                    const view = leaf.view as DailyNoteView;
                    if (view) {
                        view.refreshForNewDay();
                    }
                }
            }
        }
    }
}
