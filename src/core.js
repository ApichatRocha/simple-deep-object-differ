/**
 * Core diffing logic for simple-deep-object-differ.
 */

/**
 * Why symbols for kind rather than strings: the kind must never collide with user data
 * and must be distinguishable from any string the user might return from a custom comparator.
 * A symbol survives JSON.stringify only as null, but this library returns live objects,
 * not serialized data, so symbols are safe and expressive here.
 *
 * @typedef {symbol} DiffKind
 */

/** @type {Readonly<{ADD: symbol, REMOVE: symbol, CHANGE: symbol}>} */
export const KIND = Object.freeze({
  ADD: Symbol('add'),
  REMOVE: Symbol('remove'),
  CHANGE: Symbol('change'),
});

/**
 * The default comparator used when the user does not supply one.
 *
 * Why strict Object.is here: +0 !== -0 and NaN === NaN are the surprising-but-correct
 * primitives that a plain `===` gets wrong. Object.is is the right default for value
 * equality at the leaves. (This does not affect object comparison — objects never reach
 * the comparator, they recurse.)
 *
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
export function defaultEqual(a, b) {
  return Object.is(a, b);
}

/**
 * Returns true when x is a plain object (i.e. created by {}, an object literal, or
 * Object.create(null)). Returns false for arrays, dates, regexps, and other built-ins.
 *
 * Why this strict gate: a Date and a String are both typeof 'object', but they are not
 * containers we should recurse into. Only plain objects and arrays are treated as trees.
 * Everything else is a leaf compared by the comparator.
 *
 * @param {*} x
 * @returns {boolean}
 */
export function isPlainObject(x) {
  if (typeof x !== 'object' || x === null) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === null || proto === Object.prototype;
}

/**
 * Returns true when x is an Array (exotic object, [[Class]] 'Array').
 *
 * @param {*} x
 * @returns {boolean}
 */
export function isArray(x) {
  return Array.isArray(x);
}

/**
 * The canonical node in the diff result.
 *
 * @typedef {Object} DiffNode
 * @property {DiffKind} kind     One of KIND.ADD, KIND.REMOVE, KIND.CHANGE.
 * @property {string}   path     Dotted path; '' for the root value.
 * @property {*}        [value]  For ADD: the added value. For CHANGE: the new value.
 * @property {*}        [oldValue] For REMOVE: the removed value. For CHANGE: the old value.
 */

/**
 * Quotes a single path segment for safe dotted-path concatenation.
 *
 * Why: the path format is `a.b.c` for plain keys, `a[0].b` for array indices, and `a["x.y"]`
 * for keys that contain dots or quotes. This makes round-trip parsing unambiguous and keeps
 * human-readable paths readable in the common case.
 *
 * @param {string} key
 * @returns {string}
 */
function formatSegment(key) {
  if (key === '') return '[""]';
  // Non-negative integer string → bare bracket form (array index).
  if (/^(0|[1-9][0-9]*)$/.test(key)) return `[${key}]`;
  // Identifier-ish: ASCII alnum and underscore, not starting with a digit.
  // Keys like 'foo', '_bar', 'baz123' stay bare; '0' becomes ['0'] for clarity even though
  // a leading digit is a valid bare identifier — we sacrifice a little terseness for
  // unambiguous readability of array-vs-object at a glance.
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return key;
  // Escape backslashes and double quotes inside the quoted segment.
  const escaped = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `["${escaped}"]`;
}

/**
 * Concatenates a parent path with a child key.
 *
 * @param {string} parentPath
 * @param {string} key
 * @returns {string}
 */
function joinPath(parentPath, key) {
  const seg = formatSegment(key);
  if (parentPath === '') return seg;
  if (seg.startsWith('[')) return parentPath + seg;
  return parentPath + '.' + seg;
}

/**
 * Pushes a single leaf-level record (ADD / REMOVE / CHANGE) onto `out`.
 *
 * @param {DiffNode[]} out
 * @param {DiffKind}   kind
 * @param {string}     path
 * @param {*}          a
 * @param {*}          b
 * @returns {void}
 */
function pushLeaf(out, kind, path, a, b) {
  if (kind === KIND.ADD) {
    out.push({ kind, path, value: b });
  } else if (kind === KIND.REMOVE) {
    out.push({ kind, path, oldValue: a });
  } else {
    out.push({ kind, path, oldValue: a, value: b });
  }
}

/**
 * Compares two plain objects key-by-key and pushes diff records for the leaves.
 *
 * Why we iterate Object.keys in sorted order: the diff output is a list, and making it
 * deterministic regardless of key insertion order is a property tests and downstream
 * consumers rely on. Sorting is O(n log n) which is negligible for the sizes this library
 * is designed for.
 *
 * @param {Object} a
 * @param {Object} b
 * @param {string} path
 * @param {DiffNode[]} out
 * @param {function(*,*):boolean} equal
 * @returns {void}
 */
function diffObjects(a, b, path, out, equal) {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();

  let i = 0;
  let j = 0;
  while (i < aKeys.length && j < bKeys.length) {
    const ak = aKeys[i];
    const bk = bKeys[j];
    if (ak < bk) {
      // present in a, missing in b → REMOVE (reported at the leaf)
      pushRemoved(a[ak], joinPath(path, ak), out, equal);
      i++;
    } else if (ak > bk) {
      // present in b, missing in a → ADD (reported at the leaf)
      pushAdded(b[bk], joinPath(path, bk), out, equal);
      j++;
    } else {
      diffValues(a[ak], b[bk], joinPath(path, ak), out, equal);
      i++;
      j++;
    }
  }
  while (i < aKeys.length) {
    const ak = aKeys[i++];
    pushRemoved(a[ak], joinPath(path, ak), out, equal);
  }
  while (j < bKeys.length) {
    const bk = bKeys[j++];
    pushAdded(b[bk], joinPath(path, bk), out, equal);
  }
}

