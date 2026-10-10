import "server-only";

/**
 * Server-only entry point for the scan store.
 *
 * The implementation lives in `lib/store-core.ts` with no `server-only` guard so
 * the `d0` CLI can write firewall audit events from a plain Node process. This
 * module re-exports it while keeping the React Server Component boundary
 * intact for the application, where the store must never reach the browser.
 */
export * from "@/lib/store-core";
