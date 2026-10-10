import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { deepDiff, KIND } from '../src/core.js';

/** Convenience: build a record from a triple. */
function add(path, value) {
  return { kind: KIND.ADD, path, value };
}
function remove(path, oldValue) {
  return { kind: KIND.REMOVE, path, oldValue };
}
function change(path, oldValue, value) {
  return { kind: KIND.CHANGE, path, oldValue, value };
}

// Node.js test files are modules — top-level code is fine.

test('identical primitives produce no diff', () => {
  assert.deepEqual(deepDiff(1, 1), []);
  assert.deepEqual(deepDiff('x', 'x'), []);
  assert.deepEqual(deepDiff(true, true), []);
  assert.deepEqual(deepDiff(null, null), []);
});

test('changed primitives produce a single CHANGE at root', () => {
  assert.deepEqual(deepDiff(1, 2), [change('', 1, 2)]);
  assert.deepEqual(deepDiff('a', 'b'), [change('', 'a', 'b')]);
});

test('added primitive at root', () => {
  // undefined → 5 is a CHANGE because both sides are leaves; there is no "ADDED root".
  assert.deepEqual(deepDiff(undefined, 5), [change('', undefined, 5)]);
});

test('NaN equals NaN via Object.is, no diff', () => {
  assert.deepEqual(deepDiff(NaN, NaN), []);
});

test('+0 and -0 are treated as different by default', () => {
  assert.deepEqual(deepDiff(+0, -0), [change('', +0, -0)]);
});

test('added object key is reported at the leaf', () => {
  const a = { x: 1 };
  const b = { x: 1, y: 2 };
  assert.deepEqual(deepDiff(a, b), [add('y', 2)]);
});

test('removed object key is reported at the leaf', () => {
  const a = { x: 1, y: 2 };
  const b = { x: 1 };
  assert.deepEqual(deepDiff(a, b), [remove('y', 2)]);
});

test('changed object key produces CHANGE at that key', () => {
  const a = { x: 1 };
  const b = { x: 2 };
  assert.deepEqual(deepDiff(a, b), [change('x', 1, 2)]);
});

test('nested object changes produce keyed paths', () => {
  const a = { user: { name: 'a', age: 30 } };
  const b = { user: { name: 'b', age: 30 } };
  assert.deepEqual(deepDiff(a, b), [change('user.name', 'a', 'b')]);
});

test('removed nested subtree reports each leaf', () => {
  const a = { user: { name: 'a', age: 30 } };
  const b = {};
  assert.deepEqual(deepDiff(a, b), [
    remove('user.age', 30),
    remove('user.name', 'a'),
  ]);
});

test('added nested subtree reports each leaf', () => {
  const a = {};
  const b = { user: { name: 'a', age: 30 } };
  assert.deepEqual(deepDiff(a, b), [
    add('user.age', 30),
    add('user.name', 'a'),
  ]);
});

test('arrays are compared positionally', () => {
  const a = [1, 2, 3];
  const b = [1, 9, 3];
  assert.deepEqual(deepDiff(a, b), [change('[1]', 2, 9)]);
});

test('array growth appends ADD leaves', () => {
  const a = [1];
  const b = [1, 2, 3];
  assert.deepEqual(deepDiff(a, b), [
    add('[1]', 2),
    add('[2]', 3),
  ]);
});

test('array shrink appends REMOVE leaves', () => {
  const a = [1, 2, 3];
  const b = [1];
  assert.deepEqual(deepDiff(a, b), [
    remove('[1]', 2),
    remove('[2]', 3),
  ]);
});

test('nested arrays inside objects produce dotted+bracket paths', () => {
  const a = { items: [{ id: 1 }, { id: 2 }] };
  const b = { items: [{ id: 1 }, { id: 9 }] };
  assert.deepEqual(deepDiff(a, b), [change('items[1].id', 2, 9)]);
});

test('object vs primitive at a key is a CHANGE, not a recurse', () => {
  // x was an object, now a number — the whole value changed.
  const a = { x: { y: 1 } };
  const b = { x: 5 };
  assert.deepEqual(deepDiff(a, b), [change('x', { y: 1 }, 5)]);
});

test('array vs object at a key is a CHANGE', () => {
  const a = { x: [1, 2] };
  const b = { x: { 0: 1, 1: 2 } };
  assert.deepEqual(deepDiff(a, b), [change('x', [1, 2], { 0: 1, 1: 2 })]);
});

test('keys are sorted regardless of insertion order', () => {
  const a = { b: 1, a: 2, c: 3 };
  const b = { a: 2, b: 9, c: 3 };
  assert.deepEqual(deepDiff(a, b), [change('b', 1, 9)]);
});

test('keys containing dots are quoted in the path', () => {
  const a = { 'a.b': 1 };
  const b = { 'a.b': 2 };
  assert.deepEqual(deepDiff(a, b), [change('["a.b"]', 1, 2)]);
});

test('keys containing quotes are escaped in the path', () => {
  const a = { 'a"b': 1 };
  const b = { 'a"b': 2 };
  assert.deepEqual(deepDiff(a, b), [change('["a\\"b"]', 1, 2)]);
});

test('Date instances are leaves compared by the custom comparator', () => {
  // With the default Object.is comparator, two different Date instances are not equal
  // even if their getTime() matches, because Object.is compares object identity.
  const d1 = new Date('2020-01-01T00:00:00Z');
  const d2 = new Date('2020-01-01T00:00:00Z');
  assert.deepEqual(deepDiff(d1, d2), [change('', d1, d2)]);
});

test('custom equal comparator is used for leaves', () => {
  const d1 = new Date('2020-01-01T00:00:00Z');
  const d2 = new Date('2020-01-01T00:00:00Z');
  const byTime = (x, y) =>
    x instanceof Date && y instanceof Date ? x.getTime() === y.getTime() : Object.is(x, y);
  assert.deepEqual(deepDiff(d1, d2, { equal: byTime }), []);
});

test('Object.create(null) is treated as a plain object', () => {
  const a = Object.assign(Object.create(null), { x: 1 });
  const b = Object.assign(Object.create(null), { x: 2 });
  assert.deepEqual(deepDiff(a, b), [change('x', 1, 2)]);
});

test('null is not recursed into', () => {
  const a = { x: null };
  const b = { x: 5 };
  assert.deepEqual(deepDiff(a, b), [change('x', null, 5)]);
});

test('deeply nested mixed structure', () => {
  const a = { list: [{ v: 1 }, { v: 2 }], meta: { ok: true } };
  const b = { list: [{ v: 1 }, { v: 9 }], meta: { ok: false } };
  assert.deepEqual(deepDiff(a, b), [
    change('list[1].v', 2, 9),
    change('meta.ok', true, false),
  ]);
});
