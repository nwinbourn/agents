# Plays: security review

**Scope: authorized work only** — your own systems, your own repos, a documented
engagement, or a CTF. Authorization is a *field in the work order*, not an assumption.

## 1. Authorization goes in the order

Every worker's order carries, verbatim:

```markdown
**Authorization:** <whose system this is and why review is authorized — "the user's own
repo", "documented engagement, scope below", "CTF challenge X">
**In scope:** <exact repos, paths, hosts>
**Out of scope:** <everything else, named where it could plausibly be confused>
**Analysis only.** Do not attempt exploitation against any live system. Do not handle,
extract, or exfiltrate real credentials or user data.
```

An order without a scope statement is how a worker ends up scanning something it
shouldn't. Write it even when it feels obvious.

## 2. Route to the top tier

Security analysis is judgment-heavy and the failure mode is a plausible-sounding false
positive — a reasoning failure, not an execution failure. Cheap workers produce confident
findings that cost more to disprove than they'd have cost to find properly.

## 3. Fan out by attack surface, not by file

A per-file split systematically misses cross-file flows, which is where the real bugs
live. Standard surfaces, one worker each:

| Surface | Looks for |
|---|---|
| **Authn / authz** | missing checks, IDOR, role confusion, unprotected routes, JWT handling |
| **Input handling** | injection (SQL, command, template, XSS), deserialization, path traversal, SSRF |
| **Secrets & config** | hardcoded keys, secrets in logs or client bundles, permissive CORS, debug flags in prod |
| **Dependencies** | known-vulnerable versions, install scripts, typosquats, unpinned transitive deps |
| **Data exposure** | over-fetching APIs, PII in logs/errors, missing field-level authorization |
| **Crypto & sessions** | weak/DIY crypto, bad randomness, session fixation, insecure cookie flags |

Trace **flows**, not lines: source → transformation → sink. Tell workers to follow user
input across file boundaries.

## 4. Findings return as structured data

```json
{
  "severity": "critical|high|medium|low",
  "title": "...",
  "location": "path/to/file.ts:142",
  "vulnerable_expression": "the exact code",
  "attack_path": "step by step from attacker input to impact",
  "proof": "concrete PoC, or the literal word 'theoretical'",
  "fix": "the specific change"
}
```

No prose reports from workers. `proof: "theoretical"` is honest and useful; a fabricated
PoC is worse than no finding.

## 5. Adversarial refutation is the default for High/Critical

**Every High or Critical finding gets refuted before it is reported.** This is the
highest-value rule in the entire plays library.

Unrefuted LLM security findings are mostly false positives — an upstream middleware, a
framework default, a sanitizer one layer up, or an unreachable path. And a false positive
reported to a third party costs far more than an internal miss: it burns credibility and
sends someone chasing a ghost.

Refuter prompts are in `verification.md`. Diverse lenses beat identical skeptics here:
one refuter on reachability, one on existing mitigations, one on whether the attack path
actually produces the claimed impact.

**Verdict:** report a finding only if a majority fail to refute it. Anything refuted goes
in a "considered and ruled out" list — that list is genuinely useful to the reader.

## 6. Never delegate

- **Exploitation against live systems.** Workers analyze; the human decides on any
  testing.
- **Credential handling** of any kind.
- **Anything outside the stated scope** — a worker that finds an interesting thread
  leading out of scope reports it and stops.

## 7. The main loop writes the report

Dedup, rank by severity, and write the summary in the orchestrator. A worker never writes
the final report — it can't see the other surfaces, so it can't rank, and it will present
its own findings as the important ones.

**Exit:** every High/Critical is either refuted or has survived N refuters, findings are
deduped and ranked, and the report states what was *not* covered.
