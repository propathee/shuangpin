/// <reference types="vitest" />

import { defineConfig } from "vite";
import Vue from "@vitejs/plugin-vue";

export default defineConfig({
  base: "/shuangpin/",
  plugins: [Vue()],
  test: {
    globals: true,
    environment: "jsdom",
  },
});
