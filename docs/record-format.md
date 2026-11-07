# Stage record format

This document specifies the published election record well enough for anyone, or their own AI agent, to write an independent verifier without reading or running our code. `tools/verifier` is our implementation. `tools/verifier/test/independent/check.ts` is a second one, written only from this document with Node's built-in `crypto` module, and a test shows the two agree (see [Conformance](#conformance)).

Everything here describes the bytes that `POST /api/batches` (`apps/web/lib/batches.ts`) and the scale-demo seed (`tools/scale-demo`) actually write. Where the T-15 draft of the public JSON shapes differs, [Differences from the T-15 draft](#differences-from-the-t-15-draft) says how and which one wins.

Key words: **MUST** means a verifier that skips the rule is not checking the record.

## 1. Conventions

| Term | Meaning |
| --- | --- |
| SHA-256 | FIPS 180-4 SHA-256. The only hash function used anywhere in the record. |
| hex | Lowercase hexadecimal, two characters per byte. A 32-byte hash is 64 hex characters. |
| base64 | Standard base64 (RFC 4648 §4, `+` and `/`, with `=` padding). Not base64url. |
| `\|\|` | Byte concatenation. |
| UTF-8 | The UTF-8 bytes of a string, with no byte-order mark and no terminator. |
| canonical JSON | `JSON.stringify` of the value with every object's keys sorted ascending by UTF-16 code unit (the default JavaScript sort), recursively, and no whitespace. Arrays keep their order. Numbers are integers here, written without exponent or fraction. |
| date | `YYYY-MM-DD`. The record carries dates only, never a time of day or a sequence number. |

## 2. Stages and scopes

A **stage record** is published once per batch transition, for one scope and one stage:

| `stage` | `scope` | Lists |
| --- | --- | --- |
| `TALLIED_PRECINCT` | `precinct` | The precinct's ballots tallied at precinct close |
| `REPORTED_UNOFFICIAL` | `county` | Every ballot in the county's election-night (unofficial) report |
| `CERTIFIED` | `county` | Every ballot in the certified count |
| `CHALLENGED` | `county` | Ballots under challenge |
| `DISCARDED` | `county` | Ballots discarded after a challenge was rejected |

## 3. JSON fields

A stage record, as served by `GET /api/record/{scope_id}/{stage}` and as stored in the `stage_records` table plus the ballots it lists:

```json
{
  "scope": "precinct",
  "scope_id": "SCALE-DEMO-001",
  "stage": "TALLIED_PRECINCT",
  "merkle_root": "<64 hex>",
  "ballot_count": 500,
  "totals": { "governor": { "gov-a": 171, "gov-b": 160, "gov-c": 169 } },
  "published_on": "2026-11-03",
  "signature": "<base64 of 64 bytes>",
  "ballots": [{ "tracking_code": "RIVER-MAPLE-7Q4K-HAWK", "ciphertext_hash": "<64 hex>" }]
}
```

| Field | Type | Meaning | Signed? |
| --- | --- | --- | --- |
| `scope` | `"precinct"` or `"county"` | The kind of scope (see §2). | Yes, as `scope` |
| `scope_id` | string | The precinct or county id, for example `SCALE-DEMO-001`. Used in the URL. | **No** (see §6) |
| `stage` | string | One of the stages in §2. | Yes, as `stage` |
| `merkle_root` | 64 hex | Root of the Merkle tree over `ballots` (§5). | Yes, as `merkleRoot` |
| `ballot_count` | integer ≥ 0 | Number of ballots in the batch. MUST equal `ballots.length`. | Yes, as `ballotCount` |
| `totals` | object | `contestId → choiceId → count`. Aggregate counts over the listed ballots, from the officials' aggregate decryption. Never per ballot. Every count is an integer ≥ 0. | Yes, as `totals` |
| `published_on` | date | The date the record was published. | No |
| `signature` | base64 | Ed25519 detached signature, 64 bytes (§6). | (is the signature) |
| `ballots` | array | One `{tracking_code, ciphertext_hash}` per ballot in the batch, in leaf order (§5.3). | Through `merkle_root` |

Per ballot:

| Field | Type | Meaning |
| --- | --- | --- |
| `tracking_code` | string | The code on the voter's receipt: four groups joined by `-`, for example `RIVER-MAPLE-7Q4K-HAWK`. It never contains the byte `0x00`. |
| `ciphertext_hash` | 64 hex | The SHA-256 of the ballot's ciphertext **bytes**. The ciphertext itself is stored as base64 text and is never published. The hash is taken over the decoded bytes, not over the base64 text. |

The record carries no voter identity, no ciphertext, no time of day and no leaf index.

## 4. Hash function

SHA-256 everywhere: ciphertext hashes, Merkle leaves and nodes, and the per-ballot event chain (§8). There is no other hash and no salt.

## 5. Merkle tree

### 5.1 Leaf encoding

Each listed ballot is one leaf. The leaf's bytes are:

```text
leaf = UTF-8(tracking_code) || 0x00 || bytes(ciphertext_hash)
```

`bytes(ciphertext_hash)` is the 32 raw bytes the 64 hex characters encode, not the hex text. So a leaf is `len(UTF-8(tracking_code)) + 33` bytes long. The `0x00` separator cannot occur inside a tracking code, so no two different `(tracking_code, ciphertext_hash)` pairs give the same leaf.

The leaf binds the code to the hash. A ballot listed with another ballot's code, or a code listed with another ballot's hash, changes the root.

### 5.2 Hashing leaves and nodes

Leaves and internal nodes are domain-separated with one prefix byte:

```text
leafHash(leaf)          = SHA-256(0x00 || leaf)
nodeHash(left, right)   = SHA-256(0x01 || left || right)
```

So the bytes hashed for a leaf are `0x00 || UTF-8(tracking_code) || 0x00 || bytes(ciphertext_hash)`. The first `0x00` is the tree's leaf prefix and the second is the leaf's own separator.

### 5.3 Leaf order

Leaves are ordered by:

1. `ciphertext_hash` ascending (hex string comparison, which is the same as byte order), then
2. `tracking_code` ascending by UTF-16 code unit (plain `<`, never a locale-aware compare).

The order never depends on casting order, so a ballot's position in the tree says nothing about when it was cast. `ballots` in the published JSON is listed in this same order. A verifier MUST sort the ballots itself, not trust the listed order, and MUST fail a record whose `ballots` is not already in this order. Any other order is either a format error or a leak of casting order.

### 5.4 Building the root

```text
level₀ = [leafHash(leaf) for each leaf, in leaf order]
while the level has more than one hash:
    next = []
    for i = 0, 2, 4, …:
        if level[i+1] exists: next.append(nodeHash(level[i], level[i+1]))
        else:                 next.append(level[i])      # odd one out moves up unchanged
    level = next
root = level[0]
```

- An unpaired last hash is **promoted** to the next level unchanged. It is never hashed with itself.
- A tree of exactly one leaf has `root = leafHash(leaf)`.
- A tree of no leaves has `root = SHA-256("")` (the empty string, no prefix), that is `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

`merkle_root` is `hex(root)`.

## 6. Signature

### 6.1 What it covers

The signature is Ed25519 (RFC 8032, pure Ed25519, no prehash, no context) over the UTF-8 bytes of the canonical JSON (§1) of exactly these five fields:

```json
{"ballotCount":500,"merkleRoot":"<64 hex>","scope":"precinct","stage":"TALLIED_PRECINCT","totals":{"governor":{"gov-a":171,"gov-b":160,"gov-c":169}}}
```

| Signed key | From JSON field |
| --- | --- |
| `scope` | `scope` (`"precinct"` or `"county"`, **not** `scope_id`) |
| `stage` | `stage` |
| `merkleRoot` | `merkle_root` |
| `ballotCount` | `ballot_count` |
| `totals` | `totals`, with its contest and choice keys sorted too |

Keys are sorted at every level, so `totals` is signed with contests and choices in code-unit order however the JSON lists them.

Because the root is signed and the root commits to every `(tracking_code, ciphertext_hash)` pair, the signature covers the ballot list as well. `scope_id`, `published_on` and the `ballots` array as text are not signed directly.

**Known limitation.** `scope_id` is not signed. A validly signed precinct record could be re-served under another precinct's id. C3 (§9) still catches this when the relabelled record's ballots and totals are summed into a county, but a verifier checking a single precinct cannot. Changing what is signed belongs to `packages/crypto` and is out of scope here.

### 6.2 Which key verifies it

The stage signing public key is a 32-byte Ed25519 public key, given as base64 (the `STAGE_SIGNING_PUBLIC_KEY` value).

**Get the key from the election office**, through a channel you trust: the office's own publication, a printed notice, or in person. **Never take it from the server whose record you are checking.** A server that could rewrite the record could equally serve a key it controls. `tools/verifier` never fetches the key. It must be passed in with `--public-key` or `STAGE_SIGNING_PUBLIC_KEY`. With no key, every signature check fails. There is no unsigned pass.

### 6.3 Encoding

`signature` is the 64-byte signature in base64 (88 characters, ending `==`), as `stage_records.signature` stores it. Because the T-15 draft writes it as 128 hex characters, a verifier SHOULD accept either: 128 lowercase hex characters are hex, and anything else is base64. The two cannot be confused.

## 7. Inclusion proofs

An inclusion proof shows that one ballot is a leaf of one published record without listing the other ballots:

```json
{ "scope_id": "SCALE-DEMO-001", "stage": "TALLIED_PRECINCT", "path": [{ "side": "right", "hash": "<64 hex>" }] }
```

`path` lists the sibling hashes from the leaf level up to, but not including, the root. Each step's `side` says where the sibling sits. To verify the proof for `(tracking_code, ciphertext_hash)` against a record:

```text
h = leafHash(UTF-8(tracking_code) || 0x00 || bytes(ciphertext_hash))
for step in path:
    if step.side == "left":  h = nodeHash(bytes(step.hash), h)
    if step.side == "right": h = nodeHash(h, bytes(step.hash))
    otherwise:               fail
accept iff hex(h) == record.merkle_root   (and the record's signature verifies, §6)
```

A level where the ballot's hash was promoted unpaired (§5.4) has no step, so `path` can be shorter than the tree's height. A proof never carries the leaf's index or position. The verifier also MUST check that the record lists the code with the same `ciphertext_hash`, so the receipt, the proof and the list all agree.

## 8. Per-ballot event chain (for reference)

`GET /api/track/{code}` shows a ballot's dated timeline. Each event's `hash` is the hex SHA-256 of the UTF-8 canonical JSON of exactly:

```json
{"v":1,"tracking_code":"…","event_type":"…","from_status":…,"to_status":…,"reason":…,"occurred_on":"YYYY-MM-DD","prev_hash":…}
```

The keys are sorted when serialised. The first event has `prev_hash: null`, and every later event's `prev_hash` is the previous event's `hash`. No time of day, actor or batch is hashed. The chain is not part of a stage record. It is listed here so a verifier can check both from one document.

## 9. Cross-checks C2 to C4 from the public record

The officials' cross-checks (`docs/locked-interfaces.md` § Cross-checks) compare records the public cannot see. The checks below are what anyone can do with the signed records alone. They compare signed totals, counts and ballot sets, and never decrypt. A record whose signature or Merkle root fails is reported as such, and the checks below still run on its fields.

A ballot selects any one choice at most once, so one ballot adds at most 1 to any single `totals[contest][choice]`. Contests may allow more than one selection, so a contest's sum is **not** bounded by the ballot count. Only each choice is.

Missing contests or choices count as 0. The ballot set of a record is the map `tracking_code → ciphertext_hash` of its `ballots`.

**C2: precinct totals.** For each `TALLIED_PRECINCT` record:

- every count in `totals` is an integer ≥ 0, and
- no choice has more votes than the record has ballots: `totals[c][k] ≤ ballot_count`.

**C3: election-night totals.** For a county's `REPORTED_UNOFFICIAL` record and the `TALLIED_PRECINCT` records of its precincts:

- for every `(contest, choice)` in any of them: county `totals[c][k]` = Σ precinct `totals[c][k]`,
- county `ballot_count` = Σ precinct `ballot_count`,
- no tracking code is listed in two precincts, and
- the county's ballot set equals the union of the precincts' ballot sets, with each code having the same `ciphertext_hash`.

**C4: certification.** For a county's `REPORTED_UNOFFICIAL` (U) and `CERTIFIED` (C) records, and its `CHALLENGED` and `DISCARDED` records (an unpublished one counts as listing no ballots):

- every ballot in C is in U with the same `ciphertext_hash`,
- every ballot in U but not in C ("removed") is listed in `CHALLENGED` or `DISCARDED`,
- for every `(contest, choice)`: `C.totals[c][k] ≤ U.totals[c][k]`, and
- for every `(contest, choice)`: `U.totals[c][k] − C.totals[c][k] ≤` the number of removed ballots. Each removed ballot takes away at most one vote per choice.

Every record used in C3 and C4 MUST also pass §5 and §6 on its own, or the comparison proves nothing.

## 10. Checklist for an independent verifier

For each stage record, with the election office's public key:

1. **ballot-count:** `ballot_count == ballots.length`, and no `tracking_code` is listed twice.
2. **leaf-order:** `ballots` is strictly in the §5.3 order.
3. **merkle-root:** rebuild the root from the leaves (§5) and compare with `merkle_root`.
4. **signature:** verify `signature` over the §6.1 bytes with the office's key.

Then **c2** on each precinct record, and **c3** and **c4** per county (§9). For each receipt you hold, **inclusion** (§7).

## Conformance

`tools/verifier/test/independent.test.ts` builds a county with the scale-demo seed (`tools/scale-demo`, real `@vbt/crypto` and `@vbt/events`), adds signed county records, and runs both `tools/verifier` and the independent check from this document over it. They must give the same verdict for every check. Both must fail when one ballot's `ciphertext_hash` or one stage total is altered.

## Differences from the T-15 draft

The T-15 pull request (#110, on `main`) added a draft of the public JSON shapes to `docs/locked-interfaces.md` that differs from what the record producers write:

| Point | T-15 draft | Producers (this document) |
| --- | --- | --- |
| Merkle leaves | the 32 bytes of each `ciphertext_hash` | `UTF-8(tracking_code) \|\| 0x00 \|\| ciphertext_hash` from `@vbt/events` `stageLeaves` (§5.1) |
| Leaf order | `ciphertext_hash` | `ciphertext_hash`, then `tracking_code` (§5.3) |
| Signed `scope` | `scope_id` | `"precinct"` or `"county"` (§6.1) |
| `signature` encoding | 128 hex | base64; a verifier accepts both (§6.3) |

The bare-hash leaf convention is superseded (context log, T-11a correction). It does not bind a tracking code to its ciphertext. This document follows the code that writes the records. Making `docs/locked-interfaces.md` match is a separate change that needs Shawn's or Austin's approval.
