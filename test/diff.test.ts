import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDiff } from '../src/core/diff'

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,3 +10,4 @@ function f() {
 const x = 1;
-const y = 2;
+const y = 3;
+--- not a header
 return x;
diff --git a/new.py b/new.py
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new.py
@@ -0,0 +1,2 @@
+def f():
+    pass
\\ No newline at end of file
diff --git a/old.rs b/old.rs
deleted file mode 100644
index 4444444..0000000
--- a/old.rs
+++ /dev/null
@@ -1 +0,0 @@
-fn main() {}
diff --git a/before.ts b/after.ts
similarity index 90%
rename from before.ts
rename to after.ts
diff --git a/logo.png b/logo.png
index 5555555..6666666 100644
Binary files a/logo.png and b/logo.png differ
`

test('parses statuses, paths and line numbers', () => {
  const files = parseDiff(DIFF)
  assert.deepEqual(
    files.map((f) => [f.path, f.oldPath, f.status, f.binary]),
    [
      ['src/a.ts', 'src/a.ts', 'modified', false],
      ['new.py', 'new.py', 'added', false],
      ['old.rs', 'old.rs', 'deleted', false],
      ['after.ts', 'before.ts', 'renamed', false],
      ['logo.png', 'logo.png', 'modified', true],
    ],
  )
  assert.deepEqual(
    files[0].hunks[0].lines.map((l) => [l.kind, l.oldNo, l.newNo, l.text]),
    [
      ['ctx', 10, 10, 'const x = 1;'],
      ['del', 11, null, 'const y = 2;'],
      ['add', null, 11, 'const y = 3;'],
      ['add', null, 12, '--- not a header'],
      ['ctx', 12, 13, 'return x;'],
    ],
  )
  assert.deepEqual(files[1].hunks[0].lines.map((l) => l.newNo), [1, 2])
})
