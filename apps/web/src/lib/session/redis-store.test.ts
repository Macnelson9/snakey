// redis-store.test.ts — runs the shared SessionStore contract against a live
// Upstash instance, but only when credentials are present. Without them the
// suite is skipped rather than failed, so CI/local runs stay green offline while
// still proving impl parity wherever Redis is reachable.
import { test } from "node:test";
import { createRedisStore } from "./redis-store.ts";
import { runStoreContract } from "./store-contract.ts";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (url && token) {
  runStoreContract("RedisStore", () => createRedisStore({ url, token }));
} else {
  test("RedisStore contract (skipped: set UPSTASH_REDIS_REST_URL/TOKEN to run)", { skip: true }, () => {});
}
