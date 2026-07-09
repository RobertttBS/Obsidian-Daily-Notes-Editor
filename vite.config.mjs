import path from 'path';
import {defineConfig} from 'vite';
import {svelte} from '@sveltejs/vite-plugin-svelte';
import autoPreprocess from 'svelte-preprocess';

export default defineConfig(({mode}) => {
    const isDev = mode === 'development';
    return {
        plugins: [
            svelte({
                preprocess: autoPreprocess()
            })
        ],
        define: {'process.env.NODE_ENV': JSON.stringify(mode)},
        esbuild: isDev ? {} : {
            // Strip noisy logs in production but keep console.error/warn
            // so real failures remain diagnosable in the devtools console
            pure: ['console.log', 'console.info', 'console.debug'],
            drop: ['debugger'],
        },
        build: {
            sourcemap: mode === 'development' ? 'inline' : false,
            minify: mode !== 'development',
            // Use Vite lib mode https://vitejs.dev/guide/build.html#library-mode
            lib: {
                entry: path.resolve(__dirname, './src/dailyNoteViewIndex.ts'),
                formats: ['cjs'],
            },
            rollupOptions: {
                output: {
                    // Overwrite default Vite output fileName
                    entryFileNames: 'main.js',
                    assetFileNames: 'styles.css',
                },
                external: [
                    'obsidian',
                    'electron',
                    '@codemirror/autocomplete',
                    '@codemirror/collab',
                    '@codemirror/commands',
                    '@codemirror/language',
                    '@codemirror/lint',
                    '@codemirror/search',
                    '@codemirror/state',
                    '@codemirror/view',
                    '@lezer/common',
                    '@lezer/highlight',
                    '@lezer/lr',
                ],
            },
            // Use root as the output dir
            emptyOutDir: false,
            outDir: 'dist',
        },
    };
});
