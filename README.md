# simple-deep-object-differ

Computes a structured diff between two deeply nested values, returning `add`, `remove`,
and `change` entries keyed by dotted path.

## Usage

```js
import { deepDiff, KIND } from 'simple-deep-object-differ';

const before = { user: { name: 'ada', tags: ['x'] } };
const after  = { user: { name: 'ada', tags: ['x', 'y'], role: 'admin' } };

for (const node of deepDiff(before, after)) {
  if (node.kind === KIND.ADD)     console.log('+', node.path, node.value);
  if (node.kind === KIND.REMOVE)  console.log('-', node.path, node.oldValue);
  if (node.kind === KIND.CHANGE)  console.log('~', node.path, node.oldValue, '→', node.value);
}
// → + user.tags[1] y
// → + user.role admin
```

`deepDiff(a, b, opts?)` returns an array of `{ kind, path, value?, oldValue? }`. `kind` is
a symbol: `KIND.ADD`, `KIND.REMOVE`, or `KIND.CHANGE`. Pass `opts.equal` to supply your own
leaf comparator (the default is `Object.is`, so `NaN === NaN` and `+0 !== -0`).

## Why this exists

The problem is small but real: given two snapshots of a nested object, produce a flat list
of the leaves that changed, with a path you can print or feed back into a setter. Existing
deep-diff libraries vary in what they consider a "change" and in their output shape; this
one picks a single, predictable shape and sticks to it.

The trade-off: **only plain objects and arrays are treated as trees.** `Date`, `RegExp`,
`Map`, `Set`, `URL`, and other built-in object types are leaves compared by `opts.equal`.
If you need to diff the internal state of a `Map`, convert it to a plain object first.

## The awkward edge you will hit

**Arrays are compared positionally, not by move detection.** `[a, b, c]` vs `[b, c, a]` is
reported as three changes at indices 0, 1, 2 — not as a single move. If your arrays model
ordered lists where items get reordered, this library will produce noisy output for those
reorderings. The positional interpretation is the one we implement; no move-aware mode is
planned.

A second edge: when a subtree is replaced by a leaf (or vice versa), the whole node is
reported as a single `CHANGE`. `deepDiff({ x: { y: 1 } }, { x: 5 })` yields one record:
`{ kind: CHANGE, path: 'x', oldValue: { y: 1 }, value: 5 }`. It does not drill into the
removed `{ y: 1 }` to emit a `REMOVE` for `x.y`, because the real event is that `x` itself
was replaced — reporting the leaves of a dead subtree would hide that.

Paths use dotted notation for object keys and bracket notation for array indices:
`user.tags[1]`, `items[0].id`. Keys that contain dots or quotes are bracket-quoted and
escaped, e.g. `["a.b"]` or `["a\\"b"]`.