/**
 * Pushes a deep "added" tree onto out, reporting each leaf as ADD.
 *
 * @param {*} v
 * @param {string} path
 * @param {DiffNode[]} out
 * @param {function(*,*):boolean} equal
 * @returns {void}
 */
function pushAdded(v, path, out, equal) {
  if (isPlainObject(v)) {
    for (const key of Object.keys(v).sort()) {
      pushAdded(v[key], joinPath(path, key), out, equal);
    }
  } else if (isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      pushAdded(v[i], joinPath(path, String(i)), out, equal);
    }
  } else {
    out.push({ kind: KIND.ADD, path, value: v });
  }
}

/**
 * Pushes a deep "removed" tree onto out, reporting each leaf as REMOVE.
 *
 * @param {*} v
 * @param {string} path
 * @param {DiffNode[]} out
 * @param {function(*,*):boolean} equal
 * @returns {void}
 */
function pushRemoved(v, path, out, equal) {
  if (isPlainObject(v)) {
    for (const key of Object.keys(v).sort()) {
      pushRemoved(v[key], joinPath(path, key), out, equal);
    }
  } else if (isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      pushRemoved(v[i], joinPath(path, String(i)), out, equal);
    }
  } else {
    out.push({ kind: KIND.REMOVE, path, oldValue: v });
  }
}

/**
 * Compares two arrays index-by-index and pushes diff records for the leaves.
 *
 * Why positional comparison instead of element-level LCS: array diffing has two reasonable
 * interpretations — positional (a[0] vs b[0], a[1] vs b[1], …) and set-like / sequence-like
 * (LCS, move detection). The sequence-aware approach is dramatically more complex and its
 * output (move records) is a different shape than what this library returns. We pick the
 * positional interpretation and document it plainly in the README. Consumers who need
 * move-aware diffs should use a different library.
 *
 * @param {Array} a
 * @param {Array} b
 * @param {string} path
 * @param {DiffNode[]} out
 * @param {function(*,*):boolean} equal
 * @returns {void}
 */
function diffArrays(a, b, path, out, equal) {
  const n = a.length;
  const m = b.length;
  const len = Math.min(n, m);
  for (let i = 0; i < len; i++) {
    diffValues(a[i], b[i], joinPath(path, String(i)), out, equal);
  }
  if (m > n) {
    for (let i = n; i < m; i++) {
      pushAdded(b[i], joinPath(path, String(i)), out, equal);
    }
  } else if (n > m) {
    for (let i = m; i < n; i++) {
      pushRemoved(a[i], joinPath(path, String(i)), out, equal);
    }
  }
}

/**
 * Core recursive comparator. Dispatches on the *kinds* of a and b.
 *
 * Why we only recurse when BOTH sides are the same container kind: when one side is an
 * object and the other is a primitive, that is a CHANGE at that node — not a recursion
 * into the object's leaves. Recursing into an object on one side and comparing it to a
 * primitive on the other would produce confusing "removed all leaves" output that hides
 * the real event: the whole subtree was replaced.
 *
 * @param {*} a
 * @param {*} b
 * @param {string} path
 * @param {DiffNode[]} out
 * @param {function(*,*):boolean} equal
 * @returns {void}
 */
function diffValues(a, b, path, out, equal) {
  const aIsObj = isPlainObject(a);
  const bIsObj = isPlainObject(b);
  const aIsArr = isArray(a);
  const bIsArr = isArray(b);

  if (aIsObj && bIsObj) {
    diffObjects(a, b, path, out, equal);
    return;
  }
  if (aIsArr && bIsArr) {
    diffArrays(a, b, path, out, equal);
    return;
  }
  // Mismatched kinds, or one side is a leaf → CHANGE (using the comparator so callers can
  // supply their own notion of equality for leaf types like Dates).
  if (!equal(a, b)) {
    pushLeaf(out, KIND.CHANGE, path, a, b);
  }
}

/**
 * Computes a deep diff between two values, returning add / remove / change entries keyed
 * by dotted path.
 *
 * Design decisions (see README for the full statement):
 *  - Only plain objects and arrays are treated as containers; Dates, RegExps, Maps, etc.
 *    are leaves compared by `equal`.
 *  - Arrays are compared positionally. No move detection.
 *  - Paths are dotted: `a.b[0].c["x.y"]` for the root → `a.b[0].c["x.y"]`.
 *  - Output order is deterministic: object keys are sorted; array indices are ascending.
 *
 * @param {*} a                 The "before" value.
 * @param {*} b                 The "after" value.
 * @param {Object}  [opts]      Optional settings.
 * @param {function(*,*):boolean} [opts.equal=defaultEqual]
 *        Leaf comparator. Receives two non-container values and returns true if they are
 *        considered equal. Defaults to `Object.is` so that `NaN === NaN` and `+0 !== -0`.
 * @returns {DiffNode[]}        A flat, ordered list of diff records.
 */
export function deepDiff(a, b, opts) {
  const equal = (opts && typeof opts.equal === 'function') ? opts.equal : defaultEqual;
  /** @type {DiffNode[]} */
  const out = [];
  diffValues(a, b, '', out, equal);
  return out;
}
