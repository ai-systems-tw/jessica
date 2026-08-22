import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { Pool } from "pg";

import { createPgPoolPinnedSessionProvider, NonProxyQaDatabasePortError } from "../dist/packages/asset-review/src/index.js";

class FakeResult {
  constructor(rows = [], rowCount = rows.length) {
    this.command = "SELECT";
    this.rowCount = rowCount;
    this.oid = 0;
    this.fields = [];
    this.rows = rows;
  }
}

class FakePool extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.clients = [];
    this.connects = 0;
  }

  async connect() {
    this.connects += 1;
    if (this.options.connectErrorPresent) throw this.options.connectError;
    const client = new FakeClient(this, this.options);
    this.clients.push(client);
    return client;
  }
}

class FakeClient {
  constructor(pool, options) {
    this.pool = pool;
    this.options = options;
    this.status = Object.hasOwn(options, "initialStatus") ? options.initialStatus : "I";
    this.queries = [];
    this.releases = [];
  }

  getTransactionStatus() {
    if (this.options.statusErrorPresent) throw this.options.statusError;
    return this.status;
  }

  query(sql, parameters = []) {
    this.queries.push({ sql, parameters });
    if (this.options.deferredSql === sql) return this.options.deferred.promise;
    if (this.options.failureSql === sql) {
      if (sql === "BEGIN") this.status = "I";
      if (sql === "COMMIT") this.status = "T";
      if (sql === "ROLLBACK") this.status = "E";
      if (sql !== "BEGIN" && sql !== "COMMIT" && sql !== "ROLLBACK" && this.status === "T") this.status = "E";
      return Promise.reject(this.options.queryError);
    }
    if (sql === "BEGIN") this.status = "T";
    if (sql === "COMMIT" || sql === "ROLLBACK") this.status = "I";
    if (this.status === null && !this.options.stickyNullStatus) this.status = "I";
    if (this.options.resultForSql?.has(sql)) return Promise.resolve(this.options.resultForSql.get(sql));
    return Promise.resolve(new FakeResult([], 0));
  }

  release(destroy = false) {
    this.releases.push(destroy);
    if (!destroy && this.options.releaseErrorPresent) throw this.options.releaseError;
    if (destroy && this.options.destroyErrorPresent) throw this.options.destroyError;
    if (destroy && !this.options.manualRemove) queueMicrotask(() => this.pool.emit("remove", this));
  }
}

class InMemoryPgClient extends EventEmitter {
  constructor() {
    super();
    this._queryable = true;
    this._ending = false;
  }

  connect(callback) {
    queueMicrotask(() => callback());
  }

  end(callback) {
    this._ending = true;
    callback?.();
  }

  ref() {}

