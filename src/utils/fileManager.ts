import { TFile, moment, App } from "obsidian";
import {
    getAllDailyNotes,
    getDailyNote,
    createDailyNote,
    getDateFromFile,
    getDailyNoteSettings,
    DEFAULT_DAILY_NOTE_FORMAT,
} from "obsidian-daily-notes-interface";
import { TimeRange, TimeField } from "../types/time";

export interface FileManagerOptions {
    mode: "daily" | "folder" | "tag";
    target?: string;
    timeRange?: TimeRange;
    customRange?: { start: Date; end: Date } | null;
    app?: App;
    timeField?: TimeField;
}

export class FileManager {
    private allFiles: TFile[] = [];
    private filteredFiles: TFile[] = [];
    private hasFetched: boolean = false;
    private hasCurrentDay: boolean = true;
    private cacheDailyNotes: Record<string, any> = {};

    // Make options public so it can be accessed from outside
    public options: FileManagerOptions;

    constructor(options: FileManagerOptions) {
        this.options = options;
        this.fetchFiles();
    }

    /**
     * Helper method to parse time field and check if it's reverse
     * @param timeField The time field to parse
     * @returns An object containing isReverse flag and baseTimeField
     */
    private parseTimeField(timeField: TimeField | undefined): {
        isReverse: boolean;
        baseTimeField: string;
    } {
        const field = timeField || "mtime";
        const isReverse = field.endsWith("Reverse");
        const baseTimeField = isReverse ? field.replace("Reverse", "") : field;
        return { isReverse, baseTimeField };
    }

    /**
     * Helper method to sort files by time field
     * @param files The files to sort
     * @param timeField The time field to sort by
     * @returns Sorted files
     */
    private sortFilesByTimeField(
        files: TFile[],
        timeField?: TimeField
    ): TFile[] {
        const { isReverse, baseTimeField } = this.parseTimeField(timeField);

        return [...files].sort((a, b) => {
            // Handle name-based sorting
            if (baseTimeField === "name") {
                // For name sorting, we sort alphabetically by filename
                if (isReverse) {
                    return b.name.localeCompare(a.name);
                }
                return a.name.localeCompare(b.name);
            }

            // Handle time-based sorting (existing functionality)
            if (isReverse) {
                return a.stat[baseTimeField] - b.stat[baseTimeField];
            }
            return b.stat[baseTimeField] - a.stat[baseTimeField];
        });
    }

    public fetchFiles(): void {
        if (this.hasFetched) return;

        switch (this.options.mode) {
            case "daily":
                this.fetchDailyNotes();
                break;
            case "folder":
                this.fetchFolderFiles();
                break;
            case "tag":
                this.fetchTaggedFiles();
                break;
        }

        this.hasFetched = true;
        this.checkDailyNote();
        this.filterFilesByRange();
    }

    private fetchDailyNotes(): void {
        this.cacheDailyNotes = getAllDailyNotes();
        this.allFiles = this.sortDailyNotes(
            Object.values(this.cacheDailyNotes) as TFile[]
        );
    }

    /**
     * Canonical order for daily notes, shared by fetch and insertion paths:
     * name fields sort by filename; everything else sorts by the date in the
     * filename (newest first), matching the date-keyed daily notes cache.
     */
    private sortDailyNotes(notes: TFile[]): TFile[] {
        const { baseTimeField } = this.parseTimeField(this.options.timeField);
        if (baseTimeField === "name") {
            return this.sortFilesByTimeField(notes, this.options.timeField);
        }
        return [...notes].sort(
            (a, b) =>
                (getDateFromFile(b as any, "day")?.valueOf() ?? 0) -
                (getDateFromFile(a as any, "day")?.valueOf() ?? 0)
        );
    }

    private fetchFolderFiles(): void {
        if (!this.options.target || !this.options.app) return;

        // Get all files in the vault
        const allFiles = this.options.app.vault.getMarkdownFiles();

        // Filter files by folder path
        this.allFiles = allFiles.filter((file) => {
            const folderPath = file.parent?.path || "";
            return (
                folderPath === this.options.target ||
                folderPath.startsWith(this.options.target + "/")
            );
        });

        // Sort files by the specified time field
        this.allFiles = this.sortFilesByTimeField(
            this.allFiles,
            this.options.timeField
        );
    }

