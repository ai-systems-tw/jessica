/* Server-only pg.Pool provider. Pool construction, credentials, and shutdown remain application-owned. */
import type { Pool, PoolClient, QueryResult, TransactionStatus } from "pg";

import { NonProxyQaDatabasePortError } from "./nonProxyQaPersistenceWriter.js";
import type {
  NonProxyQaPinnedSession,
  NonProxyQaPinnedSessionLease,
  NonProxyQaPinnedSessionProvider,
} from "./nonProxyQaPgliteWriterDatabase.js";

type NormalizedResult = { rows: unknown[]; affectedRows?: number };
type LeaseState = "checked-out" | "destroying" | "destroyed" | "released";

function failure(): NonProxyQaDatabasePortError {
  return new NonProxyQaDatabasePortError("database");
}

function normalizeResult(result: QueryResult): NormalizedResult {
  if (typeof result !== "object" || result === null || Array.isArray(result) || !Array.isArray(result.rows)) throw failure();
  if (result.rowCount !== null && (!Number.isSafeInteger(result.rowCount) || result.rowCount < 0)) throw failure();
  return result.rowCount === null ? { rows: result.rows } : { rows: result.rows, affectedRows: result.rowCount };
}

function transactionStatus(client: PoolClient): TransactionStatus {
  const status = client.getTransactionStatus();
  if (status !== null && status !== "I" && status !== "T" && status !== "E") throw failure();
  return status;
}

function assertIdle(client: PoolClient): void {
  const status = transactionStatus(client);
  // pool.connect() resolves only after PostgreSQL's ReadyForQuery. `null` is
  // the pre-query/unknown state and is not sufficient proof for repooling.
  if (status !== "I") throw failure();
}

/**
 * Exclusively checks one physical pg.Pool client out for each callback.
 *
 * The provider deliberately owns transaction boundaries instead of using
 * pool.query(): node-postgres transactions are scoped to one client. Any
 * unknown BEGIN/COMMIT/ROLLBACK boundary, unfinished query, unsafe transaction
 * status, or failed check-in destroys that physical client with release(true).
 * Destruction does not complete until the pool emits `remove` for that client.
 */