  unref() {}
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function rejection(promise) {
  let present = false;
  let reason;
  await promise.then(
    () => assert.fail("expected rejection"),
    (error) => { present = true; reason = error; },
  );
  assert.equal(present, true);
  return reason;
}

test("pg.Pool provider pins every query and transaction boundary to one physical client", async () => {
  const results = new Map([["select $1::int as value", new FakeResult([{ value: 7 }], 1)]]);
  const pool = new FakePool({ resultForSql: results });
  const provider = createPgPoolPinnedSessionProvider(pool);
  const value = await provider.withPinnedSession(async (lease) => {
    assert.equal(Object.isFrozen(lease), true);
    assert.equal(Object.isFrozen(lease.session), true);
    const outside = await lease.session.query("select $1::int as value", [7]);
    assert.deepEqual(outside, { rows: [{ value: 7 }], affectedRows: 1 });
    assert.equal(Object.getPrototypeOf(outside), Object.prototype, "driver Result instances are normalized");
    return lease.session.transaction(async (transaction) => {
      assert.equal(transaction.query, lease.session.query);
      await transaction.query("set local application_name = 'jessica-test'");
      return "committed";
    });
  });
  assert.equal(value, "committed");
  assert.equal(pool.connects, 1);
  assert.deepEqual(pool.clients[0].queries.map(({ sql }) => sql), [
    "select $1::int as value", "BEGIN", "set local application_name = 'jessica-test'", "COMMIT",
  ]);
  assert.deepEqual(pool.clients[0].releases, [false]);
});

test("confirmed rollback and idle callback rejection preserve even an undefined reason and safely check in", async () => {
  for (const mode of ["transaction", "callback"]) {
    const pool = new FakePool();
    const provider = createPgPoolPinnedSessionProvider(pool);
    const reason = await rejection(provider.withPinnedSession(async (lease) => {
      if (mode === "transaction") return lease.session.transaction(async () => Promise.reject());
      return Promise.reject();
    }));
    assert.equal(reason, undefined, mode);
    assert.deepEqual(pool.clients[0].queries.map(({ sql }) => sql), mode === "transaction" ? ["BEGIN", "ROLLBACK"] : []);
    assert.deepEqual(pool.clients[0].releases, [false]);
  }
});

test("unknown BEGIN, COMMIT, or ROLLBACK acknowledgement destroys and removes the physical client", async () => {
  for (const boundary of ["BEGIN", "COMMIT", "ROLLBACK"]) {
    const pool = new FakePool({ failureSql: boundary, queryError: undefined });
    const provider = createPgPoolPinnedSessionProvider(pool);
    const reason = await rejection(provider.withPinnedSession((lease) => lease.session.transaction(async () => {
      if (boundary === "ROLLBACK") return Promise.reject(new Error("callback failure"));
      return "value";
    })));
    assert.equal(reason, undefined, boundary);
    assert.deepEqual(pool.clients[0].releases, [true], boundary);
    assert.equal(pool.listenerCount("remove"), 0, boundary);
    await provider.withPinnedSession(async () => "fresh");
    assert.equal(pool.clients.length, 2, boundary);
    assert.deepEqual(pool.clients[1].releases, [false], boundary);
  }
});

test("discard is idempotent, waits for the exact pool remove event, and cannot forge success", async () => {
  const pool = new FakePool({ manualRemove: true });
  const provider = createPgPoolPinnedSessionProvider(pool);
  let discardOne;
  let discardTwo;
  let settled = false;
  const operation = provider.withPinnedSession(async (lease) => {
    discardOne = lease.discard();
    discardTwo = lease.discard();
    assert.equal(discardOne, discardTwo);
    return "must-not-succeed";
  });
  operation.finally(() => { settled = true; }).catch(() => {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(pool.clients[0].releases, [true]);
  pool.emit("remove", {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "a remove event for another client cannot release the lease");
  pool.emit("remove", pool.clients[0]);
  await Promise.all([discardOne, discardTwo]);
  const reason = await rejection(operation);
  assert.equal(reason instanceof NonProxyQaDatabasePortError, true);
  assert.equal(reason.kind, "database");
  assert.equal(pool.listenerCount("remove"), 0);
});

test("failed check-in is not retried through pg-pool's consumed one-shot release", async () => {
  const pool = new FakePool({ releaseErrorPresent: true, releaseError: undefined });
  const provider = createPgPoolPinnedSessionProvider(pool);
  assert.equal(await rejection(provider.withPinnedSession(async () => "must-not-succeed")), undefined);
  assert.deepEqual(pool.clients[0].releases, [false]);
  assert.equal(pool.listenerCount("remove"), 0);
});

test("pg-pool consumes release before a throwing release listener and cannot recover publicly", async () => {
  const marker = new Error("application release listener failed");
  const pool = new Pool({ Client: InMemoryPgClient, max: 1, connectionTimeoutMillis: 10, idleTimeoutMillis: 0 });
  const client = await pool.connect();
  pool.on("release", () => { throw marker; });

  assert.throws(() => client.release(), (error) => error === marker);
  assert.throws(() => client.release(true), /already been released/);
  assert.equal(pool.totalCount, 1, "the consumed checkout remains in pg-pool's client set");
  assert.equal(pool.idleCount, 0, "the consumed checkout was not safely checked in");
  const keepEventLoopAlive = setTimeout(() => {}, 100);
  try { await assert.rejects(pool.connect(), /timeout exceeded when trying to connect/); }
  finally { clearTimeout(keepEventLoopAlive); }
});

test("an actual pg.Pool with pre-existing release or remove listeners is rejected before checkout", async () => {
  for (const eventName of ["release", "remove"]) {
    const pool = new Pool({ max: 1, connectionTimeoutMillis: 25 });
    pool.on(eventName, () => { throw new Error(`${eventName} listener must never run`); });
    assert.throws(
      () => createPgPoolPinnedSessionProvider(pool),
      /must be dedicated/,
      eventName,
    );
    assert.equal(pool.totalCount, 0, eventName);
    assert.equal(pool.idleCount, 0, eventName);
    assert.equal(pool.waitingCount, 0, eventName);
    await pool.end();
  }
});

test("a dedicated actual pg.Pool reserves release and remove events after provider creation", async () => {
  const pool = new Pool({ max: 1, connectionTimeoutMillis: 25 });
  createPgPoolPinnedSessionProvider(pool);
  assert.throws(() => createPgPoolPinnedSessionProvider(pool), /already claimed/);
  for (const eventName of ["release", "remove"]) {
    for (const method of ["on", "once", "prependListener"]) {
      assert.throws(
        () => pool[method](eventName, () => { throw new Error("must never be installed"); }),
        /listeners are reserved/,
        `${method}:${eventName}`,
      );
    }
    assert.equal(pool.listenerCount(eventName), 0, eventName);
  }
  assert.equal(pool.totalCount, 0);
  assert.equal(pool.idleCount, 0);
  assert.equal(pool.waitingCount, 0);
  await pool.end();
});

test("failed destructive release remains quarantined and never falls through to normal check-in", async () => {
  const marker = new Error("destroy failed");
  const pool = new FakePool({ destroyErrorPresent: true, destroyError: marker });
  const provider = createPgPoolPinnedSessionProvider(pool);
  const reason = await rejection(provider.withPinnedSession(async (lease) => {
    await lease.discard();
    return "unreachable";
  }));
  assert.equal(reason, marker);
  assert.deepEqual(pool.clients[0].releases, [true]);
  assert.equal(pool.listenerCount("remove"), 0);
});

test("non-idle state and an unawaited query destroy instead of repooling", async () => {
  {
    const pool = new FakePool();
    const provider = createPgPoolPinnedSessionProvider(pool);
    const reason = await rejection(provider.withPinnedSession(async (lease) => {
      await lease.session.query("BEGIN");
      return "unsafe";
    }));
    assert.equal(reason instanceof NonProxyQaDatabasePortError, true);
    assert.deepEqual(pool.clients[0].releases, [true]);
  }
  {
    const pending = deferred();
    const pool = new FakePool({ deferredSql: "select pg_sleep(10)", deferred: pending });
    const provider = createPgPoolPinnedSessionProvider(pool);
    let queryPromise;
    const operation = provider.withPinnedSession(async (lease) => {
      queryPromise = lease.session.query("select pg_sleep(10)");
      return "unsafe";
    });
    const reason = await rejection(operation);
    assert.equal(reason instanceof NonProxyQaDatabasePortError, true);
    assert.deepEqual(pool.clients[0].releases, [true]);
    pending.resolve(new FakeResult([], 0));
    await queryPromise;
  }
});

test("concurrent queries or transactions mark the lease unsafe even when the caller catches the local error", async () => {
  {
    const pending = deferred();
    const pool = new FakePool({ deferredSql: "select slow", deferred: pending });
    const provider = createPgPoolPinnedSessionProvider(pool);
    const operation = provider.withPinnedSession(async (lease) => {
      const first = lease.session.query("select slow");
      const concurrent = await rejection(lease.session.query("select concurrent"));
      assert.equal(concurrent instanceof NonProxyQaDatabasePortError, true);
      pending.resolve(new FakeResult([], 0));
      await first;
      return "caught-but-unsafe";
    });
    const reason = await rejection(operation);
    assert.equal(reason instanceof NonProxyQaDatabasePortError, true);
    assert.deepEqual(pool.clients[0].releases, [true]);
  }
  {
    const gate = deferred();
    const pool = new FakePool();
    const provider = createPgPoolPinnedSessionProvider(pool);
    const operation = provider.withPinnedSession(async (lease) => {
      const first = lease.session.transaction(async () => {
        await gate.promise;
        return "first";
      });
      await new Promise((resolve) => setImmediate(resolve));
      const concurrent = await rejection(lease.session.transaction(async () => "second"));
      assert.equal(concurrent instanceof NonProxyQaDatabasePortError, true);
      gate.resolve();
      assert.equal(await first, "first");
      return "caught-but-unsafe";
    });
    const reason = await rejection(operation);
    assert.equal(reason instanceof NonProxyQaDatabasePortError, true);
    assert.deepEqual(pool.clients[0].queries.map(({ sql }) => sql), ["BEGIN", "COMMIT"]);
    assert.deepEqual(pool.clients[0].releases, [true]);
  }
});

test("raw transaction control and a caught SQL error cannot bypass provider-owned boundaries", async () => {
  for (const mode of ["outside-begin", "inside-commit", "caught-sql-error"]) {
    const pool = new FakePool(mode === "caught-sql-error" ? { failureSql: "select broken", queryError: new Error("statement failed") } : {});
    const provider = createPgPoolPinnedSessionProvider(pool);
    const operation = provider.withPinnedSession(async (lease) => {
      if (mode === "outside-begin") {
        await rejection(lease.session.query("BEGIN"));
        return "caught-but-unsafe";
      }
      return lease.session.transaction(async (transaction) => {
        await rejection(transaction.query(mode === "inside-commit" ? "COMMIT" : "select broken"));
        return "caught-but-unsafe";
      });
    });
    const reason = await rejection(operation);
    assert.equal(reason instanceof NonProxyQaDatabasePortError, true, mode);
    assert.deepEqual(pool.clients[0].releases, [true], mode);
  }
});

test("the lease callback is invoked once and retained capabilities cannot act after successful check-in", async () => {
  const pool = new FakePool();
  const provider = createPgPoolPinnedSessionProvider(pool);
  let calls = 0;
  let retained;
  assert.equal(await provider.withPinnedSession(async (lease) => {
    calls += 1;
    retained = lease;
    return "done";
  }), "done");
  assert.equal(calls, 1);
  assert.deepEqual(pool.clients[0].releases, [false]);
  await assert.rejects(retained.session.query("select after release"), (error) => error instanceof NonProxyQaDatabasePortError);
  await assert.rejects(retained.discard(), (error) => error instanceof NonProxyQaDatabasePortError);
  assert.deepEqual(pool.clients[0].releases, [false], "a late capability cannot destroy a repooled client");
});

test("a fresh node-postgres null status is proven idle before application work", async () => {
  const pool = new FakePool({ initialStatus: null });
  const provider = createPgPoolPinnedSessionProvider(pool);
  let invoked = false;
  assert.equal(await provider.withPinnedSession(async () => { invoked = true; return "ready"; }), "ready");
  assert.equal(invoked, true);
  assert.deepEqual(pool.clients[0].queries.map(({ sql }) => sql), ["select 1 as jessica_pg_pool_session_ready"]);
  assert.deepEqual(pool.clients[0].releases, [false]);
});

test("unsafe transaction status getter, unacknowledged readiness, connect rejection, and invalid callbacks fail closed", async () => {
  {
    const marker = new Error("status unavailable");
    const pool = new FakePool({ statusErrorPresent: true, statusError: marker });
    const provider = createPgPoolPinnedSessionProvider(pool);
    const reason = await rejection(provider.withPinnedSession(async () => "unsafe"));
    assert.equal(reason instanceof NonProxyQaDatabasePortError, true);
    assert.deepEqual(pool.clients[0].releases, [true]);
  }
  {
    const pool = new FakePool({ initialStatus: null, stickyNullStatus: true });
    const provider = createPgPoolPinnedSessionProvider(pool);
    let invoked = false;
    const reason = await rejection(provider.withPinnedSession(async () => { invoked = true; return "unsafe"; }));
    assert.equal(reason instanceof NonProxyQaDatabasePortError, true);
    assert.equal(invoked, false, "unacknowledged readiness cannot reach application work");
    assert.deepEqual(pool.clients[0].queries.map(({ sql }) => sql), ["select 1 as jessica_pg_pool_session_ready"]);
    assert.deepEqual(pool.clients[0].releases, [true]);
  }
  {
    const pool = new FakePool({ connectErrorPresent: true, connectError: undefined });
    const provider = createPgPoolPinnedSessionProvider(pool);
    assert.equal(await rejection(provider.withPinnedSession(async () => "unreachable")), undefined);
    assert.equal(pool.clients.length, 0);
  }
  {
    const pool = new FakePool();
    const provider = createPgPoolPinnedSessionProvider(pool);
    await assert.rejects(provider.withPinnedSession(undefined), TypeError);
    assert.equal(pool.connects, 0);
  }
  assert.throws(() => createPgPoolPinnedSessionProvider({}), TypeError);
});