    private fetchTaggedFiles(): void {
        if (!this.options.target || !this.options.app) return;

        // Get all files with the specified tag
        const allFiles = this.options.app.vault.getMarkdownFiles();
        const targetTag = this.options.target.startsWith("#")
            ? this.options.target
            : "#" + this.options.target;
        const targetTagWithoutHash = this.options.target.replace(/^#/, '');

        this.allFiles = allFiles.filter((file) => {
            // Check if the file has the target tag in its cache
            const fileCache =
                this.options.app?.metadataCache.getFileCache(file);
            if (!fileCache) return false;

            const hasFrontmatterTag = Array.isArray(fileCache?.frontmatter?.tags)
                ? fileCache?.frontmatter?.tags.includes(targetTagWithoutHash)
                : false;

            const hasInlineTag = fileCache?.tags?.some((tag) => tag.tag === targetTag);
            return hasFrontmatterTag || hasInlineTag;
        });

        // Sort files by the specified time field
        this.allFiles = this.sortFilesByTimeField(
            this.allFiles,
            this.options.timeField
        );
    }

    public filterFilesByRange(): TFile[] {
        // No time range or "all" means no filtering
        if (!this.options.timeRange || this.options.timeRange === "all") {
            this.filteredFiles = [...this.allFiles];
            return this.filteredFiles;
        }

        // Reset the filtered files list
        this.filteredFiles = [];

        // Use different filtering methods based on different modes
        if (this.options.mode === "daily") {
            // Daily mode: filter daily notes by date
            this.filterDailyNotesByRange();
        } else {
            // Folder and tag modes: filter files by creation or modification time
            this.filterFilesByTimeRange();
        }

        return this.filteredFiles;
    }

    /**
     * Filter files by time range
     * Applicable to folder and tag modes
     */
    private filterFilesByTimeRange(): void {
        const now = moment();
        const { isReverse, baseTimeField } = this.parseTimeField(
            this.options.timeField
        );

        // Filter files by creation or modification time
        this.filteredFiles = this.allFiles.filter((file) => {
            // Get the time of the file based on the base timeField option
            const fileDate = moment(file.stat[baseTimeField]);

            return this.isDateInRange(fileDate, now);
        });

        // If using reverse time field, reverse the order of filtered files
        if (isReverse) {
            this.filteredFiles.reverse();
        }
    }

    /**
     * Filter daily notes by date
     * Applicable to daily mode
     */
    private filterDailyNotesByRange(): void {
        const now = moment();
        const fileFormat =
            getDailyNoteSettings().format || DEFAULT_DAILY_NOTE_FORMAT;

        this.filteredFiles = this.allFiles.filter((file) => {
            const fileDate = moment(file.basename, fileFormat);

            return this.isDateInRange(fileDate, now);
        });
    }

    /**
     * Check if the file date is in the range
     * @param fileDate file date
     * @param now current date
     * @returns whether in the range
     */
    private isDateInRange(
        fileDate: moment.Moment,
        now: moment.Moment
    ): boolean {
        switch (this.options.timeRange) {
            case "week":
                return fileDate.isSame(now, "week");
            case "month":
                return fileDate.isSame(now, "month");
            case "year":
                return fileDate.isSame(now, "year");
            case "last-week":
                return fileDate.isBetween(
                    moment().subtract(1, "week").startOf("week"),
                    moment().subtract(1, "week").endOf("week"),
                    null,
                    "[]"
                );
            case "last-month":
                return fileDate.isBetween(
                    moment().subtract(1, "month").startOf("month"),
                    moment().subtract(1, "month").endOf("month"),
                    null,
                    "[]"
                );
            case "last-year":
                return fileDate.isBetween(
                    moment().subtract(1, "year").startOf("year"),
                    moment().subtract(1, "year").endOf("year"),
                    null,
                    "[]"
                );
            case "quarter":
                return fileDate.isSame(now, "quarter");
            case "last-quarter":
                return fileDate.isBetween(
                    moment().subtract(1, "quarter").startOf("quarter"),
                    moment().subtract(1, "quarter").endOf("quarter"),
                    null,
                    "[]"
                );
            case "custom":
                if (this.options.customRange) {
                    const startDate = moment(this.options.customRange.start);
                    const endDate = moment(this.options.customRange.end);
                    return fileDate.isBetween(startDate, endDate, null, "[]");
                }
                return false;
            default:
                return true;
        }
    }

    public checkDailyNote(): boolean {
        if (this.options.mode !== "daily") {
            this.hasCurrentDay = true;
            return true;
        }

        // Refresh the daily notes cache to ensure we have the latest data
        this.cacheDailyNotes = getAllDailyNotes();

        // @ts-ignore
        const currentDate = moment();
        const currentDailyNote = getDailyNote(
            currentDate,
            this.cacheDailyNotes
        );

        if (!currentDailyNote) {
            this.hasCurrentDay = false;
            return false;
        }

        // Check if we need to update the allFiles and filteredFiles arrays
        if (this.hasCurrentDay === false) {
            // We didn't have the current day's note before, but now we do
            // So we need to update our file lists
            this.allFiles = [];
            this.fetchDailyNotes();
            this.filterFilesByRange();
        }

        this.hasCurrentDay = true;
        return true;
    }

    public async createNewDailyNote(): Promise<TFile | null> {
        if (this.options.mode !== "daily" || this.hasCurrentDay) {
            return null;
        }

        const currentDate = moment();
        const currentDailyNote: any = await createDailyNote(currentDate);

        if (currentDailyNote) {
            this.allFiles.push(currentDailyNote);
            this.allFiles = this.sortDailyNotes(this.allFiles);
            this.hasCurrentDay = true;
            this.filterFilesByRange();
            return currentDailyNote;
        }

        return null;
    }

    public fileCreate(file: TFile): void {
        if (this.options.mode === "daily") {
            this.handleDailyNoteCreate(file);
        } else if (this.options.mode === "folder") {
            this.handleFolderFileCreate(file);
        } else if (this.options.mode === "tag") {
            this.handleTaggedFileCreate(file);
        }
    }

    private handleDailyNoteCreate(file: TFile): void {
        const fileDate = getDateFromFile(file as any, "day");
        const fileFormat =
            getDailyNoteSettings().format || DEFAULT_DAILY_NOTE_FORMAT;
        if (!fileDate) return;

        if (this.filteredFiles.length === 0) {
            this.allFiles.push(file);
            this.allFiles = this.sortDailyNotes(this.allFiles);
            this.filterFilesByRange();
            return;
        }

        const lastFilteredFile =
            this.filteredFiles[this.filteredFiles.length - 1];
        const firstFilteredFile = this.filteredFiles[0];
        const lastFilteredFileDate = moment(
            lastFilteredFile.basename,
            fileFormat
        );
        const firstFilteredFileDate = moment(
            firstFilteredFile.basename,
            fileFormat
        );

        if (fileDate.isBetween(lastFilteredFileDate, firstFilteredFileDate)) {
            this.filteredFiles.push(file);
            this.filteredFiles = this.sortDailyNotes(this.filteredFiles);
        } else if (fileDate.isBefore(lastFilteredFileDate)) {
            this.allFiles.push(file);
            this.allFiles = this.sortDailyNotes(this.allFiles);
            this.filterFilesByRange();
        } else if (fileDate.isAfter(firstFilteredFileDate)) {
            this.filteredFiles.push(file);
            this.filteredFiles = this.sortDailyNotes(this.filteredFiles);
        }

        if (fileDate.isSame(moment(), "day")) this.hasCurrentDay = true;
    }

    private handleFolderFileCreate(file: TFile): void {
        if (!this.options.target) return;

        // Check if the file belongs to the target folder
        const folderPath = file.parent?.path || "";
        if (
            folderPath === this.options.target ||
            folderPath.startsWith(this.options.target + "/")
        ) {
            // Add the file to the collections
            this.allFiles.push(file);

            // Sort files by the specified time field
            this.allFiles = this.sortFilesByTimeField(
                this.allFiles,
                this.options.timeField
            );

            // Update filtered files
            this.filterFilesByRange();
        }
    }

    private handleTaggedFileCreate(file: TFile): void {
        if (!this.options.target || !this.options.app) return;

        // Check if the file has the target tag
        const targetTag = this.options.target.startsWith("#")
            ? this.options.target
            : "#" + this.options.target;

        const fileCache = this.options.app.metadataCache.getFileCache(file);
        if (!fileCache || !fileCache.tags) return;

        if (fileCache.tags.some((tag) => tag.tag === targetTag)) {
            // Add the file to the collections
            this.allFiles.push(file);

            // Sort files by the specified time field
            this.allFiles = this.sortFilesByTimeField(
                this.allFiles,
                this.options.timeField
            );

            // Update filtered files
            this.filterFilesByRange();
        }
    }

    public fileDelete(file: TFile): void {
        this.filteredFiles = this.filteredFiles.filter(
            (f) => f.path !== file.path
        );
        this.allFiles = this.allFiles.filter((f) => f.path !== file.path);

        if (
            this.options.mode === "daily" &&
            getDateFromFile(file as any, "day")
        ) {
            this.filterFilesByRange();
            this.checkDailyNote();
        }
    }

    public getFilteredFiles(): TFile[] {
        // Return a copy: callers drain their list with splice() while lazily
        // rendering, which must not mutate the manager's internal state
        return [...this.filteredFiles];
    }

    public hasCurrentDayNote(): boolean {
        return this.hasCurrentDay;
    }

    public updateOptions(options: Partial<FileManagerOptions>): void {
        this.options = { ...this.options, ...options };

        if (options.timeRange || options.customRange) {
            this.filterFilesByRange();
        }

        if (options.mode || options.target) {
            this.allFiles = [];
            this.filteredFiles = [];
            this.hasFetched = false;
            this.fetchFiles();
        }
    }
}
