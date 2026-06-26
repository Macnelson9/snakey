// memory-store.test.ts — runs the shared SessionStore contract against the
// in-memory implementation used for local dev and tests.
import { createMemoryStore } from "./memory-store.ts";
import { runStoreContract } from "./store-contract.ts";

runStoreContract("MemoryStore", () => createMemoryStore());
