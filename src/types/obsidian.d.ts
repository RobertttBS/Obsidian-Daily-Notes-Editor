import "obsidian";

declare global {
    interface Window {
        activeWindow: Window;
        activeDocument: Document;
    }
}

declare module "obsidian" {
    interface WorkspaceParent {
        replaceChild(
            index: number,
            child: WorkspaceItem,
            resize?: boolean
        ): void;

        containerEl: HTMLElement;
    }

    interface WorkspaceLeaf {
        containerEl: HTMLDivElement;
        parentLeaf: WorkspaceLeaf;

        height: number;
    }

    interface Workspace {
        iterateLeaves(
            callback: (item: WorkspaceLeaf) => boolean | void,
            item: WorkspaceItem | WorkspaceItem[]
        ): boolean;

        iterateLeaves(
            item: WorkspaceItem | WorkspaceItem[],
            callback: (item: WorkspaceLeaf) => boolean | void
        ): boolean;

        onLayoutChange(): void; // tell Obsidian leaves have been added/removed/etc.

        floatingSplit: any;
    }

    interface View {
        contentEl: HTMLElement;
        titleEl: HTMLElement;
    }

    enum PopoverState {
        Showing,
        Shown,
        Hiding,
        Hidden,
    }

    interface HoverPopover {
        parent: any;
        targetEl: HTMLElement;
        hoverEl: HTMLElement;

        hide(): void;

        show(): void;

        shouldShowSelf(): boolean;

        timer: number;
        waitTime: number;

        shouldShow(): boolean;

        transition(): void;
    }
}
