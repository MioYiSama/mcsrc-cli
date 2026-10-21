#!/usr/bin/env node
import './build.mjs';
// The generated entry point does not exist until the build above finishes.
await import('./dist/main.js');