export function createPgPoolPinnedSessionProvider(pool: Pool): NonProxyQaPinnedSessionProvider {
  if (typeof pool !== "object" || pool === null || typeof pool.connect !== "function" || typeof pool.on !== "function" || typeof pool.removeListener !== "function") throw new TypeError("a pg.Pool is required");

  return Object.freeze({
    async withPinnedSession<T>(callback: (lease: NonProxyQaPinnedSessionLease) => Promise<T>): Promise<T> {
      if (typeof callback !== "function") throw new TypeError("a pinned-session callback is required");
      const client = await pool.connect();
      if (typeof client !== "object" || client === null || typeof client.query !== "function" || typeof client.release !== "function" || typeof client.getTransactionStatus !== "function") throw failure();

      let state: LeaseState = "checked-out";
      let callbackOpen = true;
      let queriesInFlight = 0;
      let transactionActive = false;
      let protocolViolation = false;
      let destruction: Promise<void> | null = null;

      const discard = (): Promise<void> => {
        if (destruction) return destruction;
        if (state === "released") return Promise.reject(failure());
        state = "destroying";
        destruction = new Promise<void>((resolve, reject) => {
          let settled = false;
          const cleanup = () => pool.removeListener("remove", removed);
          const removed = (removedClient: PoolClient) => {
            if (removedClient !== client || settled) return;
            settled = true;
            cleanup();
            state = "destroyed";
            resolve();
          };
          pool.on("remove", removed);
          try {
            client.release(true);
          } catch (error) {
            if (!settled) {
              settled = true;
              cleanup();
              reject(error);
            }
          }
        });
        return destruction;
      };

      const driverQuery = (sql: string, parameters: unknown[] = []): Promise<NormalizedResult> => {
        if (!callbackOpen || state !== "checked-out" || typeof sql !== "string" || !Array.isArray(parameters)) return Promise.reject(failure());
        if (queriesInFlight !== 0) {
          protocolViolation = true;
          return Promise.reject(failure());
        }
        queriesInFlight += 1;
        let pending: Promise<QueryResult>;
        try {
          pending = client.query(sql, parameters);
        } catch (error) {
          queriesInFlight -= 1;
          return Promise.reject(error);
        }
        return Promise.resolve(pending).then(normalizeResult).finally(() => { queriesInFlight -= 1; });
      };

      const query = (sql: string, parameters: unknown[] = []): Promise<NormalizedResult> => driverQuery(sql, parameters).then((result) => {
        try {
          const expected: TransactionStatus = transactionActive ? "T" : "I";
          if (transactionStatus(client) !== expected) {
            protocolViolation = true;
            throw failure();
          }
        } catch (error) {
          protocolViolation = true;
          throw error;
        }
        return result;
      });

      const session: NonProxyQaPinnedSession = Object.freeze({
        query,
        async transaction<R>(work: (transaction: { query: typeof query }) => Promise<R>): Promise<R> {
          if (!callbackOpen || state !== "checked-out" || typeof work !== "function") throw failure();
          if (transactionActive) {
            protocolViolation = true;
            throw failure();
          }
          try { assertIdle(client); } catch (error) { protocolViolation = true; throw error; }
          transactionActive = true;
          try {
            try {
              await driverQuery("BEGIN");
              if (transactionStatus(client) !== "T") throw failure();
            } catch (error) {
              await discard().catch(() => {});
              throw error;
            }

            let result!: R;
            let callbackErrorPresent = false;
            let callbackError: unknown;
            try {
              result = await work(Object.freeze({ query }));
            } catch (error) {
              callbackErrorPresent = true;
              callbackError = error;
            }

            if (queriesInFlight !== 0 || state !== "checked-out") {
              await discard().catch(() => {});
              throw failure();
            }

            if (callbackErrorPresent) {
              try {
                const status = transactionStatus(client);
                if (status !== "T" && status !== "E") throw failure();
                await driverQuery("ROLLBACK");
                if (transactionStatus(client) !== "I") throw failure();
              } catch (rollbackError) {
                await discard().catch(() => {});
                throw rollbackError;
              }
              throw callbackError;
            }

            try {
              if (transactionStatus(client) !== "T") throw failure();
              await driverQuery("COMMIT");
              if (transactionStatus(client) !== "I") throw failure();
            } catch (error) {
              await discard().catch(() => {});
              throw error;
            }
            return result;
          } finally {
            transactionActive = false;
          }
        },
      });

      const lease = Object.freeze({ session, discard });
      try {
        // node-postgres reports `null` for a newly connected client until its
        // first ReadyForQuery message has been observed through query().  Use
        // a provider-owned no-op round trip to turn that unknown initial state
        // into an explicit idle acknowledgement before application work.
        if (transactionStatus(client) === null) await query("select 1 as jessica_pg_pool_session_ready");
        assertIdle(client);
      } catch {
        callbackOpen = false;
        await discard().catch(() => {});
        throw failure();
      }
      let result!: T;
      let callbackErrorPresent = false;
      let callbackError: unknown;
      try {
        result = await callback(lease);
      } catch (error) {
        callbackErrorPresent = true;
        callbackError = error;
      }
      callbackOpen = false;

      if (destruction) {
        let destructionErrorPresent = false;
        let destructionError: unknown;
        try { await destruction; } catch (error) { destructionErrorPresent = true; destructionError = error; }
        if (destructionErrorPresent) throw destructionError;
        if (callbackErrorPresent) throw callbackError;
        throw failure();
      }

      let unsafe = protocolViolation || queriesInFlight !== 0 || transactionActive;
      if (!unsafe) {
        try { assertIdle(client); } catch { unsafe = true; }
      }
      if (unsafe) {
        let destructionErrorPresent = false;
        let destructionError: unknown;
        try { await discard(); } catch (error) { destructionErrorPresent = true; destructionError = error; }
        if (destructionErrorPresent) throw destructionError;
        throw failure();
      }

      try {
        client.release();
        state = "released";
      } catch (releaseError) {
        let destructionErrorPresent = false;
        let destructionError: unknown;
        try { await discard(); } catch (error) { destructionErrorPresent = true; destructionError = error; }
        if (destructionErrorPresent) throw destructionError;
        throw releaseError;
      }

      if (callbackErrorPresent) throw callbackError;
      return result;
    },
  });
}
