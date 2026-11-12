p = "src/components/finance-settings-form.tsx"
s = open(p).read()
s = s.replace(
    '              onChange={(event) => setCountsCurrent(event.target.checked)}',
    '              name="countsCurrent"\n              onChange={(event) => setCountsCurrent(event.target.checked)}',
)
s = s.replace(
    '              onChange={(event) => setClearBuckets(event.target.checked)}',
    '              name="clearBuckets"\n              onChange={(event) => setClearBuckets(event.target.checked)}',
)
open(p, "w").write(s)
print("done")
