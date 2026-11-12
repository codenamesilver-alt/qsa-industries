p = "src/components/expense-actions.tsx"
s = open(p).read()
s = s.replace(
    '           onChange={(event) => setHasTax(event.target.checked)}',
    '           name="hasTax"\n           onChange={(event) => setHasTax(event.target.checked)}',
)
# file input
old = """          <input
            accept={EXPENSE_MIME_TYPES.join(",")}
            className="mt-2 w-full text-sm"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setFileError(validateFile(event.target.files?.[0] ?? null));
            }}
            type="file"
          />"""
new = """          <input
            accept={EXPENSE_MIME_TYPES.join(",")}
            className="mt-2 w-full text-sm"
            name="attachment"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setFileError(validateFile(event.target.files?.[0] ?? null));
            }}
            type="file"
          />"""
s = s.replace(old, new)
open(p, "w").write(s)
print("done")
